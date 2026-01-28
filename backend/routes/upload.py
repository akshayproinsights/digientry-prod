"""Upload and processing routes"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import logging
from datetime import datetime
import uuid
import asyncio
from concurrent.futures import ThreadPoolExecutor

from auth import get_current_user, get_current_user_r2_bucket, get_current_user_sheet_id
from services.storage import get_storage_client
from utils.image_optimizer import optimize_image_for_gemini, should_optimize_image, validate_image_quality
from config import get_sales_folder

router = APIRouter()
logger = logging.getLogger(__name__)

# Thread pool for blocking operations (increased for bulk uploads)
executor = ThreadPoolExecutor(max_workers=10)

# In-memory storage for processing status (in production, use Redis or database)
processing_status: Dict[str, Dict[str, Any]] = {}


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
    Accept files from frontend and save temporarily on server.
    Returns immediately with temp file references.
    R2 upload will happen in background when processing starts.
    """
    import asyncio
    
    # 1. Read all files into memory (concurrently read if possible, but File read is async)
    # Be careful with memory usage for huge files, but invoices are small images
    uploads = []
    username = current_user.get("username", "user")
    
    try:
        # Prepare arguments for threaded execution
        upload_tasks = []
        loop = asyncio.get_event_loop()
        
        for file in files:
            content = await file.read()
            # Schedule upload in thread pool
            task = loop.run_in_executor(
                executor,
                upload_single_file_sync,
                content,
                file.filename,
                username,
                r2_bucket
            )
            upload_tasks.append(task)
        
        # Wait for all uploads to finish
        logger.info(f"Uploading {len(files)} files to R2 in parallel...")
        results = await asyncio.gather(*upload_tasks)
        
        # Filter successful uploads (None indicates failure)
        uploaded_keys = [key for key in results if key is not None]
        
        if len(uploaded_keys) == 0 and len(files) > 0:
            raise HTTPException(status_code=500, detail="Failed to upload any files to storage")
            
        logger.info(f"Successfully uploaded {len(uploaded_keys)}/{len(files)} files to R2")
        
        return {
            "success": True,
            "uploaded_files": uploaded_keys,  # These are now R2 KEYS
            "message": f"Uploaded {len(uploaded_keys)} of {len(files)} file(s)"
        }
        
    except Exception as e:
        logger.error(f"Error in upload_files: {e}")
        # traceback
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


