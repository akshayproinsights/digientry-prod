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
        
        # Convert to DataFrame for NaN/Inf handling
        if records:
            df = pd.DataFrame(records)
            df = df.replace([np.inf, -np.inf], None)
            df = df.where(pd.notnull(df), None)
            records = df.to_dict('records')
        
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
        
        # Filter to only columns that exist in verification_dates
        valid_cols = {
            'id', 'username', 'receipt_number', 'date', 'audit_findings',
            'verification_status', 'receipt_link', 'upload_date', 'row_id',
            'created_at', 'model_used', 'model_accuracy', 'input_tokens',
            'output_tokens', 'total_tokens', 'cost_inr', 'fallback_attempted',
            'fallback_reason', 'processing_errors', 'date_and_receipt_combined_bbox',
            'receipt_number_bbox', 'date_bbox'
        }
        filtered_record = {k: v for k, v in record.items() if k in valid_cols}
        
        # Delete the old record
        db.delete('verification_dates', {'username': username, 'row_id': row_id})
        
        # Insert the updated record
        db.insert('verification_dates', filtered_record)
        
        logger.info(f"Updated verification_dates record {row_id} for {username}")
        
        return {
            "success": True,
            "message": f"Updated record {row_id} successfully"
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
    Delete a record from all tables (verification_dates, verification_amounts, invoices) by row_id
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        db = get_database_client()
        
        total_deleted = 0
        
        # Delete from verification tables (they use row_id)
        verification_tables = ['verification_dates', 'verification_amounts']
        
        for table_name in verification_tables:
            try:
                result = db.delete(table_name, {'username': username, 'row_id': row_id})
                if result:
                    deleted_count = len(result) if isinstance(result, list) else 1
                    total_deleted += deleted_count
                    logger.info(f"Deleted {deleted_count} records from {table_name} (row_id: {row_id})")
            except Exception as e:
                logger.warning(f"Error cleaning {table_name} for row_id {row_id}: {e}")
                continue
        
        # For invoices table, try to find by matching receipt_number if needed
        # (invoices table uses 'id' column, not 'row_id')
        # We skip invoices deletion since row_id format doesn't match id format
        
        return {
            "success": True,
            "message": f"Record {row_id} deleted from verification tables",
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
    Delete all records with given receipt number from ALL Supabase tables.
    Used when deleting from Review Dates tab (deletes entire receipt).
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        db = get_database_client()
        
        # List of all tables to clean
        tables_to_clean = [
            'invoices',
            'verified_invoices',
            'verification_dates',
            'verification_amounts'
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
            "message": f"Receipt {receipt_number} deleted from all tables",
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
        
        # Convert to DataFrame for NaN/Inf handling
        if records:
            df = pd.DataFrame(records)
            df = df.replace([np.inf, -np.inf], None)
            df = df.where(pd.notnull(df), None)
            
            records = df.to_dict('records')
        
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
        
        # Filter to only columns that exist in verification_amounts
        valid_cols = {
            'id', 'username', 'receipt_number', 'description', 'quantity',
            'rate', 'amount', 'amount_mismatch', 'verification_status',
            'receipt_link', 'row_id', 'created_at', 'model_used',
            'model_accuracy', 'input_tokens', 'output_tokens', 'total_tokens',
            'cost_inr', 'fallback_attempted', 'fallback_reason',
            'processing_errors', 'line_item_row_bbox', 'date_and_receipt_combined_bbox',
            'receipt_number_bbox', 'description_bbox', 'quantity_bbox',
            'rate_bbox', 'amount_bbox'
        }
        filtered_record = {k: v for k, v in record.items() if k in valid_cols}
        
        # Delete the old record
        db.delete('verification_amounts', {'username': username, 'row_id': row_id})
        
        # Insert the updated record
        db.insert('verification_amounts', filtered_record)
        
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
        
        # Track sync metadata
        if results["success"]:
            try:
                db = get_database_client()
                sync_metadata = {
                    "username": username,
                    "sync_timestamp": datetime.utcnow().isoformat(),
                    "records_processed": results.get("records_synced", 0),
                    "sync_type": "full",
                    "created_at": datetime.utcnow().isoformat()
                }
                db.insert('sync_metadata', sync_metadata)
                logger.info(f"Sync metadata recorded for {username}")
            except Exception as meta_error:
                logger.warning(f"Failed to record sync metadata: {meta_error}")
                # Don't fail the whole sync if metadata tracking fails
        
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
            
            # Track progress events to yield
            progress_events = []
            
            # Progress callback to collect events
            async def progress_callback(stage: str, percentage: int, message: str):
                event_data = {
                    "stage": stage,
                    "percentage": percentage,
                    "message": message
                }
                progress_events.append(event_data)
            
            # Execute sync with progress tracking
            results = await run_sync_verified_logic_supabase(username, progress_callback=progress_callback)
            
            # Yield all collected events
            for event in progress_events:
                yield f"data: {json.dumps(event)}\n\n"
                await asyncio.sleep(0.01)
            
            # Record sync metadata
            try:
                from datetime import datetime
                db = get_database_client()
                sync_record = {
                    'username': username,
                    'sync_timestamp': datetime.utcnow().isoformat(),
                    'records_processed': results.get('records_synced', 0),
                    'sync_type': 'full',
                    'created_at': datetime.utcnow().isoformat()
                }
                db.insert('sync_metadata', sync_record)
                logger.info(f"Sync metadata recorded for {username}")
            except Exception as e:
                logger.error(f"Failed to record sync metadata: {e}")
            
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


@router.get("/sync-metadata")
async def get_sync_metadata(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get the last sync metadata for the current user
    Returns information about when the user last synced and how many records were processed
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        db = get_database_client()
        
        # Query for the most recent sync metadata
        result = db.client.table('sync_metadata') \
            .select('*') \
            .eq('username', username) \
            .order('sync_timestamp', desc=True) \
            .limit(1) \
            .execute()
        
        if result.data and len(result.data) > 0:
            metadata = result.data[0]
            return {
                "has_synced": True,
                "sync_timestamp": metadata.get('sync_timestamp'),
                "records_processed": metadata.get('records_processed', 0),
                "sync_type": metadata.get('sync_type', 'full')
            }
        else:
            return {
                "has_synced": False,
                "sync_timestamp": None,
                "records_processed": 0,
                "sync_type": None
            }
    
    except Exception as e:
        logger.error(f"Error fetching sync metadata: {e}")
        # Don't fail hard, just return no metadata
        return {
            "has_synced": False,
            "sync_timestamp": None,
            "records_processed": 0,
            "sync_type": None
        }
