"""
Vendor Mapping API endpoints.
Handles PDF export data, image upload, Gemini extraction, and entry management.
"""
import logging
import io
import hashlib
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from google import genai
from google.genai import types
import json
import uuid
import asyncio
from concurrent.futures import ThreadPoolExecutor


from database import get_database_client
from auth import get_current_user
from services.storage import get_storage_client
from config import get_google_api_key, get_mappings_folder
from config_loader import get_user_config

logger = logging.getLogger(__name__)

router = APIRouter()

# Thread pool for blocking operations
executor = ThreadPoolExecutor(max_workers=5)


# Pydantic Models
class VendorMappingEntry(BaseModel):
    """Single entry for vendor mapping"""
    id: Optional[int] = None
    row_number: int
    vendor_description: str
    part_number: Optional[str] = None
    customer_item_name: Optional[str] = None
    stock: Optional[float] = None  # Kept for backward compat/old usage if any
    priority: Optional[str] = None
    reorder: Optional[float] = None
    notes: Optional[str] = None
    status: str = "Pending"


class UpdateEntryRequest(BaseModel):
    """Request model for updating an entry"""
    stock: Optional[float] = None
    priority: Optional[str] = None
    reorder: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    customer_item_name: Optional[str] = None
    system_qty: Optional[float] = None  # Added for display
    variance: Optional[float] = None    # Added for display

class BulkSaveRequest(BaseModel):
    """Request model for bulk saving entries"""
    entries: List[VendorMappingEntry]
    source_image_url: Optional[str] = None


class UploadResponse(BaseModel):
    """Upload response model"""
    success: bool
    uploaded_files: List[str]
    message: str


class ProcessRequest(BaseModel):
    """Process scans request model"""
    file_keys: List[str]


class ProcessStatusResponse(BaseModel):
    """Process status response model"""
    task_id: str
    status: str
    progress: Dict[str, Any]
    message: str
    rows: List[Dict[str, Any]] = []



# ==================== EXPORT DATA ENDPOINT ====================