def upload_single_file_sync(
    content: bytes,
    filename: str,
    username: str,
    r2_bucket: str
) -> Optional[str]:
    """
    Synchronous helper for single file upload - runs in thread pool.
    Contains blocking operations: image validation, optimization, and R2 upload.
    """
    try:
        storage = get_storage_client()
        
        # Generate unique key using centralized folder function
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        sales_folder = get_sales_folder(username)
        file_key = f"{sales_folder}{timestamp}_{filename}"
        
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
        
        # Upload to R2
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
    
    # Initialize status
    processing_status[task_id] = {
        "status": "queued",
        "progress": {
            "total": len(request.file_keys),
            "processed": 0,
            "failed": 0
        },
        "message": "Processing queued",
        "current_file": "",
        "current_index": 0,
        "start_time": None,
        "end_time": None
    }
    
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
            current_user.get("username", "user"),
            request.force_upload
        )
        logger.info(f"Task {task_id} submitted successfully")
    except Exception as e:
        logger.error(f"Failed to submit task {task_id}: {e}")
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
    Get processing status for a task
    """
    if task_id not in processing_status:
        raise HTTPException(status_code=404, detail="Task not found")
    
    status = processing_status[task_id]
    
    return {
        "task_id": task_id,
        "status": status.get("status", "unknown"),
        "progress": status.get("progress", {}),
        "message": status.get("message", ""),
        "duplicates": status.get("duplicates", []),  # Include duplicates info
        "uploaded_r2_keys": status.get("uploaded_r2_keys", [])  # CRITICAL: Include R2 keys for frontend
    }


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
    
    logger.info(f"=== BACKGROUND TASK STARTED ===")
    logger.info(f"Task ID: {task_id}")
    logger.info(f"Temp files: {file_keys}")
    logger.info(f"User: {username}")
    logger.info(f"R2 Bucket: {r2_bucket}")
    logger.info(f"Sheet ID: {sheet_id}")
    
    r2_file_keys = []
    temp_dir = None
    
    try:
        # Phase 1: Upload (SKIPPED - Files are already in R2 from Phase 1)
        # Note: file_keys argument now contains R2 keys, not temp paths
        logger.info("Phase 1: Verifying files in R2...")
        
        processing_status[task_id]["status"] = "uploading" # Keep status for frontend compatibility
        processing_status[task_id]["message"] = "Verifying cloud files..."
        processing_status[task_id]["start_time"] = datetime.now().isoformat()
        
        r2_file_keys = file_keys # They are already keys
        
        # Just update progress to 100% since upload is done
        processing_status[task_id]["progress"]["total"] = len(r2_file_keys)
        processing_status[task_id]["progress"]["processed"] = len(r2_file_keys)
        
        logger.info(f"Using {len(r2_file_keys)} existing R2 keys for processing")


        
        # Phase 2: Process invoices
        logger.info("Phase 2: Processing invoices with AI...")
        processing_status[task_id]["status"] = "processing"
        processing_status[task_id]["message"] = "Processing invoices..."
        processing_status[task_id]["progress"]["total"] = len(r2_file_keys)
        processing_status[task_id]["progress"]["processed"] = 0
        
        # Define progress callback
        def update_progress(current_index: int, total: int, current_file: str):
            """Callback to update processing status in real-time"""
            processing_status[task_id]["progress"]["processed"] = current_index
            processing_status[task_id]["current_file"] = current_file
            processing_status[task_id]["current_index"] = current_index
            processing_status[task_id]["message"] = f"Processing: {current_file}"
            logger.info(f"Progress: {current_index}/{total} - {current_file}")
        
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
            processing_status[task_id]["status"] = "duplicate_detected"
            processing_status[task_id]["progress"]["total"] = results["total"]
            processing_status[task_id]["progress"]["processed"] = results["processed"]
            processing_status[task_id]["progress"]["failed"] = results["failed"]
            processing_status[task_id]["duplicates"] = results["duplicates"]
            processing_status[task_id]["uploaded_r2_keys"] = r2_file_keys  # CRITICAL: Frontend needs ALL R2 keys
            logger.info(f"✅ Set uploaded_r2_keys to processing_status: {r2_file_keys}")
            
            duplicate_count = len(results["duplicates"])
            processed_count = results["processed"]
            if processed_count > 0:
                processing_status[task_id]["message"] = f"Processed {processed_count} invoice{'s' if processed_count != 1 else ''}, found {duplicate_count} duplicate{'s' if duplicate_count != 1 else ''}"
            else:
                processing_status[task_id]["message"] = f"All files are duplicates: {duplicate_count} file{'s' if duplicate_count != 1 else ''}"
            
            logger.info(f"Duplicates detected: {len(results['duplicates'])}")
        else:
            processing_status[task_id]["status"] = "completed"
            processing_status[task_id]["progress"]["total"] = results["total"]
            processing_status[task_id]["progress"]["processed"] = results["processed"]
            processing_status[task_id]["progress"]["failed"] = results["failed"]
            processing_status[task_id]["end_time"] = datetime.now().isoformat()
            processing_status[task_id]["message"] = f"Successfully processed {results['processed']} invoices"
            processing_status[task_id]["current_file"] = "All complete"
        
        processing_status[task_id]["end_time"] = datetime.now().isoformat()
        
        if results["errors"]:
            processing_status[task_id]["message"] += f" ({results['failed']} failed)"
            processing_status[task_id]["errors"] = results["errors"]
            logger.warning(f"Processing errors: {results['errors']}")
        
    except Exception as e:
        logger.error(f"=== BACKGROUND TASK FAILED ===")
        logger.error(f"Error processing invoices: {e}")
        logger.error(f"Error type: {type(e).__name__}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        processing_status[task_id]["status"] = "failed"
        processing_status[task_id]["message"] = f"Processing failed: {str(e)}"
        processing_status[task_id]["end_time"] = datetime.now().isoformat()
    
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
    try:
        storage = get_storage_client()
        
        # Generate permanent public URL
        url = storage.get_public_url(r2_bucket, file_key)
        
        if not url:
            raise HTTPException(status_code=500, detail="Public URL not configured for R2 bucket")
        
        return {"url": url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate public URL for {file_key}: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate file URL")
