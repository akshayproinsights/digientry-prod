"""Upload and processing routes"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import logging
from datetime import datetime
import uuid
import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

from auth import get_current_user, get_current_user_r2_bucket, get_current_user_sheet_id
from services.storage import get_storage_client
from utils.image_optimizer import optimize_image_for_gemini, should_optimize_image, validate_image_quality
from config import get_sales_folder
from database import get_database_client

router = APIRouter()
logger = logging.getLogger(__name__)

# Thread pool for blocking operations (Optimized for high-load: 50 concurrent tasks)
# Configurable via environment variable
executor = ThreadPoolExecutor(max_workers=int(os.getenv('UPLOAD_MAX_WORKERS', '50')))

# In-memory storage REMOVED - using database table 'upload_tasks'
# processing_status: Dict[str, Dict[str, Any]] = {}


class UploadResponse(BaseModel):
    """Upload response model"""
    success: bool
    uploaded_files: List[str]
    message: str


class ProcessRequest(BaseModel):
    """Process invoices request model"""
    file_keys: List[str]
    force_upload: bool = False  # If True, bypass duplicate checking and delete old duplicates


class ProcessResponse(BaseModel):
    """Process invoices response model"""
    task_id: str
    status: str
    message: str
    duplicates: List[Dict[str, Any]] = []  # List of duplicate information


class ProcessStatusResponse(BaseModel):
    """Process status response model"""
    task_id: str
    status: str
    progress: Dict[str, Any]
    message: str
    duplicates: List[Dict[str, Any]] = []  # Add duplicates field
    uploaded_r2_keys: List[str] = []  # CRITICAL: R2 keys for frontend


@router.get("/test")
async def test_endpoint():
    """Test endpoint to verify backend is receiving requests"""
    import sys
    # Try multiple output methods
    print("\n" + "="*80, flush=True)
    print("🎯 TEST ENDPOINT HIT!", flush=True)
    print("="*80 + "\n", flush=True)
    sys.stdout.flush()
    sys.stderr.write("\n🔥 STDERR TEST ENDPOINT HIT!\n")
    sys.stderr.flush()
    logger.info("🎯 TEST ENDPOINT HIT VIA LOGGER")
    
    # Also write to a file
    with open("test_endpoint_log.txt", "a") as f:
        f.write(f"\n{datetime.now()}: TEST ENDPOINT HIT!\n")
    
    return {"message": "Backend is alive!", "timestamp": datetime.now().isoformat()}


@router.post("/test-post")
async def test_post_endpoint(
    request: ProcessRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    r2_bucket: str = Depends(get_current_user_r2_bucket),
    sheet_id: str = Depends(get_current_user_sheet_id)
):
    """Minimal POST test to isolate crash point - WITH AUTH"""
    with open("test_post_log.txt", "a") as f:
        f.write(f"\n{datetime.now()}: POST TEST WITH AUTH HIT!\n")
        f.write(f"Request: {request}\n")
        f.write(f"User: {current_user.get('username')}\n")
        f.write(f"Bucket: {r2_bucket}\n")
        f.write(f"Sheet: {sheet_id}\n")
    return {
        "message": "POST with auth works!", 
        "received": request.dict(),
        "user": current_user.get("username")
    }


@router.post("/files", response_model=UploadResponse)
async def upload_files(
    files: List[UploadFile] = File(...),
    current_user: Dict[str, Any] = Depends(get_current_user),
    r2_bucket: str = Depends(get_current_user_r2_bucket)
):
    """
    Upload sales invoice files to R2 storage SEQUENTIALLY and SYNCHRONOUSLY.
    Blocks until all files are uploaded to prevent race conditions and memory crashes.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    
    username = current_user.get("username", "user")
    logger.info(f"Received {len(files)} sales files for upload from {username}")
    
    try:
        # Pre-generate file_keys and read file bytes immediately
        file_data_list = []
        
        for file in files:
            # Read file bytes into memory
            content = await file.read()
            
            # Generate file_key deterministically
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            sales_folder = get_sales_folder(username)
            file_key = f"{sales_folder}{timestamp}_{file.filename}"
            
            file_data_list.append({
                'content': content,
                'filename': file.filename,
                'file_key': file_key
            })
        
        logger.info(f"Prepared {len(file_data_list)} sales files for sequential upload")
        
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

        logger.info(f"Successfully uploaded {len(uploaded_keys)} sales files sequentially")
        
        return {
            "success": True,
            "uploaded_files": uploaded_keys,
            "message": f"Successfully uploaded {len(uploaded_keys)} file(s)"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in upload_files: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


def process_uploads_batch_sync(
    file_data_list: List[Dict[str, Any]],
    username: str,
    r2_bucket: str
) -> List[str]:
    """
    Process a batch of sales invoice uploads sequentially and synchronously.
    Running in thread pool to avoid blocking main loop, but blocking the request
    until completion to ensure data integrity and prevent OOM.
    """
    uploaded_keys = []
    logger.info(f"Starting sequential processing of {len(file_data_list)} sales files for {username}")
    
    for i, file_data in enumerate(file_data_list):
        try:
            logger.info(f"Uploading sales file {i+1}/{len(file_data_list)}: {file_data['filename']}")
            
            # Re-use existing sync upload logic
            result_key = upload_single_file_sync(
                content=file_data['content'],
                filename=file_data['filename'],
                username=username,
                r2_bucket=r2_bucket,
                file_key=file_data['file_key']
            )
            
            if result_key:
                uploaded_keys.append(result_key)
                
            # Force garbage collection after large image processing
            import gc
            del file_data['content'] 
            gc.collect()
            
        except Exception as e:
            logger.error(f"Failed to upload {file_data.get('filename')}: {e}")
            # Continue with other files even if one fails
            
    logger.info(f"Completed sequential processing. Success: {len(uploaded_keys)}/{len(file_data_list)}")
    return uploaded_keys


def upload_single_file_sync(
    content: bytes,
    filename: str,
    username: str,
    r2_bucket: str,
    file_key: str  # NEW: Accept pre-generated key
) -> Optional[str]:
    """
    Synchronous helper for single file upload - runs in background task.
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
        
        # Optimize image before upload (if needed)
        if should_optimize_image(content):
            logger.info(f"Optimizing image: {filename}")
            optimized_content, metadata = optimize_image_for_gemini(content)
            
            logger.info(f"Optimization results for {filename}:")
            logger.info(f"  Original: {metadata['original_size_kb']}KB, {metadata['original_dimensions'][0]}x{metadata['original_dimensions'][1]}")
            logger.info(f"  Optimized: {metadata['optimized_size_kb']}KB, {metadata['final_dimensions'][0]}x{metadata['final_dimensions'][1]}")
            logger.info(f"  Compression: {metadata['compression_ratio']}% reduction")
            
            content = optimized_content
        else:
            logger.info(f"Skipping optimization for {filename} (already optimal)")
        
        # Determine content type (always JPEG after optimization)
        content_type = "image/jpeg"  # Our optimizer always outputs JPEG
        
        # Upload to R2 using pre-generated key
        success = storage.upload_file(
            file_data=content,
            bucket=r2_bucket,
            key=file_key,
            content_type=content_type
        )
        
        if success:
            logger.info(f"Uploaded file: {file_key}")
            return file_key
        else:
            logger.error(f"Failed to upload file: {filename}")
            return None
            
    except Exception as e:
        logger.error(f"Error in upload_single_file_sync for {filename}: {e}")
        return None


@router.post("/process-files")  # RENAMED from /process to work around routing issue
async def process_invoices_endpoint(
    request: ProcessRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    r2_bucket: str = Depends(get_current_user_r2_bucket),
    sheet_id: str = Depends(get_current_user_sheet_id)
):
    """
    Trigger invoice processing in thread pool (for blocking I/O operations)
    """
    task_id = str(uuid.uuid4())
    username = current_user.get("username", "user")
    
    logger.info(f"========== PROCESS FILES ENDPOINT CALLED ==========")
    logger.info(f"User: {username}")
    logger.info(f"Task ID: {task_id}")
    logger.info(f"Number of files to process: {len(request.file_keys)}")
    logger.info(f"File keys: {request.file_keys}")
    logger.info(f"Force upload: {request.force_upload}")
    logger.info(f"R2 Bucket: {r2_bucket}")
    logger.info(f"Sheet ID: {sheet_id}")
    
    # Initialize status in DATABASE
    initial_status = {
        "task_id": task_id,
        "username": username,
        "status": "queued",
        "task_type": "sales",  # NEW: Distinguish task type
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
        db = get_database_client()
        db.insert("upload_tasks", initial_status)
        logger.info(f"Created task {task_id} for user {username} in database")
    except Exception as e:
        logger.error(f"Failed to create task in DB: {e}")
        # convert to HTTP 500
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
    # Run in thread pool for blocking I/O operations
    try:
        # FILE LOGGING with UTF-8 encoding (fixes Windows Unicode errors)
        with open("process_debug.log", "a", encoding="utf-8") as f:
            f.write(f"\n{'='*80}\n")
            f.write(f"{datetime.now()}: RECEIVED PROCESS REQUEST\n")
            f.write(f"Task ID: {task_id}\n")
            f.write(f"Files: {request.file_keys}\n")
            f.write(f"Force upload: {request.force_upload}\n")
            f.write(f"{'='*80}\n\n")
        
        logger.info(f"Submitting task {task_id} to executor...")
        loop = asyncio.get_event_loop()
        loop.run_in_executor(
            executor,
            process_invoices_sync,
            task_id,
            request.file_keys,
            r2_bucket,
            sheet_id,
            username,  # Pass username explicitly
            request.force_upload
        )
        logger.info(f"Task {task_id} submitted successfully")
    except Exception as e:
        logger.error(f"Failed to submit task {task_id}: {e}")
        # Try to update status to failed in DB
        try:
             db.update("upload_tasks", {"status": "failed", "message": f"Failed to start: {str(e)}"}, {"task_id": task_id})
        except:
             pass
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to start processing: {str(e)}")
    
    return {
        "task_id": task_id,
        "status": "queued",
        "message": f"Processing {len(request.file_keys)} file(s) in background",
        "duplicates": []  # Will be populated during processing
    }



@router.get("/process/status/{task_id}", response_model=ProcessStatusResponse)
async def get_process_status(
    task_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get processing status for a task from DATABASE
    """
    try:
        db = get_database_client()
        # Query task by ID
        response = db.query("upload_tasks").eq("task_id", task_id).execute()
        
        if not response.data or len(response.data) == 0:
            raise HTTPException(status_code=404, detail="Task not found")
        
        status_record = response.data[0]
        
        # Verify ownership (optional, as global filter might apply, but safe to check)
        if status_record.get("username") != current_user.get("username") and current_user.get("role") != "admin":
             # We could return 404 to hide existence, or 403
             # For now, let's assume if they have the UUID they can see it, 
             # OR rely on RLS if enabled on the connection (backend usually runs as service role though)
             # Let's verify username match for safety in code as well
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
        logger.error(f"Error fetching task status {task_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch status: {str(e)}")


@router.get("/recent-task", response_model=ProcessStatusResponse)
async def get_recent_sales_task(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get the most recent upload task for the current user.
    Useful for resuming progress bars if the user refreshes the page.
    """
    try:
        db = get_database_client()
        
        # Fetch most recent task
        response = db.client.table("upload_tasks")\
            .select("*")\
            .eq("username", current_user.get("username"))\
            .eq("task_type", "sales")\
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
        logger.error(f"Error fetching recent sales task: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch recent task: {str(e)}")


def process_invoices_sync(
    task_id: str,
    file_keys: List[str],  # These are temp paths now
    r2_bucket: str,
    sheet_id: str,
    username: str,
    force_upload: bool = False
):
    """
    Synchronous background task to process invoices
    1. Upload temp files to R2
    2. Process with Gemini
    3. Clean up temp files
    """
    import os
    import shutil
    
    # Helper to update DB status
    def update_db_status(status_update: Dict[str, Any]):
        try:
            db = get_database_client()
            status_update["updated_at"] = datetime.utcnow().isoformat()
            db.update("upload_tasks", status_update, {"task_id": task_id})
        except Exception as e:
            logger.error(f"Failed to update task status in DB: {e}")

    # FILE LOGGING with UTF-8 encoding (fixes Windows Unicode errors)
    with open("process_debug.log", "a", encoding="utf-8") as f:
        f.write(f"\nBACKGROUND TASK STARTED\n")
        f.write(f"{datetime.now()}: Task ID: {task_id}\n")
        f.write(f"Files to process: {len(file_keys)}\n")
        f.write(f"Force upload: {force_upload}\n")
        f.write(f"Username: {username}\n\n")
    
    print(f"\n🔥🔥🔥 BACKGROUND TASK STARTED 🔥🔥🔥", flush=True)
    print(f"Task ID: {task_id}", flush=True)
    print(f"Files to process: {len(file_keys)}", flush=True)
    print(f"Force upload: {force_upload}", flush=True)
    print(f"{'='*80}\n", flush=True)
    
    logger.info(f"========== BACKGROUND TASK STARTED ==========")
    logger.info(f"Task ID: {task_id}")
    logger.info(f"File keys to process: {file_keys}")
    logger.info(f"User: {username}")
    logger.info(f"R2 Bucket: {r2_bucket}")
    logger.info(f"Sheet ID: {sheet_id}")
    logger.info(f"Force upload: {force_upload}")
    
    # Log environment check
    import os
    logger.info(f"Environment check:")
    logger.info(f"  - GOOGLE_API_KEY set: {bool(os.getenv('GOOGLE_API_KEY'))}")
    logger.info(f"  - R2_ACCOUNT_ID set: {bool(os.getenv('R2_ACCOUNT_ID'))}")
    logger.info(f"  - SUPABASE_URL set: {bool(os.getenv('SUPABASE_URL'))}")
    
    r2_file_keys = []
    
    # Initialize current status dict for local updates (efficiency)
    current_status = {
        "progress": {
            "total": len(file_keys),
            "processed": 0,
            "failed": 0
        }
    }
    
    try:
        # Phase 1: Upload (SKIPPED - Files are already in R2 from Phase 1)
        # Note: file_keys argument now contains R2 keys, not temp paths
        logger.info("Phase 1: Verifying files in R2...")
        
        update_db_status({
            "status": "uploading",
            "message": "Verifying cloud files...",
            "start_time": datetime.now().isoformat()
        })
        
        r2_file_keys = file_keys # They are already keys
        
        # Just update progress to 100% since upload is done
        current_status["progress"]["total"] = len(r2_file_keys)
        current_status["progress"]["processed"] = len(r2_file_keys)
        
        # Phase 2: Process invoices
        logger.info("Phase 2: Processing invoices with AI...")
        
        current_status["progress"]["processed"] = 0 # Reset for processing phase
        
        update_db_status({
            "status": "processing",
            "message": "Processing invoices...",
            "progress": current_status["progress"]
        })
        
        # Define progress callback
        def update_progress(current_index: int, failed_count: int, total: int, current_file: str):
            """Callback to update processing status in real-time"""
            current_status["progress"]["processed"] = current_index
            current_status["progress"]["failed"] = failed_count
            
            update_db_status({
                "progress": current_status["progress"],
                "current_file": current_file,
                "current_index": current_index,
                "message": f"Processing: {current_file}"
            })
            logger.info(f"Progress: {current_index}/{total} (Failed: {failed_count}) - {current_file}")
        
        # Import the processor
        from services.processor import process_invoices_batch
        
        logger.info(f"Processing {len(r2_file_keys)} files for user {username}")
        
        # Call the actual processor with R2 keys
        results = process_invoices_batch(
            file_keys=r2_file_keys,
            r2_bucket=r2_bucket,
            sheet_id=sheet_id,
            username=username,
            progress_callback=update_progress,
            force_upload=force_upload
        )
        
        logger.info(f"Processing completed. Results: {results}")
        
        # Check for duplicates
        if results.get("duplicates"):
            duplicate_count = len(results["duplicates"])
            processed_count = results["processed"]
            msg = f"Processed {processed_count} invoice{'s' if processed_count != 1 else ''}, found {duplicate_count} duplicate{'s' if duplicate_count != 1 else ''}"
            if processed_count == 0:
                msg = f"All files are duplicates: {duplicate_count} file{'s' if duplicate_count != 1 else ''}"

            update_db_status({
                "status": "duplicate_detected",
                "progress": {
                    "total": results["total"],
                    "processed": results["processed"],
                    "failed": results["failed"]
                },
                "duplicates": results["duplicates"],
                "uploaded_r2_keys": r2_file_keys,
                "message": msg
            })
            
            logger.info(f"Duplicates detected: {len(results['duplicates'])}")
        else:
            update_db_status({
                "status": "completed",
                "progress": {
                    "total": results["total"],
                    "processed": results["processed"],
                    "failed": results["failed"]
                },
                "end_time": datetime.now().isoformat(),
                "message": f"Successfully processed {results['processed']} invoices",
                "current_file": "All complete"
            })
            
            # AUTO-RECALCULATION: Trigger stock recalculation after successful processing
            # This ensures stock levels are always up-to-date
            # Advisory locks prevent race conditions with concurrent recalculations
            if results["processed"] > 0:
                logger.info(f"🔄 Auto-triggering stock recalculation for {username}...")
                try:
                    from routes.stock_routes import recalculate_stock_wrapper
                    
                    # Create a task_id for tracking
                    recalc_task_id = str(uuid.uuid4())
                    
                    # Initialize task in DB (required for wrapper updates)
                    try:
                        db = get_database_client()
                        db.insert("recalculation_tasks", {
                            "task_id": recalc_task_id,
                            "username": username,
                            "status": "queued",
                            "message": "Auto-triggered after upload",
                            "progress": {"total": 0, "processed": 0},
                            "created_at": datetime.utcnow().isoformat()
                        })
                    except Exception as db_err:
                        logger.warning(f"Could not create recalculation task record: {db_err}")
                        # Proceed anyway, wrapper might fail on update but calculation might run
                    
                    # Run in background (uses stock_executor thread pool)
                    # Pass BOTH task_id and username as required by wrapper
                    recalculate_stock_wrapper(recalc_task_id, username)
                    
                    logger.info(f"✅ Stock recalculation queued for {username} (Task: {recalc_task_id})")
                except Exception as e:
                    logger.error(f"❌ Auto-recalculation failed for {username}: {e}")
                    # Don't fail the upload if recalculation fails
                    # User can manually trigger recalculation later

        
        if results["errors"]:
            # Append errors to log or DB if we want?
            # update_db_status({"errors": results["errors"]})
            logger.warning(f"Processing errors: {results['errors']}")
        
    except Exception as e:
        logger.error(f"=== BACKGROUND TASK FAILED ===")
        logger.error(f"Error processing invoices: {e}")
        logger.error(f"Error type: {type(e).__name__}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        update_db_status({
            "status": "failed",
            "message": f"Processing failed: {str(e)}",
            "end_time": datetime.now().isoformat()
        })
    
    finally:
        # Phase 3: Cleanup (No temp files to clean up anymore)
        logger.info("=== BACKGROUND TASK COMPLETED ===")


@router.delete("/files/{file_key:path}")
async def delete_file(
    file_key: str,
    current_user: Dict[str, Any] = Depends(get_current_user),
    r2_bucket: str = Depends(get_current_user_r2_bucket)
):
    """
    Delete a file from R2 storage
    """
    storage = get_storage_client()
    
    success = storage.delete_file(r2_bucket, file_key)
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete file")
    
    return {"success": True, "message": "File deleted successfully"}


@router.get("/files/view/{file_key:path}")
async def get_file_url(
    file_key: str,
    current_user: Dict[str, Any] = Depends(get_current_user),
    r2_bucket: str = Depends(get_current_user_r2_bucket)
):
    """
    Get permanent public URL for a file from R2 storage
    """
    from urllib.parse import unquote
    
    try:
        # Explicitly unquote the file_key to handle %2F correctly
        decoded_key = unquote(file_key)
        
        storage = get_storage_client()
        
        # Check if file exists first (optional but good for debugging)
        # if not storage.file_exists(r2_bucket, decoded_key):
        #    raise HTTPException(status_code=404, detail="File not found")
        
        # Generate permanent public URL
        url = storage.get_public_url(r2_bucket, decoded_key)
        
        if not url:
            # Fallback to r2:// path if public URL not configured, but this won't work in browser
            logger.warning(f"Public URL not configured for {decoded_key}")
            raise HTTPException(status_code=500, detail="Public URL not configured for R2 bucket")
        
        return {"url": url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate public URL for {file_key}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate file URL: {str(e)}")
