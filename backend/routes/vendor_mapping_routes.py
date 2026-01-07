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

from database import get_database_client
from auth import get_current_user
from services.storage import get_storage_client
from config import get_google_api_key
from config_loader import get_user_config

logger = logging.getLogger(__name__)

router = APIRouter()

# Pydantic Models
class VendorMappingEntry(BaseModel):
    """Single entry for vendor mapping"""
    id: Optional[int] = None
    row_number: int
    vendor_description: str
    part_number: Optional[str] = None
    customer_item_name: Optional[str] = None
    stock: Optional[float] = None
    reorder: Optional[float] = None
    notes: Optional[str] = None
    status: str = "Pending"


class UpdateEntryRequest(BaseModel):
    """Request model for updating an entry"""
    stock: Optional[float] = None
    reorder: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class BulkSaveRequest(BaseModel):
    """Request model for bulk saving entries"""
    entries: List[VendorMappingEntry]
    source_image_url: Optional[str] = None


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
        
        # Upload to R2
        storage = get_storage_client()
        bucket = "adnak-sir-invoices"
        key = f"Adnak/adnak_vendor_mapping/{filename}"
        
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
        
        # Extract key from URL
        # URL format: https://pub-xxx.r2.dev/bucket/key
        if "adnak_vendor_mapping" in image_url:
            parts = image_url.split("adnak-sir-invoices/")
            if len(parts) > 1:
                key = parts[1]
                image_bytes = storage.download_file("adnak-sir-invoices", key)
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
        
        logger.info(f"Extracted {len(extracted_data.get('rows', []))} rows from image")
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
        if request.reorder is not None:
            update_data["reorder"] = request.reorder
        if request.notes is not None:
            update_data["notes"] = request.notes
        if request.status is not None:
            update_data["status"] = request.status
        
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
                    "reorder": entry.reorder,
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
