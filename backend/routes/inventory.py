"""Inventory upload and processing routes"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import logging
from datetime import datetime
import uuid
import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from fastapi.responses import StreamingResponse
import pandas as pd

from auth import get_current_user, get_current_user_r2_bucket
from services.storage import get_storage_client
from utils.image_optimizer import optimize_image_for_gemini, should_optimize_image, validate_image_quality
from config import get_purchases_folder

router = APIRouter()
logger = logging.getLogger(__name__)

# Thread pool for blocking operations (Optimized for high-load: 50 concurrent tasks)
# Configurable via environment variable
executor = ThreadPoolExecutor(max_workers=int(os.getenv('INVENTORY_MAX_WORKERS', '50')))

# In-memory storage REMOVED - using database table 'upload_tasks'
# inventory_processing_status: Dict[str, Dict[str, Any]] = {}


class InventoryUploadResponse(BaseModel):
    """Inventory upload response model"""
    success: bool
    uploaded_files: List[str]
    message: str


class InventoryProcessRequest(BaseModel):
    """Process inventory request model"""
    file_keys: List[str]
    force_upload: bool = False  # If True, bypass duplicate checking and delete old duplicates


class InventoryProcessResponse(BaseModel):
    """Process inventory response model"""
    task_id: str
    status: str
    message: str


class InventoryProcessStatusResponse(BaseModel):
    """Process status response model"""
    task_id: str
    status: str
    progress: Dict[str, Any]
    message: str
    duplicates: Optional[List[Dict[str, Any]]] = []  # Add duplicates field
    uploaded_r2_keys: List[str] = []  # CRITICAL: R2 keys for frontend


@router.post("/upload", response_model=InventoryUploadResponse)
async def upload_inventory_files(
    files: List[UploadFile] = File(...),
    current_user: Dict[str, Any] = Depends(get_current_user),
    r2_bucket: str = Depends(get_current_user_r2_bucket)
):
    """
    Upload inventory files to R2 storage SEQUENTIALLY and SYNCHRONOUSLY.
    Blocks until all files are uploaded to prevent race conditions and memory crashes.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    
    username = current_user.get("username", "user")
    logger.info(f"Received {len(files)} files for inventory upload from {username}")
    
    try:
        inventory_folder = get_purchases_folder(username)
        
        # Pre-generate file_keys and read file bytes immediately
        file_data_list = []
        
        for file in files:
            # Read file bytes into memory
            content = await file.read()
            
            # Generate file_key deterministically
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            file_key = f"{inventory_folder}{timestamp}_{file.filename}"
            
            file_data_list.append({
                'content': content,
                'filename': file.filename,
                'file_key': file_key
            })
        
        logger.info(f"Prepared {len(file_data_list)} files for sequential upload")
        
        # Execute sequential upload in thread pool (Blocking operation)
        loop = asyncio.get_event_loop()
        uploaded_keys = await loop.run_in_executor(
            executor,
            process_uploads_batch_sync,
            file_data_list,
            username,
            r2_bucket
        )
        
        if not uploaded_keys:
             raise HTTPException(status_code=500, detail="Failed to upload any files")

        logger.info(f"Successfully uploaded {len(uploaded_keys)} files sequentially")
        
        return {
            "success": True,
            "uploaded_files": uploaded_keys,
            "message": f"Successfully uploaded {len(uploaded_keys)} file(s)"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in upload_inventory_files: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


def process_uploads_batch_sync(
    file_data_list: List[Dict[str, Any]],
    username: str,
    r2_bucket: str
) -> List[str]:
    """
    Process a batch of inventory uploads sequentially and synchronously.
    Running in thread pool to avoid blocking main loop, but blocking the request
    until completion to ensure data integrity and prevent OOM.
    """
    uploaded_keys = []
    logger.info(f"Starting sequential processing of {len(file_data_list)} files for {username}")
    
    for i, file_data in enumerate(file_data_list):
        try:
            logger.info(f"Uploading file {i+1}/{len(file_data_list)}: {file_data['filename']}")
            
            # Re-use existing sync upload logic
            result_key = upload_single_inventory_file_sync(
                content=file_data['content'],
                filename=file_data['filename'],
                username=username,
                r2_bucket=r2_bucket,
                file_key=file_data['file_key']
            )
            
            if result_key:
                uploaded_keys.append(result_key)
                
            # Force garbage collection after large image processing?
            # Usually not needed in Python unless ref cycles, but helps with peak mem
            import gc
            del file_data['content'] 
            gc.collect()
            
        except Exception as e:
            logger.error(f"Failed to upload {file_data.get('filename')}: {e}")
            # Continue with other files even if one fails
            
    logger.info(f"Completed sequential processing. Success: {len(uploaded_keys)}/{len(file_data_list)}")
    return uploaded_keys


def upload_single_inventory_file_sync(
    content: bytes,
    filename: str,
    username: str,
    r2_bucket: str,
    file_key: str  # NEW: Accept pre-generated key
) -> Optional[str]:
    """
    Synchronous helper for single inventory file upload - runs in background task.
    Contains blocking operations: image validation, optimization, and R2 upload.
    
    Args:
        content: File content bytes
        filename: Original filename (for logging)
        username: Username (for logging)
        r2_bucket: R2 bucket name
        file_key: Pre-generated R2 key (path)
    
    Returns:
        File key if successful, None otherwise
    """
    try:
        storage = get_storage_client()
        
        # Validate image quality
        validation = validate_image_quality(content)
        if not validation['is_acceptable']:
            for warning in validation['warnings']:
                logger.warning(f"{filename}: {warning}")
        
        # Optimize image before upload
        if should_optimize_image(content):
            logger.info(f"Optimizing inventory image: {filename}")
            optimized_content, metadata = optimize_image_for_gemini(content)
            
            logger.info(f"Optimization results for {filename}:")
            logger.info(f"  Original: {metadata['original_size_kb']}KB")
            logger.info(f"  Optimized: {metadata['optimized_size_kb']}KB")
            logger.info(f"  Compression: {metadata['compression_ratio']}% reduction")
            
            content = optimized_content
        else:
            logger.info(f"Skipping optimization for {filename}")
        
        # Determine content type (always JPEG after optimization)
        content_type = "image/jpeg"
        
        # Upload to R2 using pre-generated key
        success = storage.upload_file(
            file_data=content,
            bucket=r2_bucket,
            key=file_key,
            content_type=content_type
        )
        
        if success:
            logger.info(f"Uploaded inventory file: {file_key}")
            return file_key
        else:
            logger.error(f"Failed to upload inventory file: {filename}")
            return None
            
    except Exception as e:
        logger.error(f"Error uploading inventory file {filename}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None


@router.post("/process", response_model=InventoryProcessResponse)
async def process_inventory(
    request: InventoryProcessRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Trigger inventory processing in thread pool
    """
    logger.info(f"Received inventory process request for {len(request.file_keys)} files")
    task_id = str(uuid.uuid4())
    
    # Get r2_bucket from user config
    r2_bucket = current_user.get("r2_bucket")
    if not r2_bucket:
        raise HTTPException(status_code=400, detail="No r2_bucket configured for user")
    
    
    # Initialize status in DATABASE
    initial_status = {
        "task_id": task_id,
        "username": current_user.get("username", "user"),
        "status": "queued",
        "task_type": "inventory", # NEW: Distinguish task type
        "message": "Processing queued",
        "progress": {
            "total": len(request.file_keys),
            "processed": 0,
            "failed": 0
        },
        "duplicates": [],
        "errors": [],
        "current_file": "",
        "current_index": 0,
        "uploaded_r2_keys": [],
        "created_at": datetime.utcnow().isoformat()
    }
    
    try:
        from database import get_database_client
        db = get_database_client()
        db.insert("upload_tasks", initial_status)
        logger.info(f"Created inventory task {task_id} for user {current_user.get('username')} in database")
    except Exception as e:
        logger.error(f"Failed to create inventory task in DB: {e}")
        # convert to HTTP 500
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
    # Run in thread pool
    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        executor,
        process_inventory_sync,
        task_id,
        request.file_keys,
        r2_bucket,
        current_user.get("username", "user"),
        request.force_upload  # Pass force_upload parameter
    )
    
    return {
        "task_id": task_id,
        "status": "queued",
        "message": f"Processing {len(request.file_keys)} inventory file(s) in background"
    }


@router.get("/status/{task_id}", response_model=InventoryProcessStatusResponse)
async def get_inventory_process_status(
    task_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get processing status for an inventory task
    """
    """
    Get processing status for an inventory task from DATABASE
    """
    try:
        from database import get_database_client
        db = get_database_client()
        # Query task by ID
        response = db.query("upload_tasks").eq("task_id", task_id).execute()
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(status_code=404, detail="Task not found")
        
        status_record = response.data[0]
        
        # Verify ownership (optional but good practice)
        if status_record.get("username") != current_user.get("username") and current_user.get("role") != "admin":
             # Silently return 404 or just pass if we trust UUID security
             pass 

        return {
            "task_id": status_record.get("task_id"),
            "status": status_record.get("status", "unknown"),
            "progress": status_record.get("progress", {}),
            "message": status_record.get("message", ""),
            "duplicates": status_record.get("duplicates", []),
            "uploaded_r2_keys": status_record.get("uploaded_r2_keys", [])
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching inventory task status {task_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch status: {str(e)}")


@router.get("/recent-task", response_model=InventoryProcessStatusResponse)
async def get_recent_inventory_task(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get the most recent upload task for the current user.
    Useful for resuming progress bars if the user refreshes the page.
    """
    try:
        from database import get_database_client
        db = get_database_client()
        
        # Fetch most recent task
        response = db.client.table("upload_tasks")\
            .select("*")\
            .eq("username", current_user.get("username"))\
            .eq("task_type", "inventory")\
            .order("created_at", desc=True)\
            .limit(1)\
            .execute()
            
        if not response.data or len(response.data) == 0:
            raise HTTPException(status_code=404, detail="No recent tasks found")
            
        status_record = response.data[0]
        
        return {
            "task_id": status_record.get("task_id"),
            "status": status_record.get("status", "unknown"),
            "progress": status_record.get("progress", {}),
            "message": status_record.get("message", ""),
            "duplicates": status_record.get("duplicates", []),
            "uploaded_r2_keys": status_record.get("uploaded_r2_keys", [])
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching recent inventory task: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch recent task: {str(e)}")


def process_inventory_sync(
    task_id: str,
    file_keys: List[str],  # These are R2 keys now
    r2_bucket: str,
    username: str,
    force_upload: bool = False
):
    """
    Synchronous background task to process inventory
    1. Process with Gemini (files already in R2)
    """
    import os
    
    logger.info(f"=== INVENTORY PROCESSING STARTED ===")
    logger.info(f"Task ID: {task_id}")
    logger.info(f"Files: {len(file_keys)} R2 keys")
    logger.info(f"User: {username}")
    
    # Helper to update DB status
    def update_db_status(status_update: Dict[str, Any]):
        try:
            from database import get_database_client
            db = get_database_client()
            status_update["updated_at"] = datetime.utcnow().isoformat()
            db.update("upload_tasks", status_update, {"task_id": task_id})
        except Exception as e:
            logger.error(f"Failed to update inventory task status in DB: {e}")

    # Initialize current status dict for local updates (efficiency)
    current_status = {
        "progress": {
            "total": len(file_keys),
            "processed": 0,
            "failed": 0
        }
    }

    try:
        # Files are already in R2
        r2_file_keys = file_keys
        
        # Phase 2: Process inventory
        logger.info("Phase 2: Processing inventory with AI...")
        
        update_db_status({
            "status": "processing",
            "message": "Processing inventory items...",
            "progress": current_status["progress"],
            "start_time": datetime.now().isoformat()
        })
        
        def update_progress(current_index: int, failed_count: int, total: int, current_file: str):
            current_status["progress"]["processed"] = current_index
            current_status["progress"]["failed"] = failed_count
            
            update_db_status({
                "progress": current_status["progress"],
                "current_file": current_file,
                "current_index": current_index,
                "message": f"Processing: {current_file}"
            })
            logger.info(f"Progress: {current_index}/{total} (Failed: {failed_count}) - {current_file}")
        
        from services.inventory_processor import process_inventory_batch
        
        results = process_inventory_batch(
            file_keys=r2_file_keys,
            r2_bucket=r2_bucket,
            username=username,
            progress_callback=update_progress,
            force_upload=force_upload
        )
        
        logger.info(f"Processing completed. Results: {results}")
        
        # Check for duplicates
        if results.get("duplicates"):
            update_db_status({
                "status": "duplicate_detected",
                "duplicates": results["duplicates"],
                "uploaded_r2_keys": r2_file_keys, # CRITICAL: Frontend needs ALL R2 keys
                "message": f"Duplicate vendor invoices detected: {len(results['duplicates'])} file(s)"
            })
            logger.info(f"Duplicates detected: {len(results['duplicates'])}")
        else:
            update_db_status({
                "status": "completed",
                "progress": {
                    "total": results.get("total", len(r2_file_keys)),
                    "processed": results["processed"],
                    "failed": results["failed"]
                },
                "message": f"Successfully processed {results['processed']} vendor invoices",
                "current_file": "All complete",
                "duplicates": results.get("duplicates", []),
                "end_time": datetime.now().isoformat()
            })
            
            # AUTO-RECALCULATION: Trigger stock recalculation after successful inventory processing
            # This ensures stock levels are always up-to-date
            # Advisory locks prevent race conditions with concurrent recalculations
            if results["processed"] > 0:
                logger.info(f"🔄 Auto-triggering stock recalculation for {username}...")
                try:
                    from routes.stock_routes import recalculate_stock_wrapper
                    
                    # Ensure table exists first (safeguard)
                    # create_recalculation_tasks_table_if_not_exists()
                    
                    # Create a task_id for tracking
                    recalc_task_id = str(uuid.uuid4())
                    
                    # Initialize task in DB (required for wrapper updates)
                    try:
                        from database import get_database_client
                        db = get_database_client()
                        db.insert("recalculation_tasks", {
                            "task_id": recalc_task_id,
                            "username": username,
                            "status": "queued",
                            "message": "Auto-triggered after inventory upload",
                            "progress": {"total": 0, "processed": 0},
                            "created_at": datetime.utcnow().isoformat()
                        })
                    except Exception as db_err:
                        logger.warning(f"Could not create recalculation task record: {db_err}")
                    
                    # Run in background (uses stock_executor thread pool)
                    # Pass BOTH task_id and username as required by wrapper
                    recalculate_stock_wrapper(recalc_task_id, username)
                    logger.info(f"✅ Stock recalculation queued for {username} (Task: {recalc_task_id})")
                except Exception as e:
                    logger.error(f"❌ Auto-recalculation failed for {username}: {e}")
                    # Don't fail the upload if recalculation fails
                    # User can manually trigger recalculation later
        
        if results["errors"]:
            # Optionally update errors in DB
            # update_db_status({"errors": results["errors"]})
            logger.warning(f"Processing errors: {results['errors']}")
        
    except Exception as e:
        logger.error(f"=== INVENTORY PROCESSING FAILED ===")
        logger.error(f"Error processing inventory: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        update_db_status({
            "status": "failed",
            "message": f"Processing failed: {str(e)}",
            "end_time": datetime.now().isoformat()
        })
    
    finally:
        logger.info("=== INVENTORY PROCESSING COMPLETED ===")


@router.get("/items")
async def get_inventory_items(
    show_all: bool = False,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get inventory items with optional filtering
    Default: only show items with amount_mismatch > 0
    """
    from database import get_database_client
    
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Base query
        query = db.client.table("inventory_items").select("*").eq("username", username)
        
        # Apply filter if not showing all
        if not show_all:
            query = query.gt("amount_mismatch", 0)
        
        # Order by created_at descending
        query = query.order("created_at", desc=True)
        
        response = query.execute()
        
        return {
            "success": True,
            "items": response.data,
            "count": len(response.data)
        }
    except Exception as e:
        logger.error(f"Error fetching inventory items: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/items/{item_id}")
async def update_inventory_item(
    item_id: int,
    updates: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update an inventory item
    """
    from database import get_database_client
    
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Add updated_at timestamp
        updates["updated_at"] = datetime.now().isoformat()
        
        # Update the item
        response = db.client.table("inventory_items")\
            .update(updates)\
            .eq("id", item_id)\
            .eq("username", username)\
            .execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Item not found")
        
        return {
            "success": True,
            "item": response.data[0]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating inventory item: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/items/{item_id}")
async def delete_inventory_item(
    item_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete an inventory item by ID
    """
    from database import get_database_client
    
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Delete the item
        response = db.client.table("inventory_items")\
            .delete()\
            .eq("id", item_id)\
            .eq("username", username)\
            .execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Item not found")
        
        logger.info(f"Deleted inventory item with id: {item_id}")
        
        return {
            "success": True,
            "message": f"Deleted inventory item {item_id}"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting inventory item: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@router.delete("/by-hash/{image_hash}")
async def delete_by_image_hash(
    image_hash: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete all inventory items with the given image_hash (for duplicate replacement)
    """
    from database import get_database_client
    
    try:
        db = get_database_client()
        username = current_user.get("username")
        
        # Delete all items with this image_hash for this user
        result = db.client.table("inventory_items")\
            .delete()\
            .eq("image_hash", image_hash)\
            .eq("username", username)\
            .execute()
        
        deleted_count = len(result.data) if result.data else 0
        
        logger.info(f"Deleted {deleted_count} inventory items with image_hash: {image_hash}")
        
        return {
            "success": True,
            "deleted_count": deleted_count,
            "message": f"Deleted {deleted_count} inventory item(s)"
        }
        
    except Exception as e:
        logger.error(f"Error deleting inventory items by image_hash: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/items/delete-bulk")
async def delete_bulk_inventory_items(
    request: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete multiple inventory items by IDs
    """
    from database import get_database_client
    
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    ids = request.get('ids', [])
    if not ids:
        raise HTTPException(status_code=400, detail="ids array is required")
    
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids must be an array")
    
    try:
        db = get_database_client()
        
        # Delete all items matching the IDs for this user
        deleted_count = 0
        for item_id in ids:
            response = db.client.table("inventory_items")\
                .delete()\
                .eq("id", item_id)\
                .eq("username", username)\
                .execute()
            
            if response.data:
                deleted_count += 1
        
        logger.info(f"Deleted {deleted_count} inventory items for {username}")
        
        return {
            "success": True,
            "message": f"Deleted {deleted_count} items successfully",
            "deleted_count": deleted_count
        }
    
    except Exception as e:
        logger.error(f"Error deleting inventory items in bulk: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete inventory items: {str(e)}")


@router.get("/export")
async def export_inventory_to_excel(
    search: Optional[str] = None,
    invoice_number: Optional[str] = None,
    part_number: Optional[str] = None,
    description: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Export filtered inventory items to Excel
    Includes ALL columns up to amount_mismatch from the database
    """
    from database import get_database_client
    import pandas as pd
    from io import BytesIO
    from fastapi.responses import StreamingResponse
    
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Build query with all columns
        query = db.client.table("inventory_items").select("*").eq("username", username)
        
        # Apply filters
        if invoice_number:
            query = query.ilike("invoice_number", f"%{invoice_number}%")
        
        if part_number:
            query = query.ilike("part_number", f"%{part_number}%")
        
        if description:
            query = query.ilike("description", f"%{description}%")
        
        if date_from:
            query = query.gte("invoice_date", date_from)
        
        if date_to:
            query = query.lte("invoice_date", date_to)
        
        # Order by upload_date descending
        query = query.order("upload_date", desc=True)
        
        response = query.execute()
        items = response.data or []
        
        # Apply status filter (post-query since it's computed)
        if status:
            items = [
                item for item in items
                if (item.get('amount_mismatch', 0) == 0 and status == 'Done') or
                   (item.get('amount_mismatch', 0) != 0 and item.get('verification_status', 'Pending') == status)
            ]
        
        # Apply general search filter (post-query)
        if search:
            search_lower = search.lower()
            items = [
                item for item in items
                if any(str(val).lower().find(search_lower) != -1 for val in item.values() if val is not None)
            ]
        
        if not items:
            # Return empty Excel file
            df = pd.DataFrame()
        else:
            # Select columns up to and including amount_mismatch
            columns_to_export = [
                'id',
                'invoice_date',
                'invoice_number',
                'part_number',
                'batch',
                'description',
                'hsn',
                'qty',
                'rate',
                'disc_percent',
                'taxable_amount',
                'cgst_percent',
                'sgst_percent',
                'discounted_price',
                'taxed_amount',
                'net_bill',
                'amount_mismatch',
                'verification_status',
                'upload_date',
                'receipt_link',
            ]
            
            # Filter to only existing columns
            available_columns = [col for col in columns_to_export if col in items[0]]
            
            # Create DataFrame
            df = pd.DataFrame(items)[available_columns]
            
            # Rename columns for better readability
            column_names = {
                'id': 'ID',
                'invoice_date': 'Invoice Date',
                'invoice_number': 'Invoice Number',
                'part_number': 'Part Number',
                'batch': 'Batch',
                'description': 'Description',
                'hsn': 'HSN',
                'qty': 'Quantity',
                'rate': 'Rate',
                'disc_percent': 'Discount %',
                'taxable_amount': 'Taxable Amount',
                'cgst_percent': 'CGST %',
                'sgst_percent': 'SGST %',
                'discounted_price': 'Discounted Price',
                'taxed_amount': 'Taxed Amount',
                'net_bill': 'Net Bill',
                'amount_mismatch': 'Amount Mismatch',
                'verification_status': 'Verification Status',
                'upload_date': 'Upload Date',
                'receipt_link': 'Receipt Link',
            }
            df.rename(columns=column_names, inplace=True)
        
        # Create Excel file in memory
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Inventory')
            
            # Auto-adjust column widths
            worksheet = writer.sheets['Inventory']
            for column in worksheet.columns:
                max_length = 0
                column_letter = column[0].column_letter
                for cell in column:
                    try:
                        if len(str(cell.value)) > max_length:
                            max_length = len(str(cell.value))
                    except:
                        pass
                adjusted_width = min(max_length + 2, 50)
                worksheet.column_dimensions[column_letter].width = adjusted_width
        
                # Add this code after line 583 in inventory.py (after worksheet.column_dimensions[column_letter].width = adjusted_width)
                hyperlink_code = """
                            # Convert receipt links to clickable hyperlinks
                            from openpyxl.styles import Font, colors
                            receipt_link_col = None
                            for idx, col in enumerate(worksheet[1], 1):  # Header row
                                if col.value == 'Receipt Link':
                                    receipt_link_col = idx
                                    break
                            
                            if receipt_link_col:
                                for row_idx in range(2, worksheet.max_row + 1):  # Skip header
                                    cell = worksheet.cell(row=row_idx, column=receipt_link_col)
                                    if cell.value and str(cell.value).startswith('http'):
                                        cell.hyperlink = cell.value
                                        cell.value = 'View Image'
                                        cell.font = Font(color=colors.BLUE, underline='single')
                """
        output.seek(0)
        
        # Return as streaming response
        filename = f"inventory_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        logger.error(f"Error exporting inventory to Excel: {e}")
        raise HTTPException(status_code=500, detail=str(e))
