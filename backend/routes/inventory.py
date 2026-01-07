"""Inventory upload and processing routes"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import logging
from datetime import datetime
import uuid
import asyncio
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from fastapi.responses import StreamingResponse
import pandas as pd

from auth import get_current_user, get_current_user_r2_bucket
from services.storage import get_storage_client
from utils.image_optimizer import optimize_image_for_gemini, should_optimize_image, validate_image_quality
from config import get_inventory_r2_folder

router = APIRouter()
logger = logging.getLogger(__name__)

# Thread pool for blocking operations
executor = ThreadPoolExecutor(max_workers=10)

# In-memory storage for processing status
inventory_processing_status: Dict[str, Dict[str, Any]] = {}


class InventoryUploadResponse(BaseModel):
    """Inventory upload response model"""
    success: bool
    uploaded_files: List[str]
    message: str


class InventoryProcessRequest(BaseModel):
    """Process inventory request model"""
    file_keys: List[str]


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


@router.post("/upload", response_model=InventoryUploadResponse)
async def upload_inventory_files(
    files: List[UploadFile] = File(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Upload inventory/vendor invoice files to R2 storage (vendor_invoices folder)
    """
    uploaded_files = []
    username = current_user.get("username", "user")
    
    # DEBUG: Log user config
    logger.info(f"Current user: {username}")
    logger.info(f"User config keys: {list(current_user.keys())}")
    logger.info(f"R2 bucket from config: {current_user.get('r2_bucket')}")
    
    # Get r2_bucket from user config
    r2_bucket = current_user.get("r2_bucket")
    if not r2_bucket:
        logger.error(f"No r2_bucket found for user {username}. User config: {current_user}")
        raise HTTPException(status_code=400, detail="No r2_bucket configured for user")
    
    # Get inventory-specific folder path
    inventory_folder = get_inventory_r2_folder(username)
    
    # Process files in parallel
    CONCURRENCY_LIMIT = 20
    semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
    
    async def process_single_file(file: UploadFile):
        async with semaphore:
            try:
                content = await file.read()
                
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    executor,
                    upload_single_inventory_file_sync,
                    content,
                    file.filename,
                    username,
                    r2_bucket,
                    inventory_folder
                )
                
                if result:
                    return result
                return None
            except Exception as e:
                logger.error(f"Error processing {file.filename}: {e}")
                return None

    total_files = len(files)
    logger.info(f"Starting inventory upload of {total_files} files to {inventory_folder}")
    tasks = [process_single_file(file) for file in files]
    
    results = await asyncio.gather(*tasks)
    uploaded_files = [res for res in results if res]
    
    logger.info(f"Inventory upload complete: {len(uploaded_files)}/{total_files} files uploaded")
    
    return {
        "success": True,
        "uploaded_files": uploaded_files,
        "message": f"Successfully uploaded {len(uploaded_files)} of {len(files)} file(s) to vendor_invoices"
    }


def upload_single_inventory_file_sync(
    content: bytes,
    filename: str,
    username: str,
    r2_bucket: str,
    inventory_folder: str
) -> Optional[str]:
    """
    Synchronous helper for single inventory file upload
    """
    try:
        storage = get_storage_client()
        
        # Generate unique key in vendor_invoices folder
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_key = f"{inventory_folder}{timestamp}_{filename}"
        
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
        
        content_type = "image/jpeg"
        
        # Upload to R2 vendor_invoices folder
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
        logger.error(f"Error in upload_single_inventory_file_sync for {filename}: {e}")
        return None


