"""Review workflow routes"""
from fastapi import APIRouter, HTTPException, Depends, Body, Request
from pydantic import BaseModel
from typing import List, Dict, Any
import logging
import pandas as pd
import numpy as np

from auth import get_current_user
from database_helpers import (
    get_verification_dates,
    get_verification_amounts,
    update_verification_records,
    delete_records_by_receipt
)
from database import get_database_client

router = APIRouter()
logger = logging.getLogger(__name__)


class ReviewData(BaseModel):
    """Review data model"""
    records: List[Dict[str, Any]]


@router.get("/dates")
async def get_review_dates(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get records for date and receipt number review
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        records = get_verification_dates(username)
        
        # SHOW ALL RECORDS - User wants to see all uploaded images regardless of status
        # This provides full visibility into what happened to each upload
        # Cleanup happens only during Sync & Finish
        
        # Custom recursive cleaning for nested structures (like bbox lists)
        def clean_for_json(data):
            if isinstance(data, dict):
                return {k: clean_for_json(v) for k, v in data.items()}
            elif isinstance(data, list):
                return [clean_for_json(v) for v in data]
            elif isinstance(data, float):
                if np.isnan(data) or np.isinf(data):
                    return None
                return data
            return data

        # Apply recursive cleaning to all records
        records = [clean_for_json(record) for record in records]
        
        return {
            "records": records if records else [],
            "total": len(records) if records else 0
        }
    
    except Exception as e:
        logger.error(f"Error reading review dates: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read review data: {str(e)}")


@router.put("/dates")
async def save_review_dates(
    data: ReviewData,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Save edited date and receipt number review data
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        # Save to Supabase
        success = update_verification_records(username, 'verification_dates', data.records)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save to database")
        
        return {"success": True, "message": "Review data saved successfully"}
    
    except Exception as e:
        logger.error(f"Error saving review dates: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save review data: {str(e)}")


@router.put("/dates/update")
async def update_single_review_date(
    record: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update a single verification_dates record by row_id
    If receipt_number changes, also update all related line items
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    row_id = record.get('row_id')
    logger.info(f"DEBUG: Received record keys: {list(record.keys())}")
    logger.info(f"DEBUG: row_id value: {row_id}")
    if not row_id:
        logger.error(f"DEBUG: row_id is missing! Full record: {record}")
        raise HTTPException(status_code=400, detail="row_id is required for update")
    
    try:
        db = get_database_client()
        
        # CRITICAL: Get the OLD record to check if receipt_number changed
        old_record = db.query('verification_dates').eq('username', username).eq('row_id', row_id).execute().data
        if not old_record or len(old_record) == 0:
            raise HTTPException(status_code=404, detail=f"Record with row_id {row_id} not found")
        
        old_receipt_number = old_record[0].get('receipt_number')
        new_receipt_number = record.get('receipt_number')
        
        # Ensure username is set in the record
        record['username'] = username
        
        # Convert numeric types
        from database_helpers import convert_numeric_types
        record = convert_numeric_types(record)
        
        # Filter to only columns that exist in verification_dates (exclude row_id and id from update data)
        # CRITICAL: Never include 'id' in update_data as it's the primary key and causes constraint violations
        valid_cols = {
            'username', 'receipt_number', 'date', 'audit_findings',
            'verification_status', 'receipt_link', 'upload_date',
            'created_at', 'model_used', 'model_accuracy', 'input_tokens',
            'output_tokens', 'total_tokens', 'cost_inr', 'fallback_attempted',
            'fallback_reason', 'processing_errors', 'date_and_receipt_combined_bbox',
            'receipt_number_bbox', 'date_bbox'
        }
        update_data = {k: v for k, v in record.items() if k in valid_cols and k not in ['row_id', 'id']}
        
        # UPDATE 1: Update the header record itself
        db.update('verification_dates', update_data, {'username': username, 'row_id': row_id})
        
        logger.info(f"Updated verification_dates record {row_id} for {username}")
        
        # Check if receipt_number changed - handle propagation via header_id
        new_receipt_number = record.get('receipt_number')
        
        if new_receipt_number:
            # We use the header's row_id (or a separate ID column if available) as the stable ID
            # In existing data, row_id acts as the unique identifier for the header
            header_id = record.get('id')
            
            # If we don't have ID in the payload (rare), fetch it
            if not header_id:
                header_data = db.query('verification_dates').eq('username', username).eq('row_id', row_id).execute().data
                if header_data:
                    header_id = header_data[0].get('id')
            
            if header_id:
                logger.info(f"Receipt number update: Propagating {new_receipt_number} to line items for header {header_id}")
                
                # Find associated line items using header_id
                line_items = db.query('verification_amounts') \
                    .eq('username', username) \
                    .eq('header_id', header_id) \
                    .execute().data
                    
                if line_items:
                    logger.info(f"Found {len(line_items)} line items to update")
                    
                    # Update all associated line items with new receipt number
                    # The header_id stays the same, preserving the link
                    for item in line_items:
                         db.update('verification_amounts', 
                                  {'receipt_number': new_receipt_number}, 
                                  {'username': username, 'row_id': item['row_id']})
                                  
                    logger.info(f"✓ Updated {len(line_items)} line items to receipt {new_receipt_number}")
                else:
                    logger.info(f"No line items found for header {header_id}")
            else:
                logger.warning(f"Could not find header ID for row_id {row_id}, skipping propagation")
        
        return {
            "success": True,
            "message": f"Updated record {row_id} successfully",
            "line_items_updated": len(line_items) if new_receipt_number and old_receipt_number != new_receipt_number and line_items else 0
        }
    
    except Exception as e:
        logger.error(f"Error updating verification_dates: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update record: {str(e)}")


@router.delete("/record/{row_id}")
async def delete_verification_record(
    row_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete a single line item record from ALL tables by row_id.
    Used when deleting from Review Amounts tab (deletes only that specific line item).
    
    NOTE: After migration, all tables now have row_id column for consistent deletion.
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        db = get_database_client()
        
        total_deleted = 0
        
        # All tables now have row_id column after migration
        tables_to_clean = [
            'verification_dates',
            'verification_amounts',
            'invoices',
            'verified_invoices'
        ]
        
        for table_name in tables_to_clean:
            try:
                result = db.delete(table_name, {'username': username, 'row_id': row_id})
                if result:
                    deleted_count = len(result) if isinstance(result, list) else 1
                    total_deleted += deleted_count
                    logger.info(f"Deleted {deleted_count} records from {table_name} (row_id: {row_id})")
            except Exception as e:
                logger.warning(f"Error cleaning {table_name} for row_id {row_id}: {e}")
                continue
        
        return {
            "success": True,
            "message": f"Record {row_id} deleted from all tables",
            "records_deleted": total_deleted
        }
        
    except Exception as e:
        logger.error(f"Error deleting record {row_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete record: {str(e)}")


@router.delete("/receipt/{receipt_number}")
async def delete_receipt(
    receipt_number: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete all records with given receipt number from review and staging tables.
    Used when deleting from Review Dates tab (deletes entire receipt).
    
    IMPORTANT: Does NOT delete from verified_invoices - only deletes from:
    - invoices (staging table)
    - verification_dates (review table)
    - verification_amounts (review table)
    
    This prevents accidentally deleting already-synced historical records if a duplicate
    receipt number is uploaded and then deleted during review.
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        db = get_database_client()
        
        # List of tables to clean - EXCLUDING verified_invoices
        # verified_invoices should only be modified during Sync & Finish
        tables_to_clean = [
            'invoices',              # Staging table for unverified invoices
            'verification_dates',    # Review table for dates/receipts
            'verification_amounts'   # Review table for line items
        ]
        
        total_deleted = 0
        
        for table_name in tables_to_clean:
            try:
                # Delete records matching receipt_number and username
                result = db.delete(table_name, {'username': username, 'receipt_number': receipt_number})
                
                if result:
                    deleted_count = len(result) if isinstance(result, list) else 1
                    total_deleted += deleted_count
                    logger.info(f"Deleted {deleted_count} records from {table_name}")
                    
            except Exception as e:
                logger.warning(f"Error cleaning {table_name}: {e}")
                continue
        
        return {
            "success": True,
            "message": f"Receipt {receipt_number} deleted from review and staging tables",
            "records_deleted": total_deleted
        }
        
    except Exception as e:
        logger.error(f"Error deleting receipt: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete receipt: {str(e)}")


@router.get("/amounts")
async def get_review_amounts(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get records for amount review
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        records = get_verification_amounts(username)
        
        # SHOW ALL RECORDS - User wants to see all records regardless of status
        # Cleanup happens only during Sync & Finish
        
        # Custom recursive cleaning for nested structures (like bbox lists)
        def clean_for_json(data):
            if isinstance(data, dict):
                return {k: clean_for_json(v) for k, v in data.items()}
            elif isinstance(data, list):
                return [clean_for_json(v) for v in data]
            elif isinstance(data, float):
                if np.isnan(data) or np.isinf(data):
                    return None
                return data
            return data

        # Apply recursive cleaning to all records
        records = [clean_for_json(record) for record in records]
        
        return {
            "records": records if records else [],
            "total": len(records) if records else 0
        }
    
    except Exception as e:
        logger.error(f"Error reading review amounts: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read review data: {str(e)}")


@router.put("/amounts")
async def save_review_amounts(
    data: ReviewData,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Save edited amount review data
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        # Save to Supabase
        success = update_verification_records(username, 'verification_amounts', data.records)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save to database")
        
        return {"success": True, "message": "Review data saved successfully"}
    
    except Exception as e:
        logger.error(f"Error saving review amounts: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save review data: {str(e)}")


@router.put("/amounts/update")
async def update_single_review_amount(
    record: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update a single verification_amounts record by row_id
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    row_id = record.get('row_id')
    if not row_id:
        raise HTTPException(status_code=400, detail="row_id is required for update")
    
    try:
        db = get_database_client()
        
        # Ensure username is set in the record
        record['username'] = username
        
        # Convert numeric types
        from database_helpers import convert_numeric_types
        record = convert_numeric_types(record)
        
        # Filter to only columns that exist in verification_amounts (exclude row_id and id from update data)
        # CRITICAL: Never include 'id' in update_data as it's the primary key and causes constraint violations
        valid_cols = {
            'username', 'receipt_number', 'description', 'quantity',
            'rate', 'amount', 'amount_mismatch', 'verification_status',
            'receipt_link', 'created_at', 'model_used',
            'model_accuracy', 'input_tokens', 'output_tokens', 'total_tokens',
            'cost_inr', 'fallback_attempted', 'fallback_reason',
            'processing_errors', 'line_item_row_bbox', 'date_and_receipt_combined_bbox',
            'receipt_number_bbox', 'description_bbox', 'quantity_bbox',
            'rate_bbox', 'amount_bbox'
        }
        update_data = {k: v for k, v in record.items() if k in valid_cols and k not in ['row_id', 'id']}
        
        # UPDATE the record (not DELETE+INSERT)
        db.update('verification_amounts', update_data, {'username': username, 'row_id': row_id})
        
        logger.info(f"Updated verification_amounts record {row_id} for {username}")
        
        return {
            "success": True,
            "message": f"Updated record {row_id} successfully"
        }
    
    except Exception as e:
        logger.error(f"Error updating verification_amounts: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update record: {str(e)}")


@router.post("/sync-finish")
async def sync_and_finish(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Execute the Sync & Finish workflow
    This will:
    1. Update invoices table with corrected values from review tables
    2. Rebuild verified_invoices table
    3. Clean up review tables (remove Done/Already Verified/Rejected)
    4. Record sync metadata for user visibility
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        # Import and call the verification logic (migrated version)
        from services.verification import run_sync_verified_logic_supabase
        from datetime import datetime
        
        logger.info(f"Sync & Finish triggered for user: {username}")
        
        # Execute sync
        results = await run_sync_verified_logic_supabase(username)
        

        

        return {
            "success": results["success"],
            "message": results["message"],
            "records_synced": results.get("records_synced", 0)
        }
    
    except Exception as e:
        logger.error(f"Error in sync and finish: {e}")
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@router.get("/sync-finish/stream")
async def sync_and_finish_stream(
    request: Request,
    token: str = None
):
    """
    Execute Sync & Finish with Server-Sent Events (SSE) for real-time progress
    
    SSE Event Format:
    {
        "stage": "reading"|"saving_invoices"|"building_verified"|"saving_verified"|"cleanup"|"complete",
        "percentage": 0-100,
        "message": "Human-readable status message"
    }
    """
    # Extract token from query param, cookie, or Authorization header
    auth_token = token or request.cookies.get("access_token") or request.headers.get("authorization", "").replace("Bearer ", "")
    
    if not auth_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Verify token
    from auth import decode_access_token
    payload = decode_access_token(auth_token)
    
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    username = payload.get("sub")  # JWT standard uses 'sub' for subject/username
    
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    from fastapi.responses import StreamingResponse
    from services.verification import run_sync_verified_logic_supabase
    import json
    import asyncio
    
    async def event_generator():
        try:
            logger.info(f"SSE Sync & Finish triggered for user: {username}")
            
            # Create async queue for real-time progress streaming
            progress_queue = asyncio.Queue()
            
            # Progress callback to enqueue events immediately
            async def progress_callback(stage: str, percentage: int, message: str):
                event_data = {
                    "stage": stage,
                    "percentage": percentage,
                    "message": message
                }
                await progress_queue.put(event_data)
                logger.info(f"Progress update: {stage} ({percentage}%) - {message}")
            
            # Create task for sync execution
            sync_task = asyncio.create_task(
                run_sync_verified_logic_supabase(username, progress_callback=progress_callback)
            )
            
            # Stream events as they arrive
            while not sync_task.done():
                try:
                    # Wait for next event with timeout
                    event = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # No event ready, continue waiting
                    continue
            
            # Drain any remaining events from queue
            while not progress_queue.empty():
                event = await progress_queue.get()
                yield f"data: {json.dumps(event)}\n\n"
            
            # Get sync results
            results = await sync_task
            
            # Send completion event
            completion_data = {
                "stage": "complete",
                "percentage": 100,
                "message": "Sync complete!",
                "success": results["success"],
                "records_synced": results.get("records_synced", 0)
            }
            yield f"data: {json.dumps(completion_data)}\n\n"
            
        except Exception as e:
            logger.error(f"Error in SSE sync: {e}")
            error_data = {
                "stage": "error",
                "percentage": 0,
                "message": f"Sync failed: {str(e)}",
                "success": False
            }
            yield f"data: {json.dumps(error_data)}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
