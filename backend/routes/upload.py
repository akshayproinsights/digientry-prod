"""Upload and processing routes"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import logging
from datetime import datetime
import uuid
import asyncio
from concurrent.futures import ThreadPoolExecutor

from auth import get_current_user, get_current_user_r2_bucket
from services.storage import get_storage_client
from utils.image_optimizer import optimize_image_for_gemini, should_optimize_image, validate_image_quality

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


@router.post("/files", response_model=UploadResponse)
async def upload_files(
    files: List[UploadFile] = File(...),
    current_user: Dict[str, Any] = Depends(get_current_user),
    r2_bucket: str = Depends(get_current_user_r2_bucket)
):
    """
    Upload invoice files to R2 storage concurrently
    """
    uploaded_files = []
    username = current_user.get("username", "user")
    
    # Process files in parallel but limit concurrency to avoid OOM or thread pool exhaustion
    # R2/S3 usually handles high concurrency well, but image processing is CPU/Memory intensive
    # Increased to 20 for better bulk upload performance (100+ images)
    CONCURRENCY_LIMIT = 20
    semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
    
    async def process_single_file(file: UploadFile):
        async with semaphore:
            try:
                # Read content asynchronously (this is a FastAPI async method)
                content = await file.read()
                
                # Offload blocking CPU/IO tasks to thread pool
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    executor,
                    upload_single_file_sync,
                    content,
                    file.filename,
                    username,
                    r2_bucket
                )
                
                if result:
                    return result
                return None
            except Exception as e:
                logger.error(f"Error processing {file.filename}: {e}")
                return None

    # Create tasks for all files
    total_files = len(files)
    logger.info(f"Starting bulk upload of {total_files} files with concurrency limit of {CONCURRENCY_LIMIT}")
    tasks = [process_single_file(file) for file in files]
    
    # Wait for all to complete
    results = await asyncio.gather(*tasks)
    
    # Filter out None results
    uploaded_files = [res for res in results if res]
    
    logger.info(f"Bulk upload complete: {len(uploaded_files)}/{total_files} files uploaded successfully")
    
    return {
        "success": True,
        "uploaded_files": uploaded_files,
        "message": f"Successfully uploaded {len(uploaded_files)} of {len(files)} file(s)"
    }


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
        
        # Generate unique key
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_key = f"{username}/uploads/{timestamp}_{filename}"
        
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


@router.post("/process", response_model=ProcessResponse)
async def process_invoices(
    request: ProcessRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    r2_bucket: str = Depends(get_current_user_r2_bucket),
    sheet_id: str = Depends(lambda u=Depends(get_current_user): u.get("sheet_id"))
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
    
    # Run in thread pool instead of BackgroundTasks
    # This is necessary because the processor uses blocking I/O (Gemini API, Google Sheets, etc.)
    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        executor,
        process_invoices_sync,
        task_id,
        request.file_keys,
        r2_bucket,
        sheet_id,
        current_user.get("username", "user"),
        request.force_upload  # Pass force_upload parameter
    )
    
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
        "duplicates": status.get("duplicates", [])  # Include duplicates info
    }


def process_invoices_sync(
    task_id: str,
    file_keys: List[str],
    r2_bucket: str,
    sheet_id: str,
    username: str,
    force_upload: bool = False
):
    """
    Synchronous background task to process invoices
    Runs in thread pool to avoid blocking the event loop
    """
    logger.info(f"=== BACKGROUND TASK STARTED ===")
    logger.info(f"Task ID: {task_id}")
    logger.info(f"Files: {file_keys}")
    logger.info(f"User: {username}")
    logger.info(f"R2 Bucket: {r2_bucket}")
    logger.info(f"Sheet ID: {sheet_id}")
    
    try:
        logger.info("Updating status to 'processing'")
        processing_status[task_id]["status"] = "processing"
        processing_status[task_id]["message"] = "Processing invoices..."
        processing_status[task_id]["start_time"] = datetime.now().isoformat()
        
        # Define progress callback to update status
        def update_progress(current_index: int, total: int, current_file: str):
            """Callback to update processing status in real-time"""
            processing_status[task_id]["progress"]["processed"] = current_index
            processing_status[task_id]["current_file"] = current_file
            processing_status[task_id]["current_index"] = current_index
            processing_status[task_id]["message"] = f"Processing: {current_file}"
            logger.info(f"Progress: {current_index}/{total} - {current_file}")
        
        # Import the processor
        logger.info("Importing processor module")
        from services.processor import process_invoices_batch
        
        logger.info(f"Processing {len(file_keys)} files for user {username}")
        
        # Call the actual processor with progress callback
        logger.info("Calling process_invoices_batch")
        results = process_invoices_batch(
            file_keys=file_keys,
            r2_bucket=r2_bucket,
            sheet_id=sheet_id,
            username=username,
            progress_callback=update_progress,
            force_upload=force_upload  # Pass force_upload parameter
        )
        
        logger.info(f"Processing completed. Results: {results}")
        
        # Check for duplicates
        if results.get("duplicates"):
            # Duplicates detected - update status accordingly
            processing_status[task_id]["status"] = "duplicate_detected"
            processing_status[task_id]["duplicates"] = results["duplicates"]
            processing_status[task_id]["message"] = f"Duplicate invoices detected: {len(results['duplicates'])} file(s)"
            logger.info(f"Duplicates detected: {len(results['duplicates'])}")
        else:
            # Update status based on results
            processing_status[task_id]["status"] = "completed"
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
        
        logger.info("=== BACKGROUND TASK COMPLETED ===")
        
    except Exception as e:
        logger.error(f"=== BACKGROUND TASK FAILED ===")
        logger.error(f"Error processing invoices: {e}")
        logger.error(f"Error type: {type(e).__name__}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        processing_status[task_id]["status"] = "failed"
        processing_status[task_id]["message"] = f"Processing failed: {str(e)}"
        processing_status[task_id]["end_time"] = datetime.now().isoformat()


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
    Generate a presigned URL to view a file from R2 storage
    """
    try:
        storage = get_storage_client()
        client = storage.get_client()
        
        # Generate presigned URL (7 days expiry)
        url = client.generate_presigned_url(
            'get_object',
            Params={'Bucket': r2_bucket, 'Key': file_key},
            ExpiresIn=604800  # 7 days
        )
        
        return {"url": url}
    except Exception as e:
        logger.error(f"Failed to generate presigned URL for {file_key}: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate file URL")
