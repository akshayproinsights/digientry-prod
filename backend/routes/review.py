"""Review workflow routes"""
from fastapi import APIRouter, HTTPException, Depends, Body
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
        
        # Delete the old record
        db.delete('verification_dates', {'username': username, 'row_id': row_id})
        
        # Insert the updated record
        db.insert('verification_dates', record)
        
        logger.info(f"Updated verification_dates record {row_id} for {username}")
        
        return {
            "success": True,
            "message": f"Updated record {row_id} successfully"
        }
    
    except Exception as e:
        logger.error(f"Error updating verification_dates: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update record: {str(e)}")


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
        
        # Delete the old record
        db.delete('verification_amounts', {'username': username, 'row_id': row_id})
        
        # Insert the updated record
        db.insert('verification_amounts', record)
        
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
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        # Import and call the verification logic (migrated version)
        from services.verification import run_sync_verified_logic_supabase
        
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
