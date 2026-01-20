"""
Stock Mapping Sheet Upload Routes
Handles PDF upload, Gemini extraction, and data storage for vendor mapping sheets.
"""
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from typing import List
from datetime import datetime
import hashlib
import logging
import json

from database import get_database_client
from auth import get_current_user
from services.storage import get_storage_client
from models.mapping_models import (
    MappingSheetUploadResponse,
    MappingSheetExtractedData,
    VendorMappingSheet
)
from config_loader import load_user_config
from config import get_mappings_folder
import google.generativeai as genai

logger = logging.getLogger(__name__)
router = APIRouter()


def calculate_file_hash(content: bytes) -> str:
    """Calculate SHA256 hash of file content"""
    return hashlib.sha256(content).hexdigest()


@router.post("/upload", response_model=MappingSheetUploadResponse)
async def upload_mapping_sheet(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Upload vendor mapping sheet PDF
    - Uploads to R2: {username}/mappings/
    - Triggers Gemini extraction
    - Stores results in vendor_mapping_sheets table
    """
    username = current_user.get("username")
    
    try:
        # 1. Read file content
        content = await file.read()
        file_hash = calculate_file_hash(content)
        
        # 2. Check if already processed
        db = get_database_client()
        existing_check = db.client.table("vendor_mapping_sheets")\
            .select("id, status")\
            .eq("username", username)\
            .eq("image_hash", file_hash)\
            .execute()
        
        if existing_check.data:
            existing = existing_check.data[0]
            if existing["status"] == "completed":
                return MappingSheetUploadResponse(
                    sheet_id=existing["id"],
                    image_url="",
                    status="already_processed",
                    message="This mapping sheet has already been processed"
                )
        
        # 3. Upload to R2 using dynamic path
        storage = get_storage_client()
        user_config = load_user_config(username)
        bucket = user_config.get("r2_bucket")
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        extension = file.filename.split(".")[-1] if "." in file.filename else "pdf"
        filename = f"{timestamp}_{file_hash[:8]}.{extension}"
        
        mappings_folder = get_mappings_folder(username)
        key = f"{mappings_folder}{filename}"
        
        success = storage.upload_file(
            file_data=content,
            bucket=bucket,
            key=key,
            content_type=file.content_type
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to upload to storage")
        
        image_url = storage.get_public_url(bucket, key)
        
        # 4. Extract data using Gemini
        logger.info(f"Starting Gemini extraction for {filename}")
        
        # Load user config for Gemini prompt
        user_config = load_user_config(username)
        vendor_mapping_config = user_config.get("vendor_mapping_gemini", {})
        system_instruction = vendor_mapping_config.get("system_instruction")
        
        if not system_instruction:
            raise HTTPException(
                status_code=500,
                detail="vendor_mapping_gemini prompt not configured"
            )
        
        # Configure Gemini
        import toml
        secrets = toml.load("secrets.toml")
        gemini_api_key = secrets.get("gemini_api_key")
        
        if not gemini_api_key:
            raise HTTPException(status_code=500, detail="Gemini API key not configured")
        
        genai.configure(api_key=gemini_api_key)
        
        model = genai.GenerativeModel(
            model_name="gemini-2.0-flash-exp",
            system_instruction=system_instruction
        )
        
        # Upload file to Gemini
        uploaded_file = genai.upload_file(path=None, file_data=content, mime_type=file.content_type)
        
        # Generate extraction
        response = model.generate_content([
            "Extract all handwritten data from this vendor mapping sheet",
            uploaded_file
        ])
        
        # Parse JSON response
        response_text = response.text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        extracted_data = json.loads(response_text)
        logger.info(f"Extracted {len(extracted_data.get('rows', []))} rows")
        
        # 5. Store in database
        rows_data = extracted_data.get("rows", [])
        inserted_records = []
        
        for row in rows_data:
            # Prepare record
            record = {
                "username": username,
                "image_url": image_url,
                "image_hash": file_hash,
                "part_number": row.get("part_number"),
                "vendor_description": row.get("vendor_description"),
                "customer_item": [row.get("customer_item")] if row.get("customer_item") else None,
                "old_stock": row.get("stock"),
                "reorder_point": row.get("reorder"),
                "status": "completed",
                "processed_at": datetime.now().isoformat(),
                "gemini_raw_response": row
            }
            
            # Insert
            result = db.client.table("vendor_mapping_sheets")\
                .insert(record)\
                .execute()
            
            inserted_records.extend(result.data)
        
        logger.info(f"✅ Stored {len(inserted_records)} mapping sheet rows")
        
        return MappingSheetUploadResponse(
            sheet_id=inserted_records[0]["id"] if inserted_records else "",
            image_url=image_url,
            status="completed",
            message=f"Successfully extracted {len(rows_data)} rows",
            extracted_rows=len(rows_data)
        )
    
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Gemini response: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse extraction results")
    
    except Exception as e:
        logger.error(f"Error uploading mapping sheet: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sheets", response_model=List[VendorMappingSheet])
async def get_mapping_sheets(current_user: dict = Depends(get_current_user)):
    """Get all uploaded mapping sheets for current user"""
    username = current_user.get("username")
    
    try:
        db = get_database_client()
        response = db.client.table("vendor_mapping_sheets")\
            .select("*")\
            .eq("username", username)\
            .order("uploaded_at", desc=True)\
            .execute()
        
        return response.data
    
    except Exception as e:
        logger.error(f"Error fetching mapping sheets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sheets/{sheet_id}")
async def delete_mapping_sheet(
    sheet_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete a mapping sheet"""
    username = current_user.get("username")
    
    try:
        db = get_database_client()
        response = db.client.table("vendor_mapping_sheets")\
            .delete()\
            .eq("id", sheet_id)\
            .eq("username", username)\
            .execute()
        
        return {"message": "Mapping sheet deleted successfully"}
    
    except Exception as e:
        logger.error(f"Error deleting mapping sheet: {e}")
        raise HTTPException(status_code=500, detail=str(e))