@router.get("/export-data")
async def get_export_data(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get unique vendor items for PDF export.
    Returns unique (vendor_description, part_number) combinations from inventory_items.
    EXCLUDES items already in vendor_mapping_entries (no duplicates).
    """
    try:
        username = current_user.get("username", "")
        db = get_database_client()
        
        # First, get already-mapped items to exclude them
        mapped_response = db.query("vendor_mapping_entries", ["vendor_description", "part_number"]).eq("username", username).execute()
        
        mapped_keys = set()
        if mapped_response.data:
            for item in mapped_response.data:
                desc = (item.get("vendor_description") or "").strip()
                part = (item.get("part_number") or "").strip()
                mapped_keys.add(f"{desc}|{part}")
        
        # Query unique vendor items from inventory_items table
        response = db.query("inventory_items", ["description", "part_number"]).execute()
        
        if not response.data:
            return {"items": [], "total": 0}
        
        # Deduplicate by description + part_number AND exclude already mapped
        seen = set()
        unique_items = []
        row_num = 1
        
        for item in response.data:
            desc = item.get("description", "").strip()
            part = item.get("part_number", "").strip() or ""
            key = f"{desc}|{part}"
            
            # Skip if already seen OR already mapped
            if key in seen or key in mapped_keys:
                continue
            
            if desc:
                seen.add(key)
                unique_items.append({
                    "row_number": row_num,
                    "vendor_description": desc,
                    "part_number": part if part else None,
                    "customer_item_name": None,
                    "stock": None,
                    "reorder": None,
                    "notes": None
                })
                row_num += 1
        
        # Sort alphabetically by vendor_description
        unique_items.sort(key=lambda x: x["vendor_description"].lower())
        
        # Re-assign row numbers after sorting
        for idx, item in enumerate(unique_items, 1):
            item["row_number"] = idx
        
        logger.info(f"Export data: {len(unique_items)} unmapped vendor items (excluded {len(mapped_keys)} mapped)")
        return {"items": unique_items, "total": len(unique_items)}
    
    except Exception as e:
        logger.error(f"Error fetching export data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== CUSTOMER ITEMS SEARCH ENDPOINT ====================

@router.get("/customer-items/search")
async def search_customer_items(
    query: str = "",
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Search unique customer item names from verified_invoices.
    Used for autocomplete dropdown in the mapping UI.
    Returns ALL unique items (no limit) for the current user.
    """
    try:
        username = current_user.get("username", "")
        db = get_database_client()
        
        # Get unique descriptions from verified_invoices for this user
        response = db.query("verified_invoices", ["description"]).eq("username", username).execute()
        
        if not response.data:
            return {"items": []}
        
        # Deduplicate and filter by query
        seen = set()
        results = []
        query_lower = query.lower().strip()
        
        for item in response.data:
            desc = (item.get("description") or "").strip()
            if desc and desc not in seen:
                seen.add(desc)
                # Filter by search query if provided
                if not query_lower or query_lower in desc.lower():
                    results.append({"customer_item": desc})
        
        # Sort alphabetically - NO LIMIT, return all
        results.sort(key=lambda x: x["customer_item"].lower())
        
        return {"items": results}
    
    except Exception as e:
        logger.error(f"Error searching customer items: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== UPLOAD SCAN ENDPOINT ====================

@router.post("/upload-scan")
async def upload_scan(
    file: UploadFile = File(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Upload a scanned vendor mapping sheet to R2.
    Stores in adnak_vendor_mapping/ folder.
    """
    try:
        username = current_user.get("username", "")
        
        # Validate file type
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Only image files are allowed")
        
        # Read file content
        content = await file.read()
        
        # Generate unique filename
        file_hash = hashlib.md5(content).hexdigest()[:12]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        extension = file.filename.split(".")[-1] if "." in file.filename else "jpg"
        filename = f"{timestamp}_{file_hash}.{extension}"
        
        # Upload to R2 using dynamic path
        storage = get_storage_client()
        user_config = get_user_config(username)
        bucket = user_config.get("r2_bucket")
        mappings_folder = get_mappings_folder(username)
        key = f"{mappings_folder}{filename}"
        
        success = storage.upload_file(
            file_data=content,
            bucket=bucket,
            key=key,
            content_type=file.content_type
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to upload to R2")
        
        # Get public URL
        public_url = storage.get_public_url(bucket, key)
        
        logger.info(f"Uploaded scan: {key}")
        return {
            "success": True,
            "filename": filename,
            "key": key,
            "url": public_url
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading scan: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== GEMINI EXTRACTION ENDPOINT ====================

@router.post("/extract")
async def extract_from_image(
    image_url: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Extract handwritten data from scanned vendor mapping sheet using Gemini.
    """
    try:
        username = current_user.get("username", "")
        
        # Get user config for Gemini prompt
        user_config = get_user_config(username)
        if not user_config:
            raise HTTPException(status_code=404, detail=f"User config not found: {username}")
        
        # Get vendor mapping prompt
        vendor_mapping_config = user_config.get("vendor_mapping_gemini", {})
        system_instruction = vendor_mapping_config.get("system_instruction")
        
        if not system_instruction:
            raise HTTPException(
                status_code=404, 
                detail="vendor_mapping_gemini prompt not configured"
            )
        
        # Download image from R2 if needed, or use URL directly
        storage = get_storage_client()
        user_config = get_user_config(username)
        bucket = user_config.get("r2_bucket")
        
        # Extract key from URL
        # URL format: https://pub-xxx.r2.dev/bucket/key OR https://pub-xxx.r2.dev/key
        # Check if URL contains mappings folder pattern
        if "/mappings/" in image_url or "adnak_vendor_mapping" in image_url:
            # Try to extract key by splitting on bucket name
            parts = image_url.split(f"{bucket}/")
            if len(parts) > 1:
                key = parts[1]
                image_bytes = storage.download_file(bucket, key)
            else:
                # Try to fetch directly
                import httpx
                async with httpx.AsyncClient() as client:
                    resp = await client.get(image_url)
                    image_bytes = resp.content
        else:
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.get(image_url)
                image_bytes = resp.content
        
        if not image_bytes:
            raise HTTPException(status_code=404, detail="Could not download image")
        
        # Configure Gemini
        api_key = get_google_api_key()
        client = genai.Client(api_key=api_key)
        
        # Call Gemini with image
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                system_instruction
            ],
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json"
            )
        )
        
        # Parse response
        result_text = response.text
        
        # Clean up response if needed
        if result_text.startswith("```json"):
            result_text = result_text[7:]
        if result_text.endswith("```"):
            result_text = result_text[:-3]
        
        extracted_data = json.loads(result_text.strip())
        
        # ENHANCEMENT: Fetch System Stock and Calculate Variance
        rows = extracted_data.get("rows", [])
        db = get_database_client()
        
        # Get all stock levels for this user to fast lookup
        stock_response = db.client.table("stock_levels")\
            .select("part_number, vendor_description, current_stock")\
            .eq("username", username)\
            .execute()
            
        stock_map = {} # Key: PartNumber (normalized) -> CurrentStock
        desc_map = {}  # Key: VendorDescription (normalized) -> CurrentStock
        
        if stock_response.data:
            for item in stock_response.data:
                p_num = (item.get("part_number") or "").strip().lower()
                v_desc = (item.get("vendor_description") or "").strip().lower()
                c_stock = item.get("current_stock", 0)
                
                if p_num:
                    stock_map[p_num] = c_stock
                if v_desc:
                    desc_map[v_desc] = c_stock
        
        for row in rows:
            extracted_stock = row.get("stock")
            part = (row.get("part_number") or "").strip().lower()
            desc = (row.get("vendor_description") or "").strip().lower()
            
            system_qty = 0
            
            # Try to match by part number first, then description
            if part and part in stock_map:
                system_qty = stock_map[part]
            elif desc and desc in desc_map:
                system_qty = desc_map[desc]
            
            row["system_qty"] = system_qty
            
            # Calculate variance if stock was extracted
            if extracted_stock is not None:
                try:
                    row["variance"] = float(extracted_stock) - float(system_qty)
                except (ValueError, TypeError):
                    row["variance"] = None
            else:
                row["variance"] = None

        logger.info(f"Extracted {len(rows)} rows from image (with variance calc)")
        return {
            "success": True,
            "data": extracted_data,
            "source_image_url": image_url
        }
    
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to parse Gemini response: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error extracting from image: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== BULK UPLOAD & BACKGROUND PROCESSING ====================

@router.post("/upload-scans", response_model=UploadResponse)
async def upload_scans(
    files: List[UploadFile] = File(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Upload multiple scanned vendor mapping sheets to R2.
    """
    try:
        username = current_user.get("username", "")
        uploaded_keys = []
        
        loop = asyncio.get_event_loop()
        upload_tasks = []
        
        for file in files:
            content = await file.read()
            task = loop.run_in_executor(
                executor,
                upload_single_scan_sync,
                content,
                file.filename,
                file.content_type,
                username
            )
            upload_tasks.append(task)
            
        results = await asyncio.gather(*upload_tasks)
        uploaded_keys = [key for key in results if key is not None]
        
        if len(uploaded_keys) == 0 and len(files) > 0:
            raise HTTPException(status_code=500, detail="Failed to upload any files")
            
        return {
            "success": True,
            "uploaded_files": uploaded_keys,
            "message": f"Uploaded {len(uploaded_keys)} of {len(files)} file(s)"
        }
    except Exception as e:
        logger.error(f"Error in upload_scans: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def upload_single_scan_sync(content: bytes, filename: str, content_type: str, username: str) -> Optional[str]:
    """Helper to upload single scan to R2"""
    try:
        storage = get_storage_client()
        user_config = get_user_config(username)
        bucket = user_config.get("r2_bucket")
        mappings_folder = get_mappings_folder(username)
        
        # Generate hash/name
        file_hash = hashlib.md5(content).hexdigest()[:12]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        extension = filename.split(".")[-1] if "." in filename else "jpg"
        final_filename = f"{timestamp}_{file_hash}.{extension}"
        key = f"{mappings_folder}{final_filename}"
        
        success = storage.upload_file(
            file_data=content,
            bucket=bucket,
            key=key,
            content_type=content_type
        )
        return key if success else None
    except Exception as e:
        logger.error(f"Failed to upload {filename}: {e}")
        return None


@router.post("/process-scans")
async def process_scans(
    request: ProcessRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Start background processing of uploaded scans.
    """
    task_id = str(uuid.uuid4())
    username = current_user.get("username", "")
    
    # Initialize task in DB
    initial_status = {
        "task_id": task_id,
        "username": username,
        "status": "queued",
        "message": "Processing queued",
        "progress": {
            "total": len(request.file_keys),
            "processed": 0,
            "failed": 0
        },
        "rows": [],  # Store extracted rows here
        "created_at": datetime.utcnow().isoformat()
    }
    
    try:
        db = get_database_client()
        db.insert("upload_tasks", initial_status)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        
    # Start background task
    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        executor,
        process_scans_sync,
        task_id,
        request.file_keys,
        username
    )
    
    return {
        "task_id": task_id,
        "status": "queued",
        "message": "Processing started"
    }


@router.get("/process/status/{task_id}", response_model=ProcessStatusResponse)
async def get_process_status(
    task_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get status of processing task"""
    try:
        db = get_database_client()
        response = db.query("upload_tasks").eq("task_id", task_id).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Task not found")
            
        record = response.data[0]
        return {
            "task_id": record.get("task_id"),
            "status": record.get("status"),
            "progress": record.get("progress"),
            "message": record.get("message"),
            "rows": record.get("rows", [])
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def process_scans_sync(task_id: str, file_keys: List[str], username: str):
    """Background worker for processing scans"""
    
    def update_db(updates: Dict[str, Any]):
        try:
            db = get_database_client()
            updates["updated_at"] = datetime.utcnow().isoformat()
            db.update("upload_tasks", updates, {"task_id": task_id})
        except Exception as e:
            logger.error(f"Failed to update task {task_id}: {e}")

    update_db({"status": "processing", "message": "Processing images..."})
    
    all_rows = []
    processed_count = 0
    failed_count = 0
    
    try:
        storage = get_storage_client()
        user_config = get_user_config(username)
        bucket = user_config.get("r2_bucket")
        api_key = get_google_api_key()
        
        # Pre-fetch stock levels for lookups
        db = get_database_client()
        stock_response = db.client.table("stock_levels")\
            .select("part_number, vendor_description, current_stock")\
            .eq("username", username)\
            .execute()
            
        stock_map = {}
        desc_map = {}
        if stock_response.data:
            for item in stock_response.data:
                p = (item.get("part_number") or "").strip().lower()
                d = (item.get("vendor_description") or "").strip().lower()
                qty = item.get("current_stock", 0)
                if p: stock_map[p] = qty
                if d: desc_map[d] = qty

        # Process each file
        for idx, key in enumerate(file_keys):
            try:
                # Update progress
                update_db({
                    "progress": {
                        "total": len(file_keys),
                        "processed": processed_count,
                        "failed": failed_count
                    },
                    "message": f"Processing file {idx + 1}/{len(file_keys)}"
                })
                
                # 1. Download image
                image_bytes = storage.download_file(bucket, key)
                if not image_bytes:
                    raise Exception("Failed to download image")
                
                # 2. Call Gemini
                client = genai.Client(api_key=api_key)
                vendor_mapping_config = user_config.get("vendor_mapping_gemini", {})
                system_instr = vendor_mapping_config.get("system_instruction")
                
                response = client.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                        system_instr
                    ],
                    config=types.GenerateContentConfig(
                        temperature=0.1,
                        response_mime_type="application/json"
                    )
                )
                
                # 3. Parse and Enhance
                text = response.text
                if text.startswith("```json"): text = text[7:]
                if text.endswith("```"): text = text[:-3]
                
                data = json.loads(text.strip())
                rows = data.get("rows", [])
                
                # 4. Add System Qty & Variance
                for row in rows:
                    part = (row.get("part_number") or "").strip().lower()
                    desc = (row.get("vendor_description") or "").strip().lower()
                    stock_val = row.get("stock")
                    
                    sys_qty = 0
                    if part and part in stock_map:
                        sys_qty = stock_map[part]
                    elif desc and desc in desc_map:
                        sys_qty = desc_map[desc]
                    
                    row["system_qty"] = sys_qty
                    row["variance"] = None
                    
                    if stock_val is not None:
                        try:
                            row["variance"] = float(stock_val) - float(sys_qty)
                        except:
                            pass
                            
                all_rows.extend(rows)
                processed_count += 1
                
            except Exception as e:
                logger.error(f"Error processing {key}: {e}")
                failed_count += 1
        
        # Finish
        update_db({
            "status": "completed",
            "message": "Processing complete",
            "progress": {
                "total": len(file_keys),
                "processed": processed_count,
                "failed": failed_count
            },
            "rows": all_rows
        })
        
    except Exception as e:
        logger.error(f"Task {task_id} failed: {e}")
        update_db({
            "status": "failed",
            "message": f"Critical error: {str(e)}"
        })


# ==================== ENTRIES ENDPOINTS ====================

@router.get("/entries")
async def get_entries(
    status: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get all vendor mapping entries for the current user.
    """
    try:
        username = current_user.get("username", "")
        db = get_database_client()
        
        query = db.query("vendor_mapping_entries").eq("username", username)
        
        if status:
            query = query.eq("status", status)
        
        response = query.order("row_number").execute()
        
        return {
            "entries": response.data or [],
            "total": len(response.data) if response.data else 0
        }
    
    except Exception as e:
        logger.error(f"Error fetching entries: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/entries/{entry_id}")
async def update_entry(
    entry_id: int,
    request: UpdateEntryRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update a single vendor mapping entry.
    """
    try:
        username = current_user.get("username", "")
        db = get_database_client()
        
        # Build update data
        update_data = {"updated_at": datetime.now().isoformat()}
        
        if request.stock is not None:
            update_data["stock"] = request.stock
        if request.priority is not None:
            update_data["priority"] = request.priority
        if request.reorder is not None:
            update_data["reorder_point"] = request.reorder # Map to reorder_point
        if request.notes is not None:
            update_data["notes"] = request.notes
        if request.status is not None:
            update_data["status"] = request.status
        if request.customer_item_name is not None:
            update_data["customer_item_name"] = request.customer_item_name
        
        response = db.client.table("vendor_mapping_entries").update(
            update_data
        ).eq("id", entry_id).eq("username", username).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Entry not found")
        
        return {"success": True, "entry": response.data[0]}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating entry: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/entries/bulk-save")
async def bulk_save_entries(
    request: BulkSaveRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Bulk save/upsert vendor mapping entries.
    Uses vendor_description + part_number as unique key.
    Also updates stock_levels.customer_items with the mapped customer item.
    """
    try:
        username = current_user.get("username", "")
        db = get_database_client()
        
        saved_count = 0
        errors = []
        
        for entry in request.entries:
            try:
                # Determine status: 'Added' if customer_item_name is filled, otherwise use entry status
                determined_status = "Added" if entry.customer_item_name else entry.status
                
                entry_data = {
                    "username": username,
                    "row_number": entry.row_number,
                    "vendor_description": entry.vendor_description,
                    "part_number": entry.part_number,
                    "customer_item_name": entry.customer_item_name,
                    "stock": entry.stock,
                    "priority": entry.priority,
                    "reorder_point": entry.reorder, # Map 'reorder' to 'reorder_point' DB column
                    "notes": entry.notes,
                    "status": determined_status,
                    "source_image_url": request.source_image_url,
                    "extracted_at": datetime.now().isoformat(),
                    "updated_at": datetime.now().isoformat()
                }
                
                # Upsert by username + vendor_description + part_number
                response = db.client.table("vendor_mapping_entries").upsert(
                    entry_data,
                    on_conflict="username,vendor_description,part_number"
                ).execute()
                
                # ALSO update stock_levels.customer_items if we have a customer_item_name
                if entry.customer_item_name and entry.part_number:
                    db.client.table("stock_levels").update({
                        "customer_items": entry.customer_item_name  # Plain string, NOT array
                    }).eq("part_number", entry.part_number).eq("username", username).execute()

                # NEW LOGIC: Update Stock Levels (Manual Adjustment)
                # If stock (Physical Count) is provided, calculate variance and update manual_adjustment
                if entry.stock is not None and entry.part_number:
                     # 1. Get current system stock (In - Out)
                    current_stock_query = db.client.table("stock_levels")\
                        .select("id, current_stock, unit_value, manual_adjustment")\
                        .eq("part_number", entry.part_number)\
                        .eq("username", username)\
                        .execute()
                    
                    if current_stock_query.data:
                        stock_item = current_stock_query.data[0]
                        system_qty = stock_item.get("current_stock", 0)
                        
                        # 2. Calculate Adjustment = Physical - System
                        physical_count = float(entry.stock)
                        adjustment_val = physical_count - system_qty
                        
                        # 3. Update stock_levels
                        # Update manual_adjustment AND total_value (based on new On Hand)
                        unit_val = stock_item.get("unit_value", 0) or 0
                        new_total_value = physical_count * unit_val
                        
                        db.client.table("stock_levels").update({
                            "manual_adjustment": int(adjustment_val),
                            "total_value": round(new_total_value, 2),
                            "updated_at": datetime.now().isoformat()
                            # NOTE: old_stock is NOT updated, it is deprecated
                        }).eq("id", stock_item["id"]).execute()
                        
                        logger.info(f"Updated adjustment for {entry.part_number}: Phys={physical_count}, Sys={system_qty}, Adj={adjustment_val}")

                saved_count += 1
            
            except Exception as e:
                error_msg = f"Row {entry.row_number}: {str(e)}"
                logger.error(f"Error saving entry: {error_msg}")
                errors.append({
                    "row_number": entry.row_number,
                    "error": str(e)
                })
        
        logger.info(f"Bulk saved {saved_count} entries, {len(errors)} errors")
        if errors:
            logger.error(f"Errors details: {errors}")
        
        return {
            "success": True,
            "saved_count": saved_count,
            "errors": errors
        }
    
    except Exception as e:
        logger.error(f"Error in bulk save: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/entries/{entry_id}")
async def delete_entry(
    entry_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete a vendor mapping entry.
    """
    try:
        username = current_user.get("username", "")
        db = get_database_client()
        
        response = db.client.table("vendor_mapping_entries").delete().eq(
            "id", entry_id
        ).eq("username", username).execute()
        
        return {"success": True, "deleted": True}
    
    except Exception as e:
        logger.error(f"Error deleting entry: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/entries/by-part/{part_number}")
async def delete_entry_by_part(
    part_number: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete vendor mapping entry by part number.
    Used when clearing customer item mapping from stock register.
    Also clears the customer_items field in stock_levels table.
    """
    try:
        username = current_user.get("username", "")
        db = get_database_client()
        
        # Delete all mappings for this part number and user
        response = db.client.table("vendor_mapping_entries").delete().eq(
            "part_number", part_number
        ).eq("username", username).execute()
        
        # Also update stock_levels to clear customer_items field
        db.client.table("stock_levels").update({
            "customer_items": None
        }).eq("part_number", part_number).eq("username", username).execute()
        
        logger.info(f"Deleted vendor mapping and cleared stock_levels for part {part_number}")
        return {"success": True, "deleted": True}
    
    except Exception as e:
        logger.error(f"Error deleting vendor mapping: {e}")
        raise HTTPException(status_code=500, detail=str(e))