@router.post("/process", response_model=InventoryProcessResponse)
async def process_inventory(
    request: InventoryProcessRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Trigger inventory processing in thread pool
    """
    task_id = str(uuid.uuid4())
    
    # Get r2_bucket from user config
    r2_bucket = current_user.get("r2_bucket")
    if not r2_bucket:
        raise HTTPException(status_code=400, detail="No r2_bucket configured for user")
    
    # Initialize status
    inventory_processing_status[task_id] = {
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
    
    # Run in thread pool
    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        executor,
        process_inventory_sync,
        task_id,
        request.file_keys,
        r2_bucket,
        current_user.get("username", "user")
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
    if task_id not in inventory_processing_status:
        raise HTTPException(status_code=404, detail="Task not found")
    
    status = inventory_processing_status[task_id]
    
    return {
        "task_id": task_id,
        "status": status.get("status", "unknown"),
        "progress": status.get("progress", {}),
        "message": status.get("message", ""),
        "duplicates": status.get("duplicates", [])  # Include duplicates array
    }


def process_inventory_sync(
    task_id: str,
    file_keys: List[str],
    r2_bucket: str,
    username: str
):
    """
    Synchronous background task to process inventory items
    """
    logger.info(f"=== INVENTORY PROCESSING STARTED ===")
    logger.info(f"Task ID: {task_id}")
    logger.info(f"Files: {file_keys}")
    logger.info(f"User: {username}")
    
    try:
        inventory_processing_status[task_id]["status"] = "processing"
        inventory_processing_status[task_id]["message"] = "Processing inventory items..."
        inventory_processing_status[task_id]["start_time"] = datetime.now().isoformat()
        
        # Progress callback
        def update_progress(current_index: int, total: int, current_file: str):
            inventory_processing_status[task_id]["progress"]["processed"] = current_index
            inventory_processing_status[task_id]["current_file"] = current_file
            inventory_processing_status[task_id]["current_index"] = current_index
            inventory_processing_status[task_id]["message"] = f"Processing: {current_file}"
            logger.info(f"Progress: {current_index}/{total} - {current_file}")
        
        # Import the inventory processor
        from services.inventory_processor import process_inventory_batch
        
        logger.info(f"Processing {len(file_keys)} inventory files for user {username}")
        # Call the actual processor with progress callback
        logger.info("Calling process_inventory_batch")
        results = process_inventory_batch(
            file_keys=file_keys,
            r2_bucket=r2_bucket,
            username=username,
            progress_callback=update_progress
        )
        
        logger.info(f"Processing completed. Results: {results}")
        
        # Check for duplicates
        if results.get("duplicates"):
            # Duplicates detected - update status accordingly
            inventory_processing_status[task_id]["status"] = "duplicate_detected"
            inventory_processing_status[task_id]["duplicates"] = results["duplicates"]
            inventory_processing_status[task_id]["message"] = f"Duplicate vendor invoices detected: {len(results['duplicates'])} file(s)"
            logger.info(f"Duplicates detected: {len(results['duplicates'])}")
        else:
            # Update status based on results
            inventory_processing_status[task_id]["status"] = "completed"
            inventory_processing_status[task_id]["progress"]["processed"] = results["processed"]
            inventory_processing_status[task_id]["progress"]["failed"] = results["failed"]
            inventory_processing_status[task_id]["message"] = f"Successfully processed {results['processed']} vendor invoices"
            inventory_processing_status[task_id]["current_file"] = "All complete"
        
        inventory_processing_status[task_id]["end_time"] = datetime.now().isoformat()
        
        if results["errors"]:
            inventory_processing_status[task_id]["message"] += f" ({results['failed']} failed)"
            inventory_processing_status[task_id]["errors"] = results["errors"]
            logger.warning(f"Processing errors: {results['errors']}")
        
        logger.info("=== INVENTORY PROCESSING COMPLETED ===")
        
    except Exception as e:
        logger.error(f"=== INVENTORY PROCESSING FAILED ===")
        logger.error(f"Error processing inventory: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        inventory_processing_status[task_id]["status"] = "failed"
        inventory_processing_status[task_id]["message"] = f"Processing failed: {str(e)}"
        inventory_processing_status[task_id]["end_time"] = datetime.now().isoformat()


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
