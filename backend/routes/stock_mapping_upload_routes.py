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
from utils.image_optimizer import optimize_image_for_gemini, should_optimize_image, validate_image_quality

# Import recalculation wrapper for background execution
from routes.stock_routes import recalculate_stock_wrapper
from fastapi import BackgroundTasks
import uuid

logger = logging.getLogger(__name__)
router = APIRouter()


def calculate_file_hash(content: bytes) -> str:
    """Calculate SHA256 hash of file content"""
    return hashlib.sha256(content).hexdigest()



def safe_int(value):
    """Safely convert value to int, handling floats and strings."""
    if value is None:
        return None
    try:
        # Convert to float first to handle "6.0", then to int
        return int(float(value))
    except (ValueError, TypeError):
        return None

@router.post("/upload", response_model=MappingSheetUploadResponse)
async def upload_mapping_sheet(
    background_tasks: BackgroundTasks,
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
            
            # 2. Optimize image before upload (same as sales uploads)
            try:
                # Validate image quality
                validation = validate_image_quality(content)
                if not validation['is_acceptable']:
                    for warning in validation['warnings']:
                        logger.warning(f"{file.filename}: {warning}")
                
                # Optimize image if needed to reduce size and improve Gemini speed
                if should_optimize_image(content):
                    logger.info(f"Optimizing mapping sheet: {file.filename}")
                    optimized_content, metadata = optimize_image_for_gemini(content)
                    
                    logger.info(f"Optimization results for {file.filename}:")
                    logger.info(f"  Original: {metadata['original_size_kb']}KB, {metadata['original_dimensions'][0]}x{metadata['original_dimensions'][1]}")
                    logger.info(f"  Optimized: {metadata['optimized_size_kb']}KB, {metadata['final_dimensions'][0]}x{metadata['final_dimensions'][1]}")
                    logger.info(f"  Compression: {metadata['compression_ratio']}% reduction")
                    
                    content = optimized_content
                else:
                    logger.info(f"Skipping optimization for {file.filename} (already optimal)")
            except Exception as opt_err:
                logger.warning(f"Image optimization failed for {file.filename}, using original: {opt_err}")
                # Continue with original content if optimization fails
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            extension = file.filename.split(".")[-1] if "." in file.filename else "pdf"
            filename = f"{timestamp}_{file_hash[:8]}.{extension}"
            key = f"{mappings_folder}{filename}"
            
            # 3. Upload optimized image to R2
            # Always use JPEG content type after optimization
            content_type = "image/jpeg"  # Our optimizer always outputs JPEG
            success = storage.upload_file(
                file_data=content,
                bucket=bucket,
                key=key,
                content_type=content_type
            )
            
            if success:
                last_image_url = storage.get_public_url(bucket, key)
            
            # 4. Extract data using Gemini
            response = client.models.generate_content(
                model="gemini-3-flash-preview",
                contents=[
                    types.Part.from_bytes(data=content, mime_type=content_type),
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
                row_number = safe_int(row.get("row_number"))
                if row_number is None:
                    row_number = index + 1
                    
                part_number = row.get("part_number")
                vendor_description = row.get("vendor_description")
                customer_item = row.get("customer_item")
                priority = safe_int(row.get("priority"))
                stock = safe_int(row.get("stock"))
                reorder = safe_int(row.get("reorder"))
                
                if not part_number:
                    continue
                
                # Check for existing stock
                existing_stock = db.client.table("stock_levels")\
                    .select("id, internal_item_name, current_stock")\
                    .eq("username", username)\
                    .eq("part_number", part_number)\
                    .execute()
                
                if existing_stock.data:
                    stock_item = existing_stock.data[0]
                    # Update Vendor Mapping Entry
                    internal_item_name = stock_item.get("internal_item_name", vendor_description)
                    
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
                        
                    # Update Stock Count (Map to ON HAND via manual_adjustment)
                    if stock is not None:
                         # Calculate adjustment needed to make On Hand == stock
                        # On Hand = current_stock + manual_adjustment
                        # desired_stock = current_stock + new_adjustment
                        # new_adjustment = desired_stock - current_stock
                        
                        current_sys_stock = stock_item.get("current_stock", 0) or 0
                        adjustment_value = stock - current_sys_stock
                        
                        stock_update_data = {
                            "old_stock": stock, # Keep for legitimate history if needed
                            "manual_adjustment": adjustment_value,
                            "image_hash": file_hash,
                            "updated_at": datetime.now().isoformat()
                        }
                        db.client.table("stock_levels")\
                            .update(stock_update_data)\
                            .eq("username", username)\
                            .eq("part_number", part_number)\
                            .execute()
                        total_stock_updates += 1
                        logger.info(f"✏️ Updated stock for {part_number}: Target={stock}, Current={current_sys_stock}, Adj={adjustment_value}")
                        
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
                        logger.info(f"✨ Restored mapping + un-excluded inventory for {part_number}")

                        # Update Stock for Restored Item (if stock provided)
                        if stock is not None:
                            # For restored items, current_stock will be 0 until recalculation
                            # So we set manual_adjustment = stock
                            
                            # Try to create a dummy stock_levels record for now so manual_adjustment is saved
                            # Recalc will overwrite but preserve manual_adjustment
                            try:
                                db.client.table("stock_levels").insert({
                                    "username": username,
                                    "part_number": part_number,
                                    "internal_item_name": vendor_description or part_number,
                                    "current_stock": 0,
                                    "manual_adjustment": stock,
                                    "old_stock": stock,
                                    "updated_at": datetime.now().isoformat()
                                }).execute()
                                logger.info(f"✨ Created stock_level for restored item {part_number} with stock {stock}")
                            except Exception as insert_err:
                                logger.warning(f"Could not insert stock_level for restored item (might exist?): {insert_err}")
                                # Fallback update
                                db.client.table("stock_levels")\
                                    .update({"manual_adjustment": stock, "old_stock": stock})\
                                    .eq("username", username)\
                                    .eq("part_number", part_number)\
                                    .execute()
            
            processed_count += 1

        # Final Recalculation (Background Task)
        logger.info(f"🔄 Queuing stock recalculation for {username}...")
        try:
            # Create a task_id for tracking
            recalc_task_id = str(uuid.uuid4())
            
            # Initialize task in DB (required for wrapper updates)
            db.insert("recalculation_tasks", {
                "task_id": recalc_task_id,
                "username": username,
                "status": "queued",
                "message": "Auto-triggered after mapping sheet upload",
                "progress": {"total": 0, "processed": 0},
                "created_at": datetime.utcnow().isoformat()
            })
            
            # Run in background (uses stock_executor thread pool)
            background_tasks.add_task(recalculate_stock_wrapper, recalc_task_id, username)
            logger.info(f"✅ Stock recalculation queued (Task: {recalc_task_id})")
            
        except Exception as e:
            logger.error(f"Failed to queue stock recalculation: {e}")
            # Don't fail the upload just because auto-recalc failed

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



