"""
Stock Levels Management Routes
Tracks real-time inventory stock based on vendor purchases and customer sales.
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import logging
from datetime import datetime
from rapidfuzz import fuzz

from database import get_database_client
from auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


# Pydantic Models
class StockAdjustment(BaseModel):
    """Manual stock adjustment request"""
    part_number: str
    adjustment_type: str  # "add", "subtract", "set_absolute"
    quantity: float
    reason: Optional[str] = None


class StockUpdateRequest(BaseModel):
    """Update stock level fields"""
    reorder_point: Optional[float] = None
    unit_value: Optional[float] = None


def normalize_part_number(part_number: str) -> str:
    """Normalize part number for matching (remove spaces, lowercase)"""
    if not part_number:
        return ""
    return part_number.strip().replace(" ", "").replace("-", "").lower()


def fuzzy_match_part_numbers(part1: str, part2: str, threshold: float = 90.0) -> bool:
    """
    Check if two part numbers match with fuzzy logic.
    Uses 90%+ similarity threshold to catch variations.
    """
    norm1 = normalize_part_number(part1)
    norm2 = normalize_part_number(part2)
    
    if norm1 == norm2:
        return True
    
    similarity = fuzz.ratio(norm1, norm2)
    return similarity >= threshold


@router.get("/levels")
async def get_stock_levels(
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),  # "all", "low_stock", "in_stock", "out_of_stock"
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get all stock levels with optional filtering.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Base query
        query = db.client.table("stock_levels").select("*").eq("username", username)
        
        # Apply search filter
        if search:
            query = query.or_(
                f"internal_item_name.ilike.%{search}%,"
                f"part_number.ilike.%{search}%,"
                f"vendor_description.ilike.%{search}%"
            )
        
        # Order by part number
        query = query.order("part_number")
        
        response = query.execute()
        items = response.data or []
        
        # Apply status filter (post-query since it's computed)
        if status_filter and status_filter != "all":
            if status_filter == "out_of_stock":
                items = [item for item in items if item.get("current_stock", 0) <= 0]
            elif status_filter == "low_stock":
                items = [item for item in items if 0 < item.get("current_stock", 0) < item.get("reorder_point", 3)]
            elif status_filter == "in_stock":
                items = [item for item in items if item.get("current_stock", 0) >= item.get("reorder_point", 3)]
        
        # Add computed status field
        for item in items:
            stock = item.get("current_stock", 0)
            reorder = item.get("reorder_point", 3)
            
            if stock <= 0:
                item["status"] = "Out of Stock"
            elif stock < reorder:
                item["status"] = "Low Stock"
            else:
                item["status"] = "In Stock"
        
        logger.info(f"Retrieved {len(items)} stock levels for {username}")
        
        return {
            "success": True,
            "items": items,
            "count": len(items)
        }
        
    except Exception as e:
        logger.error(f"Error getting stock levels: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary")
async def get_stock_summary(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get summary statistics for stock levels.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Get all stock levels
        response = db.client.table("stock_levels")\
            .select("*")\
            .eq("username", username)\
            .execute()
        
        items = response.data or []
        
        # Calculate summary stats
        total_stock_value = sum(item.get("total_value", 0) or 0 for item in items)
        low_stock_count = sum(
            1 for item in items 
            if 0 < item.get("current_stock", 0) < item.get("reorder_point", 3)
        )
        out_of_stock_count = sum(
            1 for item in items 
            if item.get("current_stock", 0) <= 0
        )
        
        return {
            "success": True,
            "summary": {
                "total_stock_value": round(total_stock_value, 2),
                "low_stock_items": low_stock_count,
                "out_of_stock": out_of_stock_count,
                "total_items": len(items)
            }
        }
        
    except Exception as e:
        logger.error(f"Error getting stock summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history/{part_number}")
async def get_stock_history(
    part_number: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get transaction history for a specific part number.
    Shows all IN (vendor) and OUT (customer) transactions with receipt links.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Get vendor transactions (IN)
        vendor_items = db.client.table("inventory_items")\
            .select("part_number, description, qty, rate, invoice_date, invoice_number, receipt_link")\
            .eq("username", username)\
            .execute()
        
        vendor_data = vendor_items.data or []
        
        # Filter by fuzzy matching part number
        in_transactions = []
        for item in vendor_data:
            item_part = item.get("part_number", "")
            if fuzzy_match_part_numbers(part_number, item_part, threshold=90):
                in_transactions.append({
                    "type": "IN",
                    "date": item.get("invoice_date"),
                    "invoice_number": item.get("invoice_number"),
                    "description": item.get("description"),
                    "quantity": float(item.get("qty", 0) or 0),
                    "rate": item.get("rate"),
                    "amount": float(item.get("qty", 0) or 0) * float(item.get("rate", 0) or 0),
                    "receipt_link": item.get("receipt_link")
                })
        
        # Get customer transactions (OUT) using same logic as stock calculation
          # Get mappings where vendor part number matches this part (98% threshold)
        mappings = db.client.table("vendor_mapping_entries")\
            .select("customer_item_name, part_number")\
            .eq("username", username)\
            .eq("status", "Added")\
            .execute()
        
        mapping_data = mappings.data or []
        customer_items_for_part = []
        
        for mapping in mapping_data:
            vendor_part = mapping.get("part_number")
            customer_item = mapping.get("customer_item_name")
            
            if vendor_part and customer_item:
                # Use 98% threshold for part number matching (same as stock calculation)
                if fuzzy_match_part_numbers(part_number, vendor_part, threshold=98):
                    customer_items_for_part.append(customer_item)
        
        # Step 2: Get ALL sales transactions using pagination
        all_sales_data = []
        batch_size = 1000
        current_offset = 0
        
        logger.info(f"VIEW HISTORY: Fetching ALL sales records for {username} with pagination...")
        
        while True:
            sales_batch = db.client.table("verified_invoices")\
                .select("description, quantity, rate, date, receipt_number, receipt_link, type")\
                .eq("username", username)\
                .limit(batch_size)\
                .offset(current_offset)\
                .execute()
            
            if not sales_batch.data or len(sales_batch.data) == 0:
                break
            
            all_sales_data.extend(sales_batch.data)
            
            # If we got less than batch_size records, we've reached the end
            if len(sales_batch.data) < batch_size:
                break
            
            current_offset += batch_size
        
        # Filter by type='Part'
        all_sales_data = [s for s in all_sales_data if s.get("type") == "Part"]
        
        # Step 3: Match sales to customer_items using 90% fuzzy threshold
        out_transactions = []
        
        for item in all_sales_data:
            customer_desc = item.get("description", "")
            if not customer_desc:
                continue
            
            # Debug logging for receipt 801
            if item.get("receipt_number") == "801":
                logger.info(f"DEBUG 801: Processing - description='{customer_desc}'")
                logger.info(f"DEBUG 801: Will compare against customer_items: {customer_items_for_part}")
            
            # Check fuzzy match (90% threshold) against all mapped customer items
            for customer_item in customer_items_for_part:
                similarity = fuzz.ratio(customer_desc.lower(), customer_item.lower())
                
                # Debug for receipt 801
                if item.get("receipt_number") == "801":
                    logger.info(f"DEBUG 801: '{customer_desc}' vs '{customer_item}' = {similarity}% (need 90%)")
                
                if similarity >= 90:
                    # Add this transaction (allow duplicates with same description but different dates/quantities)
                    out_transactions.append({
                        "type": "OUT",
                        "date": item.get("date"),
                        "invoice_number": item.get("receipt_number"),
                        "description": customer_desc,
                        "quantity": float(item.get("quantity", 0) or 0),
                        "rate": item.get("rate"),
                        "amount": float(item.get("quantity", 0) or 0) * float(item.get("rate", 0) or 0),
                        "receipt_link": item.get("receipt_link")
                    })
                    break  # Found a match, no need to check other customer_items

        
        # Combine and sort by date (most recent first)
        all_transactions = in_transactions + out_transactions
        all_transactions.sort(key=lambda x: x.get("date") or "", reverse=True)
        
        logger.info(f"Found {len(in_transactions)} IN and {len(out_transactions)} OUT transactions for {part_number}")
        
        return {
            "success": True,
            "part_number": part_number,
            "transactions": all_transactions,
            "summary": {
                "total_in": sum(t["quantity"] for t in in_transactions),
                "total_out": sum(t["quantity"] for t in out_transactions),
                "transaction_count": len(all_transactions)
            }
        }
        
    except Exception as e:
        logger.error(f"Error getting stock history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/calculate")
async def calculate_stock_levels(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Recalculate all stock levels from existing inventory and sales data.
    This is a comprehensive recalculation that processes all data.
    """
    username = current_user.get("username")
    
    try:
        recalculate_stock_for_user(username)
        
        return {
            "success": True,
            "message": "Stock levels recalculated successfully"
        }
        
    except Exception as e:
        logger.error(f"Error calculating stock levels: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def recalculate_stock_for_user(username: str):
    """
    Core logic to recalculate stock levels for a user.
    Can be called from other routes after invoice processing.
    """
    db = get_database_client()
    
    logger.info(f"Starting stock recalculation for {username}")
    
    # 1. Get all vendor invoice items (IN transactions)
    vendor_items = db.client.table("inventory_items")\
        .select("part_number, description, qty, rate, invoice_date")\
        .eq("username", username)\
        .execute()
    
    vendor_data = vendor_items.data or []
    logger.info(f"Found {len(vendor_data)} vendor invoice items")
    
    # 2. Get ALL customer sales items (OUT transactions) using pagination
    sales_data = []
    batch_size = 1000
    current_offset = 0
    
    logger.info(f"Fetching ALL sales records for {username} with pagination...")
    
    while True:
        sales_batch = db.client.table("verified_invoices")\
            .select("description, quantity, rate, date")\
            .eq("username", username)\
            .eq("type", "Part")\
            .limit(batch_size)\
            .offset(current_offset)\
            .execute()
        
        if not sales_batch.data or len(sales_batch.data) == 0:
            break
        
        sales_data.extend(sales_batch.data)
        
        # If we got less than batch_size records, we've reached the end
        if len(sales_batch.data) < batch_size:
            break
        
        current_offset += batch_size
    
    logger.info(f"Found {len(sales_data)} sales invoice items")
    
    # 3. Get inventory mappings (customer item -> vendor item)
    mappings = db.client.table("vendor_mapping_entries")\
        .select("customer_item_name, part_number, vendor_description")\
        .eq("username", username)\
        .eq("status", "Added")\
        .execute()
    
    mapping_data = mappings.data or []
    logger.info(f"Found {len(mapping_data)} inventory mappings")
    
    # Create mapping lookup (use default reorder point of 3)
    customer_to_vendor = {}
    for mapping in mapping_data:
        customer_item = mapping.get("customer_item")
        vendor_part = mapping.get("vendor_part_number")
        if customer_item and vendor_part:
            customer_to_vendor[customer_item] = vendor_part
    
    # 4. Group vendor items by part number
    stock_by_part = {}
    
    for item in vendor_data:
        part_num = item.get("part_number")
        if not part_num:
            continue
        
        # Normalize for grouping
        normalized_part = normalize_part_number(part_num)
        
        # Find existing group with fuzzy match
        matched_group = None
        for existing_part in stock_by_part.keys():
            if fuzzy_match_part_numbers(part_num, existing_part, threshold=90):
                matched_group = existing_part
                break
        
        group_key = matched_group or part_num
        
        if group_key not in stock_by_part:
            stock_by_part[group_key] = {
                "part_number": group_key,
                "internal_item_name": item.get("description", ""),
                "vendor_description": item.get("description", ""),
                "total_in": 0,
                "total_out": 0,
                "vendor_rate": item.get("rate"),
                "customer_rate": None,
                "last_vendor_invoice_date": item.get("invoice_date"),
                "last_customer_invoice_date": None,
                "reorder_point": 3  # Default reorder point
            }
        
        stock_by_part[group_key]["total_in"] += float(item.get("qty", 0) or 0)
        
        # Update latest rate and date
        if item.get("invoice_date"):
            existing_date = stock_by_part[group_key]["last_vendor_invoice_date"]
            if not existing_date or item["invoice_date"] > existing_date:
                stock_by_part[group_key]["last_vendor_invoice_date"] = item["invoice_date"]
                stock_by_part[group_key]["vendor_rate"] = item.get("rate")
    
    # 5. Process sales items (OUT transactions) using proper 3-table join
    # Build a comprehensive mapping structure first
    # For each part_number in stock_by_part, find customer_items via 98% fuzzy match
    part_to_customer_items = {}  # part_number -> [customer_items]
    
    for part_number in stock_by_part.keys():
        customer_items_for_part = []
        
        # Find mappings where part_number fuzzy matches this part (98% threshold)
        for mapping in mapping_data:
            vendor_part = mapping.get("part_number")
            customer_item = mapping.get("customer_item_name")
            
            if vendor_part and customer_item:
                # Use 98% threshold for part number matching
                if fuzzy_match_part_numbers(part_number, vendor_part, threshold=98):
                    customer_items_for_part.append(customer_item)
        
        if customer_items_for_part:
            part_to_customer_items[part_number] = customer_items_for_part
    
    # Now process each sales transaction
    for item in sales_data:
        customer_desc = item.get("description")
        if not customer_desc:
            continue
        
        qty = float(item.get("quantity", 0) or 0)
        
        # For each part, check if this sale matches any of its mapped customer_items
        for part_number, mapped_customer_items in part_to_customer_items.items():
            matched = False
            matched_customer_item = None
            
            # Check fuzzy match (90% threshold) against all mapped customer items
            for customer_item in mapped_customer_items:
                similarity = fuzz.ratio(customer_desc.lower(), customer_item.lower())
                if similarity >= 90:
                    matched = True
                    matched_customer_item = customer_item
                    break
            
            if matched:
                # Add to total_out
                stock_by_part[part_number]["total_out"] += qty
                
                # Track customer items that were actually sold
                if "customer_items" not in stock_by_part[part_number]:
                    stock_by_part[part_number]["customer_items"] = []
                
                # Only add if not already in list (distinct customer items)
                if matched_customer_item not in stock_by_part[part_number]["customer_items"]:
                    stock_by_part[part_number]["customer_items"].append(matched_customer_item)
                
                # Update customer rate and date
                if item.get("date"):
                    existing_date = stock_by_part[part_number]["last_customer_invoice_date"]
                    if not existing_date or item["date"] > existing_date:
                        stock_by_part[part_number]["last_customer_invoice_date"] = item["date"]
                        stock_by_part[part_number]["customer_rate"] = item.get("rate")

    
    # 6. Calculate current stock and values
    stock_records = []
    now = datetime.now().isoformat()
    
    for part, data in stock_by_part.items():
        current_stock = data["total_in"] - data["total_out"]
        unit_value = data.get("vendor_rate") or 0
        total_value = current_stock * unit_value
        
        # Create a comma-separated string of customer items (or None if no mappings)
        customer_items_str = ", ".join(data.get("customer_items", [])) if data.get("customer_items") else None
        
        stock_records.append({
            "username": username,
            "part_number": part,
            "internal_item_name": data["internal_item_name"],
            "vendor_description": data["vendor_description"],
            "customer_items": customer_items_str,  # Linked Items from mapping
            "current_stock": round(current_stock, 2),
            "total_in": round(data["total_in"], 2),
            "total_out": round(data["total_out"], 2),
            "reorder_point": data["reorder_point"],
            "vendor_rate": data.get("vendor_rate"),
            "customer_rate": data.get("customer_rate"),
            "unit_value": unit_value,
            "total_value": round(total_value, 2),
            "last_vendor_invoice_date": data.get("last_vendor_invoice_date"),
            "last_customer_invoice_date": data.get("last_customer_invoice_date"),
            "updated_at": now
        })
    
    # 7. Clear existing stock levels and insert new ones
    if stock_records:
        # Delete existing
        db.client.table("stock_levels").delete().eq("username", username).execute()
        
        # Batch insert new records
        db.batch_upsert("stock_levels", stock_records, batch_size=500)
        
        logger.info(f"✅ Recalculated {len(stock_records)} stock levels for {username}")
    else:
        logger.warning(f"No stock records calculated for {username}")


@router.patch("/levels/{stock_id}")
async def update_stock_level(
    stock_id: int,
    updates: StockUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update stock level fields (inline editing).
    Only allows editing reorder_point and unit_value.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        update_data = {}
        
        if updates.reorder_point is not None:
            if updates.reorder_point < 0:
                raise HTTPException(status_code=400, detail="Reorder point must be >= 0")
            update_data["reorder_point"] = updates.reorder_point
        
        if updates.unit_value is not None:
            if updates.unit_value < 0:
                raise HTTPException(status_code=400, detail="Unit value must be >= 0")
            update_data["unit_value"] = updates.unit_value
            update_data["vendor_rate"] = updates.unit_value  # Sync with vendor_rate
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        
        update_data["updated_at"] = datetime.now().isoformat()
        
        # Update the record
        response = db.client.table("stock_levels")\
            .update(update_data)\
            .eq("id", stock_id)\
            .eq("username", username)\
            .execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Stock level not found")
        
        updated_item = response.data[0]
        
        # Recalculate total_value if unit_value was updated
        if "unit_value" in update_data:
            current_stock = updated_item.get("current_stock", 0)
            total_value = current_stock * update_data["unit_value"]
            
            db.client.table("stock_levels")\
                .update({"total_value": round(total_value, 2)})\
                .eq("id", stock_id)\
                .execute()
        
        logger.info(f"Updated stock level ID {stock_id}")
        
        return {
            "success": True,
            "item": updated_item
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating stock level: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/adjust")
async def adjust_stock(
    adjustment: StockAdjustment,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Manual stock adjustment (add, subtract, or set absolute value).
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Validate adjustment type
        if adjustment.adjustment_type not in ["add", "subtract", "set_absolute"]:
            raise HTTPException(
                status_code=400, 
                detail="Invalid adjustment type. Must be 'add', 'subtract', or 'set_absolute'"
            )
        
        # Validate quantity
        if adjustment.quantity < 0:
            raise HTTPException(status_code=400, detail="Quantity must be >= 0")
        
        # Find stock level by part number
        response = db.client.table("stock_levels")\
            .select("*")\
            .eq("username", username)\
            .eq("part_number", adjustment.part_number)\
            .execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail=f"Part number '{adjustment.part_number}' not found")
        
        stock_item = response.data[0]
        current_stock = stock_item.get("current_stock", 0)
        
        # Calculate new stock
        if adjustment.adjustment_type == "add":
            new_stock = current_stock + adjustment.quantity
        elif adjustment.adjustment_type == "subtract":
            new_stock = current_stock - adjustment.quantity
        else:  # set_absolute
            new_stock = adjustment.quantity
        
        # Update stock
        unit_value = stock_item.get("unit_value", 0)
        total_value = new_stock * unit_value
        
        update_data = {
            "current_stock": round(new_stock, 2),
            "total_value": round(total_value, 2),
            "updated_at": datetime.now().isoformat()
        }
        
        db.client.table("stock_levels")\
            .update(update_data)\
            .eq("id", stock_item["id"])\
            .execute()
        
        logger.info(
            f"Manual adjustment: {adjustment.part_number} "
            f"{adjustment.adjustment_type} {adjustment.quantity} "
            f"(Reason: {adjustment.reason or 'Not provided'})"
        )
        
        return {
            "success": True,
            "message": f"Stock adjusted successfully",
            "previous_stock": current_stock,
            "new_stock": new_stock
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adjusting stock: {e}")
        raise HTTPException(status_code=500, detail=str(e))
