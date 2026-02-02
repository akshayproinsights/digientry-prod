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
import uuid
import asyncio
from concurrent.futures import ThreadPoolExecutor
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

# Thread pool for stock recalculation (non-blocking)
stock_executor = ThreadPoolExecutor(max_workers=2)

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


class PhysicalStockUpdate(BaseModel):
    """Update stock via physical count"""
    part_number: str
    physical_count: int
    reason: Optional[str] = None



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
            # Calculate actual on-hand stock (current_stock + old_stock + manual_adjustment)
            # This matches the frontend display logic
            current = item.get("current_stock", 0)
            # old_stock is now merged into manual_adjustment, so we ignore it or it is 0
            # old = item.get("old_stock", 0) or 0
            manual = item.get("manual_adjustment", 0) or 0
            on_hand = current + manual
            reorder = item.get("reorder_point", DEFAULT_REORDER_POINT)
            
            if on_hand <= 0:
                item["status"] = "Out of Stock"
            elif on_hand < reorder:
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
        
        # Count items using on_hand (current_stock + manual_adjustment) vs reorder_point
        # Note: old_stock is deprecated and merged into manual_adjustment
        low_stock_count = sum(
            1 for item in items 
            if 0 < (item.get("current_stock", 0) + (item.get("manual_adjustment", 0) or 0)) < item.get("reorder_point", DEFAULT_REORDER_POINT)
        )
        out_of_stock_count = sum(
            1 for item in items 
            if (item.get("current_stock", 0) + (item.get("manual_adjustment", 0) or 0)) <= 0
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
        
        total_deleted = stock_deleted + mapping_deleted
        
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
                
                item_total = stock_deleted + mapping_deleted
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
    Trigger stock recalculation in background (non-blocking).
    Returns immediately with a task_id for status polling.
    """
    username = current_user.get("username")
    task_id = str(uuid.uuid4())
    
    logger.info(f"========== STOCK RECALCULATION TRIGGERED ==========")
    logger.info(f"User: {username}")
    logger.info(f"Task ID: {task_id}")
    
    # Initialize task status in database
    db = get_database_client()
    
    initial_status = {
        "task_id": task_id,
        "username": username,
        "status": "queued",
        "message": "Stock recalculation queued",
        "progress": {
            "total": 0,
            "processed": 0
        },
        "created_at": datetime.utcnow().isoformat()
    }
    
    try:
        db.insert("recalculation_tasks", initial_status)
        logger.info(f"Created recalculation task {task_id} in database")
    except Exception as e:
        logger.error(f"Failed to create recalculation task in DB: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
    # Submit to thread pool (non-blocking)
    try:
        loop = asyncio.get_event_loop()
        loop.run_in_executor(
            stock_executor,
            recalculate_stock_wrapper,
            task_id,
            username
        )
        logger.info(f"Submitted recalculation task {task_id} to thread pool")
    except Exception as e:
        logger.error(f"Failed to submit recalculation task: {e}")
        try:
            db.update("recalculation_tasks", 
                     {"status": "failed", "message": f"Failed to start: {str(e)}"}, 
                     {"task_id": task_id})
        except:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to start recalculation: {str(e)}")
    
    return {
        "success": True,
        "task_id": task_id,
        "message": "Stock recalculation started in background"
    }


@router.get("/calculate/status/{task_id}")
async def get_recalculation_status(
    task_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get status of a stock recalculation task.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Query task status from database
        response = db.query("recalculation_tasks").eq("task_id", task_id).execute()
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(status_code=404, detail="Task not found")
        
        task = response.data[0]
        
        # Verify ownership
        if task.get("username") != username:
            raise HTTPException(status_code=403, detail="Access denied")
        
        return {
            "success": True,
            "task_id": task.get("task_id"),
            "status": task.get("status"),
            "message": task.get("message"),
            "progress": task.get("progress", {}),
            "started_at": task.get("started_at"),
            "completed_at": task.get("completed_at")
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching recalculation status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/needs-recalculation")
async def check_needs_recalculation(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Check if stock levels need recalculation.
    Returns true if stock_levels table is empty or potentially stale.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Check if stock_levels table has any records for this user
        response = db.client.table("stock_levels")\
            .select("part_number", count="exact")\
            .eq("username", username)\
            .limit(1)\
            .execute()
        
        # If no stock levels exist, recalculation is needed
        needs_recalc = not response.data or len(response.data) == 0
        
        return {
            "success": True,
            "needs_recalculation": needs_recalc,
            "reason": "No stock levels found" if needs_recalc else "Stock levels exist"
        }
        
    except Exception as e:
        logger.error(f"Error checking recalculation need: {e}")
        # If error, assume recalculation is needed to be safe
        return {
            "success": True,
            "needs_recalculation": True,
            "reason": f"Error checking status: {str(e)}"
        }


def recalculate_stock_wrapper(task_id: str, username: str):
    """
    Wrapper function to run recalculate_stock_for_user in background thread.
    Updates task status in database during execution.
    """
    db = get_database_client()
    
    def update_task_status(status_update: Dict[str, Any]):
        """Helper to update task status in database"""
        try:
            status_update["updated_at"] = datetime.utcnow().isoformat()
            db.update("recalculation_tasks", status_update, {"task_id": task_id})
        except Exception as e:
            logger.error(f"Failed to update recalculation task status: {e}")
    
    logger.info(f"========== RECALCULATION BACKGROUND TASK STARTED ==========")
    logger.info(f"Task ID: {task_id}, Username: {username}")
    
    try:
        # Update status to processing
        update_task_status({
            "status": "processing",
            "message": "Recalculating stock levels...",
            "started_at": datetime.utcnow().isoformat()
        })
        
        # Run the actual recalculation (blocking operation, but in thread pool)
        recalculate_stock_for_user(username, current_task_id=task_id)
        
        # Update status to completed
        update_task_status({
            "status": "completed",
            "message": "Stock levels recalculated successfully",
            "completed_at": datetime.utcnow().isoformat()
        })
        
        logger.info(f"✅ Recalculation task {task_id} completed successfully")
        
    except Exception as e:
        logger.error(f"❌ Recalculation task {task_id} failed: {e}")
        logger.error(f"Error type: {type(e).__name__}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        update_task_status({
            "status": "failed",
            "message": f"Recalculation failed: {str(e)}",
            "completed_at": datetime.utcnow().isoformat()
        })

        raise HTTPException(status_code=500, detail=str(e))


def recalculate_stock_for_user(username: str, current_task_id: Optional[str] = None):
    """
    Core logic to recalculate stock levels for a user.
    Can be called from other routes after invoice processing.
    
    CONCURRENCY CONTROL:
    Instead of PostgreSQL advisory locks (which are session-bound and flaky with 
    stateless HTTP clients), we check the 'recalculation_tasks' table for 
    other running tasks.
    """
    db = get_database_client()
    
    logger.info(f"Starting stock recalculation for {username} (Task: {current_task_id})")
    
    # 1. Check for concurrent tasks in progress
    try:
        # Get tasks that are 'processing' for this user
        # We need to filter out the current task if provided
        query = db.client.table("recalculation_tasks")\
            .select("task_id, created_at")\
            .eq("username", username)\
            .eq("status", "processing")
            
        if current_task_id:
            query = query.neq("task_id", current_task_id)
            
        running_tasks = query.execute()
        
        if running_tasks.data and len(running_tasks.data) > 0:
            # Check if they are stale (older than 5 minutes)
            # This is a fail-safe in case a worker died without updating status
            active_collision = False
            
            for task in running_tasks.data:
                created_at_str = task.get("created_at")
                if created_at_str:
                    try:
                        # Parse simplified ISO format
                        created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
                        age = (datetime.utcnow() - created_at.replace(tzinfo=None)).total_seconds()
                        
                        if age < 300:  # 5 minutes
                            active_collision = True
                            logger.warning(f"⚠️ Found active concurrent task: {task.get('task_id')} (started {int(age)}s ago)")
                            break
                        else:
                            logger.warning(f"⚠️ Found STALE concurrent task: {task.get('task_id')} (started {int(age)}s ago) - Ignoring")
                    except Exception as e:
                        logger.warning(f"Error parsing task date: {e} - Assuming active")
                        active_collision = True
                        break
            
            if active_collision:
                logger.warning(f"❌ Stock recalculation already in progress for {username}")
                raise HTTPException(
                    status_code=409,
                    detail="Stock recalculation already in progress for this user. Please wait for it to complete."
                )
        
        logger.info(f"✓ Concurrency check passed for {username}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking concurrency for {username}: {e}")
        # Proceed cautiously even if check fails, to avoid blockage
        pass
    
    try:
        # Perform the actual recalculation
        _perform_stock_recalculation(username, db)
        
    except Exception as e:
        logger.error(f"Error during stock recalculation for {username}: {e}")
        raise


def _perform_stock_recalculation(username: str, db):
    """
    Internal helper that performs the actual stock recalculation.
    This is separated so the lock logic is clear in the parent function.
    
    Args:
        username: Username to recalculate stock for
        db: Database client instance
    """
    logger.info(f"Performing stock recalculation for {username}")
    
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
    
    # 3. Get inventory mappings (customer item, part, vendor desc, priority, reorder)
    mappings = db.client.table("vendor_mapping_entries")\
        .select("customer_item_name, part_number, vendor_description, priority, reorder_point")\
        .eq("username", username)\
        .eq("status", "Added")\
        .execute()
    
    mapping_data = mappings.data or []
    logger.info(f"Found {len(mapping_data)} inventory mappings")
    
    # 4. GET EXISTING STOCK LEVELS TO PRESERVE MANUAL EDITS (Old Stock only)
    # Priority and Reorder are now sourced from vendor_mapping_entries
    existing_stock_levels = db.client.table("stock_levels")\
        .select("part_number, internal_item_name, old_stock, manual_adjustment")\
        .eq("username", username)\
        .execute()
    
    # Build lookup dict: (part_number, internal_item_name) -> {old_stock}
    existing_values = {}
    for stock in (existing_stock_levels.data or []):
        key = (stock.get("part_number"), stock.get("internal_item_name"))
        existing_values[key] = {
            # "old_stock": stock.get("old_stock"),  # Deprecated
            "manual_adjustment": stock.get("manual_adjustment")
        }
    
    logger.info(f"Found {len(existing_values)} existing stock levels to preserve")
    
    # Create mapping lookup
    # key: part_number -> {customer_item, priority, reorder_point}
    mapping_lookup = {}
    for mapping in mapping_data:
        part = mapping.get("part_number")
        if part:
            mapping_lookup[part] = {
                "customer_item_name": mapping.get("customer_item_name"),
                "priority": mapping.get("priority"),
                "reorder_point": mapping.get("reorder_point")
            }
    
    
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
        # CHANGED: Reorder Point and Priority now come from MAPPING TABLE (mapping_lookup)
        
        mapping_info = mapping_lookup.get(part, {})
        
        # Priority: From mapping > existing preserved (fallback) > None
        priority = mapping_info.get("priority") 
        
        # Reorder Point: From mapping > default
        # Note: We prioritize the mapping Reorder Point. 
        reorder_point = mapping_info.get("reorder_point")
        if reorder_point is None:
             reorder_point = DEFAULT_REORDER_POINT

        # Old Stock: Deprecated/Unused
        old_stock = 0 

        # Manual Adjustment: Preserve existing value
        manual_adjustment = preserved.get("manual_adjustment") or 0
        
        # customer_items comes ONLY from vendor_mapping_entries (single source of truth)
        # Already populated in data["customer_items"] from Step 1 (initialization with mappings)
        customer_items_str = ", ".join(data.get("customer_items", [])) if data.get("customer_items") else None
        
        # Calculate ACTUAL ON HAND (including manual_adjustment, ignoring old_stock)
        stock_on_hand = current_stock + manual_adjustment
        
        # Calculate value using ON HAND (not just current_stock)
        unit_value = data.get("vendor_rate") or 0
        total_value = stock_on_hand * unit_value
        
        stock_records.append({
            "username": username,
            "part_number": part,
            "internal_item_name": data["internal_item_name"],
            "vendor_description": data["vendor_description"],
            "customer_items": customer_items_str, 
            "current_stock": round(current_stock, 2),
            "total_in": round(data["total_in"], 2),
            "total_out": round(data["total_out"], 2),
            "reorder_point": reorder_point,  
            "old_stock": old_stock,  
            "manual_adjustment": manual_adjustment,
            "priority": priority,
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
                "manual_adjustment": existing_item.get("manual_adjustment") or 0,
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
    # NOTE: This delete-then-insert is now protected by advisory lock (see recalculate_stock_for_user)
    if stock_records:
        logger.info(f"🔒 [LOCKED] Deleting existing stock_levels for {username}...")
        # Delete existing
        delete_result = db.client.table("stock_levels").delete().eq("username", username).execute()
        deleted_count = len(delete_result.data) if delete_result.data else 0
        logger.info(f"🔒 [LOCKED] Deleted {deleted_count} old records")
        
        logger.info(f"🔒 [LOCKED] Inserting {len(stock_records)} new stock records...")
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
        
        # 1. Handle fields that now live in vendor_mapping_entries (Priority, Reorder)
        # We also need to handle customer_items here as before
        mapping_updates = {}
        
        if updates.reorder_point is not None:
            if updates.reorder_point < 0:
                raise HTTPException(status_code=400, detail="Reorder point must be >= 0")
            update_data["reorder_point"] = updates.reorder_point
            mapping_updates["reorder_point"] = updates.reorder_point
        
        if updates.priority is not None:
            update_data["priority"] = updates.priority
            mapping_updates["priority"] = updates.priority
            
        if updates.customer_items is not None:
            update_data["customer_items"] = updates.customer_items
            mapping_updates["customer_item_name"] = updates.customer_items

        # Handle fields that stay in stock_levels
        if updates.unit_value is not None:
            if updates.unit_value < 0:
                raise HTTPException(status_code=400, detail="Unit value must be >= 0")
            update_data["unit_value"] = updates.unit_value
            update_data["vendor_rate"] = updates.unit_value  # Sync with vendor_rate
        
        if updates.old_stock is not None:
            if updates.old_stock < 0:
                raise HTTPException(status_code=400, detail="Old stock must be >= 0")
            update_data["old_stock"] = updates.old_stock
        
        # If we have mapping updates, we need to push them to vendor_mapping_entries
        if mapping_updates:
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
                
                mapping_upsert = {
                    "updated_at": datetime.now().isoformat(),
                    **mapping_updates
                }
                
                if existing_mapping.data:
                    # UPDATE existing mapping
                    db.client.table("vendor_mapping_entries")\
                        .update(mapping_upsert)\
                        .eq("id", existing_mapping.data[0]["id"])\
                        .execute()
                    logger.info(f"Using Mapping Source: Updated {mapping_updates.keys()} for {part_number}")
                else:
                    # CREATE new mapping
                    # We need minimal required fields: username, part_number, vendor_description, status
                    mapping_upsert.update({
                        "username": username,
                        "part_number": part_number,
                        "vendor_description": internal_item_name,
                        "status": "Added",
                        "created_at": datetime.now().isoformat()
                    })
                    
                    # Ensure customer_item_name is set if not in update (default empty string)
                    if "customer_item_name" not in mapping_upsert:
                         mapping_upsert["customer_item_name"] = ""
                         
                    db.client.table("vendor_mapping_entries")\
                        .insert(mapping_upsert)\
                        .execute()
                    logger.info(f"Using Mapping Source: Created mapping + {mapping_updates.keys()} for {part_number}")
        
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


@router.post("/update-stock-adjustment")
async def update_stock_adjustment(
    update: PhysicalStockUpdate,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update stock adjustment based on physical count.
    Adjustment = UserPhysicalCount - (Total IN - Total OUT + Opening Stock)
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Get current stock level info
        stock_query = db.client.table("stock_levels")\
            .select("*")\
            .eq("username", username)\
            .eq("part_number", update.part_number)\
            .execute()
            
        if not stock_query.data:
            raise HTTPException(status_code=404, detail="Stock item not found")
            
        item = stock_query.data[0]
        
        # Calculate current system stock (IN - OUT)
        # Note: old_stock is removed from this calculation as it's now part of manual_adjustment logic
        current_in_out = item.get("current_stock", 0)  # Total IN - Total OUT
        system_stock_without_adj = current_in_out
        
        # Calculate required adjustment
        # Physical = System + Adjustment
        # Adjustment = Physical - System
        adjustment_value = update.physical_count - system_stock_without_adj
        
        # Update database
        update_data = {
            "manual_adjustment": int(adjustment_value),
            "updated_at": datetime.now().isoformat()
        }
        
        # Recalculate total value with new on-hand
        new_on_hand = update.physical_count
        unit_value = item.get("unit_value", 0) or 0
        update_data["total_value"] = round(new_on_hand * unit_value, 2)
        
        db.client.table("stock_levels")\
            .update(update_data)\
            .eq("id", item["id"])\
            .execute()
            
        logger.info(f"Updated stock adjustment for {update.part_number}: Physical={update.physical_count}, Adj={adjustment_value}")
        
        return {
            "success": True,
            "message": "Stock adjustment updated successfully",
            "adjustment": adjustment_value,
            "physical_count": update.physical_count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating stock adjustment: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export-inventory-count-sheet")
async def export_inventory_count_sheet(
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Export ALL stock items to a PDF Inventory Count Sheet.
    Includes columns for: #, Vendor Description, Part Number, Customer Item, Priority, Actual Stock (Blank), Reorder (Blank).
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
        
        # Sort Alphabetical by Customer Item Name (primary) or Vendor Description (secondary)
        query = query.order("internal_item_name", nullsfirst=False).order("vendor_description", nullsfirst=False)
        
        response = query.execute()
        items = response.data or []
        
        # Apply status filter if provided
        if status_filter and status_filter != "all":
            if status_filter == "out_of_stock":
                items = [item for item in items if item.get("current_stock", 0) <= 0]
            elif status_filter == "low_stock":
                items = [item for item in items if 0 < item.get("current_stock", 0) < item.get("reorder_point", DEFAULT_REORDER_POINT)]
            elif status_filter == "in_stock":
                items = [item for item in items if item.get("current_stock", 0) >= item.get("reorder_point", DEFAULT_REORDER_POINT)]
        
        if not items:
            raise HTTPException(
                status_code=404, 
                detail="No items found matching the filters"
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
        title = Paragraph("<b>Inventory Count Sheet</b>", title_style)
        elements.append(title)
        
        # Date and instructions
        date_text = f"Generated: {datetime.now().strftime('%m/%d/%Y')}"
        date = Paragraph(date_text, styles['Normal'])
        elements.append(date)
        
        # Priority explanation for Indian SMB users
        priority_note = Paragraph(
            "<b>Priority Guide:</b> P0 = Most Important (order first), "
            "P1 = High Priority, P2 = Medium Priority, P3 = Low Priority",
            styles['Normal']
        )
        elements.append(priority_note)
        elements.append(Spacer(1, 0.3*inch))
        
        # Table data
        # Headers
        table_data = [
            ['#', 'Vendor Description', 'Part Number', 'Customer Item', 'Priority', 'Actual Stock', 'Reorder']
        ]

        for idx, item in enumerate(items, 1):
            customer_item = item.get('customer_items', '') or ''
            # Handle list format string if it looks like one "['Item A']" -> "Item A"
            if customer_item.startswith("['") and customer_item.endswith("']"):
                 customer_item = customer_item[2:-2]
            
            table_data.append([
                str(idx),
                item.get('vendor_description', '') or item.get('internal_item_name', ''), # Use vendor desc, fallback to internal
                item.get('part_number', ''),
                customer_item,  # Print current name
                item.get('priority', '') or '',  # Print P0/P1 etc.
                '',  # Actual Stock - BLANK for manual entry
                ''   # Reorder - BLANK for manual entry
            ])

        # Create table with optimized column widths for PORTRAIT orientation
        # Total width: ~7.5" (letter width 8.5" - 1" margins)
        # Widths: # (0.4"), Vendor Desc (2.2"), Part# (1.0"), Customer (2.0"), Priority (0.6"), Stock (0.8"), Reorder (0.5")
        from reportlab.platypus import Paragraph as PDFParagraph
        from reportlab.lib.styles import getSampleStyleSheet as getStyles
        
        # Wrap long descriptions
        cell_style = getStyles()['Normal']
        cell_style.fontSize = 8
        cell_style.leading = 9
        
        wrapped_data = [table_data[0]]  # Header row
        for row in table_data[1:]:
            wrapped_row = [
                row[0],  # #
                PDFParagraph(row[1], cell_style),  # Vendor Description - wrapped
                PDFParagraph(row[2], cell_style),  # Part Number - wrapped
                PDFParagraph(row[3], cell_style), # Customer Item - wrapped
                PDFParagraph(row[4], cell_style),  # Priority - wrapped
                row[5],  # Actual Stock - blank
                row[6]   # Reorder - blank
            ]
            wrapped_data.append(wrapped_row)
        
        table = Table(
            wrapped_data, 
            colWidths=[0.4*inch, 2.2*inch, 1.0*inch, 2.0*inch, 0.6*inch, 0.8*inch, 0.5*inch],
            repeatRows=1  # Repeat header row on every page
        )
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
            ('ALIGN', (2, 1), (-1, -1), 'LEFT'),   
            ('ALIGN', (4, 1), (4, -1), 'CENTER'), # Priority centered
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
                "Content-Disposition": f"attachment; filename=inventory_count_sheet_{datetime.now().strftime('%Y%m%d')}.pdf"
            }
        )

    except Exception as e:
        logger.error(f"Error generating inventory count sheet PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))
