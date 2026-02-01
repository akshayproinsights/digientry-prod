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
    MappingSheetExtractedData
)
from config_loader import load_user_config
from config import get_mappings_folder, get_google_api_key
from google import genai
from google.genai import types

# Import recalculation function to trigger after upload
from routes.stock_routes import recalculate_stock_for_user

logger = logging.getLogger(__name__)
router = APIRouter()


def calculate_file_hash(content: bytes) -> str:
    """Calculate SHA256 hash of file content"""
    return hashlib.sha256(content).hexdigest()


@router.post("/upload", response_model=MappingSheetUploadResponse)
async def upload_mapping_sheet(
    files: List[UploadFile] = File(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Upload MULTIPLE vendor mapping sheet PDFs/Images
    - Uploads to R2: {username}/mappings/
    - Triggers Gemini extraction for each
    - Directly updates stock_levels table with extracted data
    """
    username = current_user.get("username")
    
    total_files = len(files)
    processed_count = 0
    total_stock_updates = 0
    total_mappings_created = 0
    total_mappings_updated = 0
    total_rows_extracted = 0
    
    try:
        db = get_database_client()
        storage = get_storage_client()
        user_config = load_user_config(username)
        bucket = user_config.get("r2_bucket")
        mappings_folder = get_mappings_folder(username)
        
        # Load Gemini config once
        vendor_mapping_config = user_config.get("vendor_mapping_gemini", {})
        system_instruction = vendor_mapping_config.get("system_instruction")
        
        if not system_instruction:
            raise HTTPException(status_code=500, detail="vendor_mapping_gemini prompt not configured")
            
        gemini_api_key = get_google_api_key()
        if not gemini_api_key:
            raise HTTPException(status_code=500, detail="Gemini API key not configured")
            
        client = genai.Client(api_key=gemini_api_key)
        
        last_image_url = ""

        for file in files:
            logger.info(f"Processing file {processed_count + 1}/{total_files}: {file.filename}")
            
            # 1. Read file content
            content = await file.read()
            file_hash = calculate_file_hash(content)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            extension = file.filename.split(".")[-1] if "." in file.filename else "pdf"
            filename = f"{timestamp}_{file_hash[:8]}.{extension}"
            key = f"{mappings_folder}{filename}"
            
            # 2. Upload to R2
            success = storage.upload_file(
                file_data=content,
                bucket=bucket,
                key=key,
                content_type=file.content_type
            )
            
            if success:
                last_image_url = storage.get_public_url(bucket, key)
            
            # 3. Extract data using Gemini
            response = client.models.generate_content(
                model="gemini-3-flash-preview",
                contents=[
                    types.Part.from_bytes(data=content, mime_type=file.content_type or "image/png"),
                    system_instruction
                ],
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    response_mime_type="application/json"
                )
            )
            
            # Parse JSON
            response_text = response.text.strip()
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            if response_text.endswith("```"):
                response_text = response_text[:-3]
            response_text = response_text.strip()
            
            extracted_data = json.loads(response_text)
            rows_data = extracted_data.get("rows", [])
            total_rows_extracted += len(rows_data)
            
            # 4. Process extracted rows
            for index, row in enumerate(rows_data):
                row_number = row.get("row_number")
                if row_number is None:
                    row_number = index + 1
                    
                part_number = row.get("part_number")
                vendor_description = row.get("vendor_description")
                customer_item = row.get("customer_item")
                priority = row.get("priority")
                stock = row.get("stock")
                reorder = row.get("reorder")
                
                if not part_number:
                    continue
                
                # Check for existing stock
                existing_stock = db.client.table("stock_levels")\
                    .select("id, internal_item_name")\
                    .eq("username", username)\
                    .eq("part_number", part_number)\
                    .execute()
                
                if existing_stock.data:
                    # Update Vendor Mapping Entry
                    internal_item_name = existing_stock.data[0].get("internal_item_name", vendor_description)
                    
                    existing_mapping = db.client.table("vendor_mapping_entries")\
                        .select("id")\
                        .eq("username", username)\
                        .eq("part_number", part_number)\
                        .execute()
                    
                    mapping_upsert_data = {
                        "username": username,
                        "part_number": part_number,
                        "vendor_description": internal_item_name,
                        "status": "Added",
                        "updated_at": datetime.now().isoformat()
                    }
                    
                    if customer_item: mapping_upsert_data["customer_item_name"] = customer_item
                    if priority: mapping_upsert_data["priority"] = priority
                    if reorder is not None: mapping_upsert_data["reorder_point"] = reorder
                    
                    if existing_mapping.data:
                        db.client.table("vendor_mapping_entries")\
                            .update(mapping_upsert_data)\
                            .eq("id", existing_mapping.data[0]["id"])\
                            .execute()
                        total_mappings_updated += 1
                    else:
                        mapping_upsert_data["row_number"] = row_number
                        mapping_upsert_data["created_at"] = datetime.now().isoformat()
                        if not customer_item: mapping_upsert_data["customer_item_name"] = ""
                        
                        db.client.table("vendor_mapping_entries")\
                            .insert(mapping_upsert_data)\
                            .execute()
                        total_mappings_created += 1
                        
                    # Update Stock Count (Old Stock)
                    if stock is not None:
                        stock_update_data = {
                            "old_stock": stock,
                            "image_hash": file_hash,
                            "updated_at": datetime.now().isoformat()
                        }
                        db.client.table("stock_levels")\
                            .update(stock_update_data)\
                            .eq("username", username)\
                            .eq("part_number", part_number)\
                            .execute()
                        total_stock_updates += 1
                        
                else:
                    # Restore deleted items if found in inventory
                    inventory_check = db.client.table("inventory_items")\
                        .select("id")\
                        .eq("username", username)\
                        .eq("part_number", part_number)\
                        .limit(1)\
                        .execute()
                        
                    if inventory_check.data:
                        # Restore
                        db.client.table("inventory_items")\
                            .update({"excluded_from_stock": False})\
                            .eq("username", username)\
                            .eq("part_number", part_number)\
                            .execute()
                        
                        # Create/Update Mapping
                        mapping_upsert_data = {
                            "username": username,
                            "part_number": part_number,
                            "vendor_description": vendor_description or part_number,
                            "status": "Restored",
                            "updated_at": datetime.now().isoformat(),
                            "created_at": datetime.now().isoformat()
                        }
                        
                        if customer_item: mapping_upsert_data["customer_item_name"] = customer_item
                        else: mapping_upsert_data["customer_item_name"] = ""
                        
                        if priority: mapping_upsert_data["priority"] = priority
                        if reorder is not None: mapping_upsert_data["reorder_point"] = reorder
                        
                        existing_mapping = db.client.table("vendor_mapping_entries")\
                            .select("id")\
                            .eq("username", username)\
                            .eq("part_number", part_number)\
                            .execute()
                            
                        if existing_mapping.data:
                            db.client.table("vendor_mapping_entries")\
                                .update(mapping_upsert_data)\
                                .eq("id", existing_mapping.data[0]["id"])\
                                .execute()
                        else:
                            db.client.table("vendor_mapping_entries")\
                                .insert(mapping_upsert_data)\
                                .execute()
                                
                        total_stock_updates += 1 # Count restoration as update
            
            processed_count += 1

        # Final Recalculation
        logger.info(f"🔄 Triggering final stock recalculation...")
        try:
            recalculate_stock_for_user(username)
        except Exception as e:
            logger.error(f"Stock recalculation failed: {e}")

        return MappingSheetUploadResponse(
            sheet_id="",
            image_url=last_image_url, # user can see at least one
            status="completed",
            message=f"Processed {total_files} files. Updated {total_stock_updates} stocks. Mappings: {total_mappings_created} new, {total_mappings_updated} updated.",
            extracted_rows=total_rows_extracted
        )
    
    except Exception as e:
        logger.error(f"Error uploading mapping sheets: {e}")
        raise HTTPException(status_code=500, detail=str(e))



