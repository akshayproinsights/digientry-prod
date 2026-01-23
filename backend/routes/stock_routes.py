"""
Stock Levels Management Routes
Tracks real-time inventory stock based on vendor purchases and customer sales.
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from fastapi.responses import Response
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import logging
from datetime import datetime
from rapidfuzz import fuzz
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from io import BytesIO

from database import get_database_client
from auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

# ============================================================================
# REORDER POINT CONFIGURATION - CHANGE HERE TO UPDATE DEFAULT
# ============================================================================
DEFAULT_REORDER_POINT = 2  # Change this value to update default for ALL items
# ============================================================================


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
    old_stock: Optional[float] = None
    priority: Optional[str] = None
    customer_items: Optional[str] = None  # Customer item name to update in vendor_mapping_entries


class TransactionUpdate(BaseModel):
    """Update transaction quantities/rates"""
    type: str  # "IN" or "OUT"
    quantity: float
    rate: Optional[float] = None
    amount: Optional[float] = None


class TransactionDelete(BaseModel):
    """Delete transaction"""
    type: str  # "IN" or "OUT"


def normalize_part_number(part_number: str) -> str:
    """Normalize part number for matching (remove spaces, lowercase)"""
    if not part_number:
        return ""
    return part_number.strip().replace(" ", "").replace("-", "").lower()


def fuzzy_match_part_numbers(part1: str, part2: str, threshold: float = 99.0) -> bool:
    """
    Check if two part numbers match with fuzzy logic.
    Uses 99%+ similarity threshold to catch variations.
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
    priority_filter: Optional[str] = Query(None),  # "all", "P0", "P1", "P2", "P3"
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
                items = [item for item in items if 0 < item.get("current_stock", 0) < item.get("reorder_point", DEFAULT_REORDER_POINT)]
            elif status_filter == "in_stock":
                items = [item for item in items if item.get("current_stock", 0) >= item.get("reorder_point", DEFAULT_REORDER_POINT)]
        
        # Apply priority filter (post-query)
        if priority_filter and priority_filter != "all":
            items = [item for item in items if item.get("priority") == priority_filter]
        
        # Add computed status field
        for item in items:
            # Calculate actual on-hand stock (current_stock + old_stock)
            # This matches the frontend display logic
            current = item.get("current_stock", 0)
            old = item.get("old_stock", 0) or 0
            on_hand = current + old
            reorder = item.get("reorder_point", DEFAULT_REORDER_POINT)
            
            if on_hand <= 0:
                item["status"] = "Out of Stock"
            elif on_hand < reorder:
                item["status"] = "Low Stock"
            else:
                item["status"] = "In Stock"
        
        logger.info(f"Retrieved {len(items)} stock levels for {username}")
        
        # Merge with uploaded mapping sheet data
        mapping_sheets_response = db.client.table("vendor_mapping_sheets")\
            .select("part_number, customer_item, old_stock, reorder_point, uploaded_at")\
            .eq("username", username)\
            .eq("status", "completed")\
            .execute()
        
        # Create mapping dict
        mapping_data_dict = {}
        for sheet_row in (mapping_sheets_response.data or []):
            part = sheet_row.get("part_number")
            if part:
                if part not in mapping_data_dict:
                    mapping_data_dict[part] = {
                        "customer_items": [],
                        "old_stock": None,
                        "uploaded_reorder_point": None,
                        "uploaded_at": None
                    }
                
                # Collect customer items
                if sheet_row.get("customer_item"):
                    for cust_item in sheet_row["customer_item"]:
                        if cust_item and cust_item not in mapping_data_dict[part]["customer_items"]:
                            mapping_data_dict[part]["customer_items"].append(cust_item)
                
                # Use most recent values
                if sheet_row.get("old_stock") is not None:
                    mapping_data_dict[part]["old_stock"] = sheet_row["old_stock"]
                if sheet_row.get("reorder_point") is not None:
                    mapping_data_dict[part]["uploaded_reorder_point"] = sheet_row["reorder_point"]
                if sheet_row.get("uploaded_at"):
                    mapping_data_dict[part]["uploaded_at"] = sheet_row["uploaded_at"]
        
        # Merge mapping data into stock levels
        for item in items:
            part_num = item.get("part_number")
            if part_num in mapping_data_dict:
                mapping = mapping_data_dict[part_num]
                
                item["old_stock"] = mapping["old_stock"]
                item["customer_items_array"] = mapping["customer_items"]
                
                if mapping["uploaded_reorder_point"] is not None:
                    item["uploaded_reorder_point"] = mapping["uploaded_reorder_point"]
                
                item["has_uploaded_data"] = True
                item["uploaded_at"] = mapping["uploaded_at"]
        
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
        
        # Count items using on_hand (current_stock + old_stock) vs reorder_point
        low_stock_count = sum(
            1 for item in items 
            if 0 < (item.get("current_stock", 0) + (item.get("old_stock", 0) or 0)) < item.get("reorder_point", DEFAULT_REORDER_POINT)
        )
        out_of_stock_count = sum(
            1 for item in items 
            if (item.get("current_stock", 0) + (item.get("old_stock", 0) or 0)) <= 0
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
        # Get vendor transactions (IN) - include ID for editing
        vendor_items = db.client.table("inventory_items")\
            .select("id, part_number, description, qty, rate, invoice_date, invoice_number, receipt_link")\
            .eq("username", username)\
            .execute()
        
        vendor_data = vendor_items.data or []
        
        # Filter by fuzzy matching part number
        in_transactions = []
        for item in vendor_data:
            item_part = item.get("part_number", "")
            if fuzzy_match_part_numbers(part_number, item_part, threshold=99):
                in_transactions.append({
                    "id": item.get("id"),  # Include ID for editing
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
                .select("id, description, quantity, rate, date, receipt_number, receipt_link, type")\
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
                        "id": item.get("id"),  # Include ID for editing
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
        
        # Get old stock from stock_levels table
        old_stock = None
        stock_level = db.client.table("stock_levels")\
            .select("old_stock")\
            .eq("username", username)\
            .eq("part_number", part_number)\
            .execute()
        
        if stock_level.data and len(stock_level.data) > 0:
            old_stock = stock_level.data[0].get("old_stock")
        
        logger.info(f"Found {len(in_transactions)} IN and {len(out_transactions)} OUT transactions for {part_number}")
        
        return {
            "success": True,
            "part_number": part_number,
            "transactions": all_transactions,
            "summary": {
                "total_in": sum(t["quantity"] for t in in_transactions),
                "total_out": sum(t["quantity"] for t in out_transactions),
                "transaction_count": len(all_transactions),
                "old_stock": old_stock
            }
        }
        
    except Exception as e:
        logger.error(f"Error getting stock history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/transaction/{transaction_id}")
async def update_transaction(
    transaction_id: str,
    updates: TransactionUpdate,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update a transaction (IN or OUT) and recalculate stock levels.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Validate inputs
        if updates.quantity < 0:
            raise HTTPException(status_code=400, detail="Quantity must be >= 0")
        if updates.rate is not None and updates.rate < 0:
            raise HTTPException(status_code=400, detail="Rate must be >= 0")
        
        # Update appropriate table based on type
        if updates.type == "IN":
            # Update inventory_items table
            update_data = {"qty": updates.quantity}
            if updates.rate is not None:
                update_data["rate"] = updates.rate
            
            response = db.client.table("inventory_items")\
                .update(update_data)\
                .eq("id", transaction_id)\
                .eq("username", username)\
                .execute()
            
            if not response.data:
                raise HTTPException(status_code=404, detail="Transaction not found")
            
            logger.info(f"Updated IN transaction #{transaction_id}: qty={updates.quantity}, rate={updates.rate}")
            
        elif updates.type == "OUT":
            # Update verified_invoices table
            update_data = {"quantity": updates.quantity}
            if updates.rate is not None:
                update_data["rate"] = updates.rate
            
            response = db.client.table("verified_invoices")\
                .update(update_data)\
                .eq("id", transaction_id)\
                .eq("username", username)\
                .execute()
            
            if not response.data:
                raise HTTPException(status_code=404, detail="Transaction not found")
            
            logger.info(f"Updated OUT transaction #{transaction_id}: qty={updates.quantity}, rate={updates.rate}")
        else:
            raise HTTPException(status_code=400, detail="Invalid transaction type. Must be 'IN' or 'OUT'")
        
        # Trigger stock recalculation
        recalculate_stock_for_user(username)
        
        return {
            "success": True,
            "message": "Transaction updated and stock levels recalculated"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating transaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/transaction/{transaction_id}")
async def delete_transaction(
    transaction_id: str,
    delete_request: TransactionDelete,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete a transaction (IN or OUT) and recalculate stock levels.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Delete from appropriate table based on type
        if delete_request.type == "IN":
            # Delete from inventory_items table
            response = db.client.table("inventory_items")\
                .delete()\
                .eq("id", transaction_id)\
                .eq("username", username)\
                .execute()
            
            if not response.data:
                raise HTTPException(status_code=404, detail="Transaction not found")
            
            logger.info(f"Deleted IN transaction #{transaction_id}")
            
        elif delete_request.type == "OUT":
            # Delete from verified_invoices table
            response = db.client.table("verified_invoices")\
                .delete()\
                .eq("id", transaction_id)\
                .eq("username", username)\
                .execute()
            
            if not response.data:
                raise HTTPException(status_code=404, detail="Transaction not found")
            
            logger.info(f"Deleted OUT transaction #{transaction_id}")
        else:
            raise HTTPException(status_code=400, detail="Invalid transaction type. Must be 'IN' or 'OUT'")
        
        # Trigger stock recalculation
        recalculate_stock_for_user(username)
        
        return {
            "success": True,
            "message": "Transaction deleted and stock levels recalculated"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting transaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/mapping/{part_number}")
async def delete_vendor_mapping(
    part_number: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete vendor mapping for a part number.
    Removes from vendor_mapping_sheets and triggers stock recalculation.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Delete from vendor_mapping_sheets
        result = db.client.table("vendor_mapping_sheets")\
            .delete()\
            .eq("username", username)\
            .eq("part_number", part_number)\
            .execute()
        
        logger.info(f"Deleted mapping for {part_number} (username: {username}, deleted {len(result.data)} rows)")
        
        # Trigger stock recalculation
        recalculate_stock_for_user(username)
        
        return {
            "success": True,
            "message": f"Mapping deleted for {part_number}"
        }
    except Exception as e:
        logger.error(f"Error deleting mapping: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/item/{part_number}")
async def delete_stock_item(
    part_number: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete a stock item completely from the stock register.
    Removes from stock_levels and vendor_mapping_entries tables,
    and marks corresponding inventory items as excluded to prevent
    them from reappearing during stock recalculation.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # 1. Mark inventory items as excluded (prevents reappearing during recalculation)
        exclusion_result = db.client.table("inventory_items")\
            .update({"excluded_from_stock": True})\
            .eq("username", username)\
            .eq("part_number", part_number)\
            .execute()
        
        excluded_count = len(exclusion_result.data) if exclusion_result.data else 0
        logger.info(f"Marked {excluded_count} inventory_items as excluded for part {part_number}")
        
        # 2. Delete from stock_levels table
        stock_result = db.client.table("stock_levels")\
            .delete()\
            .eq("username", username)\
            .eq("part_number", part_number)\
            .execute()
        
        stock_deleted = len(stock_result.data) if stock_result.data else 0
        logger.info(f"Deleted {stock_deleted} stock_levels records for part {part_number}")
        
        # 3. Delete from vendor_mapping_entries table
        mapping_result = db.client.table("vendor_mapping_entries")\
            .delete()\
            .eq("username", username)\
            .eq("part_number", part_number)\
            .execute()
        
        mapping_deleted = len(mapping_result.data) if mapping_result.data else 0
        logger.info(f"Deleted {mapping_deleted} vendor_mapping_entries for part {part_number}")
        
        # 4. Also delete from vendor_mapping_sheets if exists
        sheet_result = db.client.table("vendor_mapping_sheets")\
            .delete()\
            .eq("username", username)\
            .eq("part_number", part_number)\
            .execute()
        
        sheet_deleted = len(sheet_result.data) if sheet_result.data else 0
        if sheet_deleted > 0:
            logger.info(f"Deleted {sheet_deleted} vendor_mapping_sheets for part {part_number}")
        
        total_deleted = stock_deleted + mapping_deleted + sheet_deleted
        
        if total_deleted == 0 and excluded_count == 0:
            raise HTTPException(status_code=404, detail=f"Stock item {part_number} not found")
        
        logger.info(f"✅ Successfully deleted stock item {part_number} (excluded {excluded_count}, deleted {total_deleted} records)")
        
        return {
            "success": True,
            "message": f"Stock item '{part_number}' deleted successfully",
            "deleted_count": total_deleted,
            "excluded_count": excluded_count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting stock item: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/items/bulk")
async def delete_stock_items_bulk(
    request: Request,
    db_client=Depends(get_database_client),
    current_user: Dict = Depends(get_current_user)
):
    """
    Delete multiple stock items by their part numbers.
    Deletes from stock_levels, vendor_mapping_entries, and vendor_mapping_sheets tables,
    and marks corresponding inventory items as excluded to prevent reappearing.
    """
    try:
        body = await request.json()
        part_numbers = body.get("part_numbers", [])
        
        if not part_numbers:
            raise HTTPException(status_code=400, detail="No part numbers provided")
        
        username = current_user.get("username")  # Fixed: was using "email" instead of "username"
        db = db_client
        total_deleted = 0
        total_excluded = 0
        
        for part_number in part_numbers:
            try:
                # 1. Mark inventory items as excluded
                exclusion_result = db.client.table("inventory_items")\
                    .update({"excluded_from_stock": True})\
                    .eq("username", username)\
                    .eq("part_number", part_number)\
                    .execute()
                
                excluded_count = len(exclusion_result.data) if exclusion_result.data else 0
                total_excluded += excluded_count
                if excluded_count > 0:
                    logger.info(f"Marked {excluded_count} inventory_items as excluded for part {part_number}")
                
                # 2. Delete from stock_levels
                stock_result = db.client.table("stock_levels")\
                    .delete()\
                    .eq("username", username)\
                    .eq("part_number", part_number)\
                    .execute()
                
                stock_deleted = len(stock_result.data) if stock_result.data else 0
                logger.info(f"Deleted {stock_deleted} stock_levels records for part {part_number}")
                
                # 3. Delete from vendor_mapping_entries
                mapping_result = db.client.table("vendor_mapping_entries")\
                    .delete()\
                    .eq("username", username)\
                    .eq("part_number", part_number)\
                    .execute()
                
                mapping_deleted = len(mapping_result.data) if mapping_result.data else 0
                if mapping_deleted > 0:
                    logger.info(f"Deleted {mapping_deleted} vendor_mapping_entries for part {part_number}")
                
                # 4. Delete from vendor_mapping_sheets
                sheet_result = db.client.table("vendor_mapping_sheets")\
                    .delete()\
                    .eq("username", username)\
                    .eq("part_number", part_number)\
                    .execute()
                
                sheet_deleted = len(sheet_result.data) if sheet_result.data else 0
                if sheet_deleted > 0:
                    logger.info(f"Deleted {sheet_deleted} vendor_mapping_sheets for part {part_number}")
                
                item_total = stock_deleted + mapping_deleted + sheet_deleted
                total_deleted += item_total
                logger.info(f"✅ Deleted stock item {part_number} (excluded {excluded_count}, deleted {item_total} records)")
                
            except Exception as item_error:
                logger.error(f"Error deleting item {part_number}: {item_error}")
                # Continue with other items even if one fails
        
        return {
            "success": True,
            "message": f"Successfully deleted {len(part_numbers)} stock item(s)",
            "deleted_count": len(part_numbers),
            "total_records_deleted": total_deleted,
            "total_excluded": total_excluded
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during bulk stock delete: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete stock items: {str(e)}")




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
    
    # 1. Get all vendor invoice items (IN transactions) - EXCLUDING items marked as deleted
    vendor_items = db.client.table("inventory_items")\
        .select("part_number, description, qty, rate, invoice_date")\
        .eq("username", username)\
        .eq("excluded_from_stock", False)\
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
    
    # 4. GET EXISTING STOCK LEVELS TO PRESERVE MANUAL EDITS
    existing_stock_levels = db.client.table("stock_levels")\
        .select("part_number, internal_item_name, reorder_point, old_stock, priority")\
        .eq("username", username)\
        .execute()
    
    # Build lookup dict: (part_number, internal_item_name) -> {reorder_point, old_stock, priority}
    # NOTE: customer_items is NOT preserved here - it comes from vendor_mapping_entries
    existing_values = {}
    for stock in (existing_stock_levels.data or []):
        key = (stock.get("part_number"), stock.get("internal_item_name"))
        existing_values[key] = {
            "reorder_point": stock.get("reorder_point"),
            "old_stock": stock.get("old_stock"),
            "priority": stock.get("priority")
        }
    
    logger.info(f"Found {len(existing_values)} existing stock levels to preserve")
    
    # Create mapping lookup (use default reorder point of 3)
    customer_to_vendor = {}
    for mapping in mapping_data:
        customer_item = mapping.get("customer_item_name") # Corrected from 'customer_item'
        vendor_part = mapping.get("part_number") # Corrected from 'vendor_part_number'
        if customer_item and vendor_part:
            customer_to_vendor[customer_item] = vendor_part
    
    
    # 4. Initialize stock_by_part with MAPPINGS FIRST (map once, use forever)
    # This ensures mappings persist even when vendor invoices are deleted
    stock_by_part = {}
    
    logger.info(f"🔷 Step 1: Initializing stock_by_part with {len(mapping_data)} mappings")
    
    for mapping in mapping_data:
        part_number = mapping.get("part_number")
        vendor_desc = mapping.get("vendor_description")
        customer_item = mapping.get("customer_item_name")
        
        if not part_number or not vendor_desc:
            continue
        
        # Find existing group with fuzzy match (same logic as before)
        matched_group = None
        for existing_part in stock_by_part.keys():
            if fuzzy_match_part_numbers(part_number, existing_part, threshold=99):
                matched_group = existing_part
                break
        
        group_key = matched_group or part_number
        
        if group_key not in stock_by_part:
            # Create entry with mapping data, zero transactional data
            stock_by_part[group_key] = {
                "part_number": group_key,
                "internal_item_name": vendor_desc,
                "vendor_description": vendor_desc,
                "total_in": 0.0,  # Will be filled from vendor invoices
                "total_out": 0.0,  # Will be filled from sales
                "customer_items": [],
                "vendor_rate": None,  # Will be filled from vendor invoices
                "customer_rate": None,
                "last_vendor_invoice_date": None,
                "last_customer_invoice_date": None,
                "reorder_point": DEFAULT_REORDER_POINT
            }
        
        # Add customer item if not already in list
        if customer_item and customer_item not in stock_by_part[group_key]["customer_items"]:
            stock_by_part[group_key]["customer_items"].append(customer_item)
    
    logger.info(f"🔷 Step 2: Filling IN transactions from {len(vendor_data)} vendor invoices")
    
    # 5. Fill IN transactions from vendor invoices (if any exist)
    for item in vendor_data:
        part_number = item.get("part_number", "")
        internal_item_name = item.get("description", "")
        
        if not part_number:
            continue
        
        # Find existing group with fuzzy match
        matched_group = None
        for existing_part in stock_by_part.keys():
            if fuzzy_match_part_numbers(part_number, existing_part, threshold=99):
                matched_group = existing_part
                break
        
        group_key = matched_group or part_number
        
        # If this part doesn't have a mapping, create entry from vendor invoice
        if group_key not in stock_by_part:
            stock_by_part[group_key] = {
                "part_number": group_key,
                "internal_item_name": internal_item_name,
                "vendor_description": internal_item_name,
                "total_in": 0.0,
                "total_out": 0.0,
                "customer_items": [],
                "vendor_rate": item.get("rate"),
                "customer_rate": None,
                "last_vendor_invoice_date": item.get("invoice_date"),
                "last_customer_invoice_date": None,
                "reorder_point": DEFAULT_REORDER_POINT
            }
        
        # Fill in transactional data
        stock_by_part[group_key]["total_in"] += float(item.get("qty", 0) or 0)
        
        # Update vendor_description if it was created from mapping without invoice
        if not stock_by_part[group_key].get("internal_item_name"):
            stock_by_part[group_key]["internal_item_name"] = internal_item_name
            stock_by_part[group_key]["vendor_description"] = internal_item_name
        
        # Update latest rate and date
        if item.get("invoice_date"):
            existing_date = stock_by_part[group_key]["last_vendor_invoice_date"]
            if not existing_date or item["invoice_date"] > existing_date:
                stock_by_part[group_key]["last_vendor_invoice_date"] = item["invoice_date"]
                stock_by_part[group_key]["vendor_rate"] = item.get("rate")
    
    # 6. Build part_to_customer_items mapping ONCE (optimize from O(n²) to O(n))
    # For each part_number in stock_by_part, find customer_items via 98% fuzzy match
    part_to_customer_items = {}  # part_number -> [customer_items]
    
    logger.info(f"🔷 Step 3: Building part-to-customer mapping for {len(stock_by_part)} parts")
    
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
    
    logger.info(f"🔷 Step 4: Processing {len(sales_data)} sales transactions")
    
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

    
    # 7. Calculate current stock and values
    stock_records = []
    now = datetime.now().isoformat()
    
    for part, data in stock_by_part.items():
        current_stock = data["total_in"] - data["total_out"]
        
        # Check if this item has existing manual edits to preserve
        lookup_key = (part, data["internal_item_name"])
        preserved = existing_values.get(lookup_key, {})
        
        # Use preserved values if they exist, otherwise use defaults
        reorder_point = preserved.get("reorder_point") if preserved.get("reorder_point") is not None else data["reorder_point"]
        old_stock = preserved.get("old_stock") if preserved.get("old_stock") is not None else None
        priority = preserved.get("priority")
        
        # customer_items comes ONLY from vendor_mapping_entries (single source of truth)
        # Already populated in data["customer_items"] from Step 1 (initialization with mappings)
        customer_items_str = ", ".join(data.get("customer_items", [])) if data.get("customer_items") else None
        
        # Calculate ACTUAL ON HAND (including old_stock for value calculation)
        stock_on_hand = current_stock + (old_stock or 0)
        
        # Calculate value using ON HAND (not just current_stock)
        unit_value = data.get("vendor_rate") or 0
        total_value = stock_on_hand * unit_value
        
        stock_records.append({
            "username": username,
            "part_number": part,
            "internal_item_name": data["internal_item_name"],
            "vendor_description": data["vendor_description"],
            "customer_items": customer_items_str,  # PRESERVED from existing or mapping
            "current_stock": round(current_stock, 2),
            "total_in": round(data["total_in"], 2),
            "total_out": round(data["total_out"], 2),
            "reorder_point": reorder_point,  # PRESERVED from existing or default
            "old_stock": old_stock,  # PRESERVED from existing
            "priority": priority, # PRESERVED
            "vendor_rate": data.get("vendor_rate"),
            "customer_rate": data.get("customer_rate"),
            "unit_value": unit_value,
            "total_value": round(total_value, 2),  # Now includes old_stock
            "last_vendor_invoice_date": data.get("last_vendor_invoice_date"),
            "last_customer_invoice_date": data.get("last_customer_invoice_date"),
            "updated_at": now
        })
    
    # 8. Add orphaned items (exist in stock_levels but have no transactions)
    # These are items uploaded from mapping sheets that haven't been purchased/sold yet
    processed_parts = set(stock_by_part.keys())
    
    for existing_item in (existing_stock_levels.data or []):
        part_num = existing_item.get("part_number")
        internal_name = existing_item.get("internal_item_name")
        
        # If this part wasn't processed (no transactions), preserve it
        if part_num and part_num not in processed_parts:
            stock_records.append({
                "username": username,
                "part_number": part_num,
                "internal_item_name": internal_name or "Unknown Item",
                "vendor_description": existing_item.get("vendor_description") or internal_name or "Unknown Item",
                "customer_items": existing_item.get("customer_items"),
                "current_stock": 0,  # No transactions yet
                "total_in": 0,
                "total_out": 0,
                "reorder_point": existing_item.get("reorder_point") or DEFAULT_REORDER_POINT,
                "old_stock": existing_item.get("old_stock"),
                "priority": existing_item.get("priority"),
                "vendor_rate": None,
                "customer_rate": None,
                "unit_value": 0,
                "total_value": 0,
                "last_vendor_invoice_date": None,
                "last_customer_invoice_date": None,
                "updated_at": now
            })
            logger.info(f"🔄 Preserved orphaned item: {part_num} (no transactions)")
    
    # 9. Clear existing stock levels and insert new ones
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
        
        if updates.old_stock is not None:
            if updates.old_stock < 0:
                raise HTTPException(status_code=400, detail="Old stock must be >= 0")
            update_data["old_stock"] = updates.old_stock
        
        if updates.priority is not None:
            update_data["priority"] = updates.priority
        
        # Handle customer_items update - goes to vendor_mapping_entries, not stock_levels
        if updates.customer_items is not None:
            # Get part_number and internal_item_name from stock_levels
            stock_record = db.client.table("stock_levels")\
                .select("part_number, internal_item_name")\
                .eq("id", stock_id)\
                .eq("username", username)\
                .execute()
            
            if stock_record.data:
                part_number = stock_record.data[0].get("part_number")
                internal_item_name = stock_record.data[0].get("internal_item_name")
                
                # Check if mapping exists in vendor_mapping_entries
                existing_mapping = db.client.table("vendor_mapping_entries")\
                    .select("id")\
                    .eq("username", username)\
                    .eq("part_number", part_number)\
                    .execute()
                
                if existing_mapping.data:
                    # UPDATE existing mapping
                    db.client.table("vendor_mapping_entries")\
                        .update({
                            "customer_item_name": updates.customer_items,
                            "updated_at": datetime.now().isoformat()
                        })\
                        .eq("username", username)\
                        .eq("part_number", part_number)\
                        .execute()
                    logger.info(f"Updated customer_item mapping for {part_number} → {updates.customer_items}")
                else:
                    # CREATE new mapping
                    db.client.table("vendor_mapping_entries")\
                        .insert({
                            "username": username,
                            "part_number": part_number,
                            "vendor_description": internal_item_name,
                            "customer_item_name": updates.customer_items,
                            "status": "Added",
                            "created_at": datetime.now().isoformat(),
                            "updated_at": datetime.now().isoformat()
                        })\
                        .execute()
                    logger.info(f"Created customer_item mapping for {part_number} → {updates.customer_items}")
                
                # Also update stock_levels.customer_items for immediate display
                update_data["customer_items"] = updates.customer_items
        
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


@router.get("/export-unmapped-pdf")
async def export_unmapped_stock_pdf(
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Export only unmapped stock items (where customer_items is NULL or empty) to PDF.
    Uses same format asexisting vendor invoice PDFs.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Get all stock levels with optional search filter
        query = db.client.table("stock_levels")\
            .select("*")\
            .eq("username", username)
        
        # Apply search filter if provided
        if search:
            query = query.or_(
                f"internal_item_name.ilike.%{search}%,"
                f"part_number.ilike.%{search}%,"
                f"vendor_description.ilike.%{search}%"
            )
        
        query = query.order("part_number")
        response = query.execute()
        
        items = response.data or []
        
        # Filter to only unmapped items (customer_items is NULL or empty)
        unmapped_items = [
            item for item in items 
            if not item.get("customer_items") or item.get("customer_items").strip() == ""
        ]
        
        # Apply status filter if provided
        if status_filter and status_filter != "all":
            if status_filter == "out_of_stock":
                unmapped_items = [item for item in unmapped_items if item.get("current_stock", 0) <= 0]
            elif status_filter == "low_stock":
                unmapped_items = [item for item in unmapped_items if 0 < item.get("current_stock", 0) < item.get("reorder_point", DEFAULT_REORDER_POINT)]
            elif status_filter == "in_stock":
                unmapped_items = [item for item in unmapped_items if item.get("current_stock", 0) >= item.get("reorder_point", DEFAULT_REORDER_POINT)]
        
        if not unmapped_items:
            raise HTTPException(
                status_code=404, 
                detail="No unmapped items found matching the filters"
            )
        
        # Create PDF in memory - PORTRAIT orientation with proper spacing
        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,  # Portrait letter (8.5" x 11")
            rightMargin=20,
            leftMargin=20,
            topMargin=30,
            bottomMargin=30
        )
        
        # Container for PDF elements
        elements = []
        
        # Styles
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=18,
            textColor=colors.HexColor('#1f2937'),
            spaceAfter=20,
            alignment=TA_CENTER
        )
        
        
        # Title
        title = Paragraph("<b>Vendor Mapping Sheet</b>", title_style)
        elements.append(title)
        
        # Date and instructions
        date_text = f"Generated: {datetime.now().strftime('%m/%d/%Y')}"
        date = Paragraph(date_text, styles['Normal'])
        elements.append(date)
        
        instructions = Paragraph("Fill in Customer Item, Stock, and Reorder columns by hand", styles['Normal'])
        elements.append(instructions)
        
        # Priority explanation for Indian SMB users
        priority_note = Paragraph(
            "<b>Priority Guide:</b> P0 = Most Important (order first), "
            "P1 = High Priority, P2 = Medium Priority, P3 = Low Priority",
            styles['Normal']
        )
        elements.append(priority_note)
        elements.append(Spacer(1, 0.3*inch))
        
        # Table data
        table_data = [
            ['#', 'Vendor Description', 'Part Number', 'Customer Item', 'Priority', 'Stock', 'Reorder']
        ]

        for idx, item in enumerate(unmapped_items, 1):
            table_data.append([
                str(idx),
                item.get('internal_item_name', ''),
                item.get('part_number', ''),
                '',  # Customer Item - BLANK for manual entry
                item.get('priority', ''),  # Priority
                '',  # Stock - BLANK for manual entry
                ''   # Reorder - BLANK for manual entry
            ])

        # Create table with optimized column widths for PORTRAIT orientation
        # Total width: ~7.5" (letter width 8.5" - 1" margins)
        # Widths: # (0.3"), Vendor Desc (2.5"), Part# (1.0") [reduced 20%], Customer (2.2"), Priority (0.6"), Stock (0.6"), Reorder (0.6")
        from reportlab.platypus import Paragraph as PDFParagraph
        from reportlab.lib.styles import getSampleStyleSheet as getStyles
        
        # Wrap long vendor descriptions
        cell_style = getStyles()['Normal']
        cell_style.fontSize = 9
        cell_style.leading = 10
        
        wrapped_data = [table_data[0]]  # Header row
        for row in table_data[1:]:
            wrapped_row = [
                row[0],  # # - plain text
                PDFParagraph(row[1], cell_style),  # Vendor Description - wrapped
                row[2],  # Part Number - plain text
                row[3],  # Customer Item - blank
                row[4],  # Priority
                row[5],  # Stock - blank
                row[6]   # Reorder - blank
            ]
            wrapped_data.append(wrapped_row)
        
        # Adjusted widths as requested: Part Number reduced, Priority added (similar width to Stock)
        table = Table(wrapped_data, colWidths=[0.3*inch, 2.5*inch, 1.05*inch, 2.2*inch, 0.6*inch, 0.6*inch, 0.6*inch])
        table.setStyle(TableStyle([
            # Header styling
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3b82f6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('TOPPADDING', (0, 0), (-1, 0), 8),
            
            # Data rows styling
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
            ('ALIGN', (0, 1), (0, -1), 'CENTER'),  # # column centered
            ('ALIGN', (1, 1), (1, -1), 'LEFT'),    # Vendor Desc left-aligned
            ('ALIGN', (2, 1), (-1, -1), 'LEFT'),    # Other columns left-aligned
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),  # Black grid lines
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),  # Top alignment for wrapped text
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ('TOPPADDING', (0, 1), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
        ]))

        elements.append(table)
        doc.build(elements)

        buffer.seek(0)
        return Response(
            content=buffer.getvalue(),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename=unmapped_stock_{datetime.now().strftime('%Y%m%d')}.pdf"
            }
        )

    except Exception as e:
        logger.error(f"Error generating unmapped stock PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))
