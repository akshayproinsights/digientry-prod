"""
Stock Mapping Sheet Upload Routes
Handles PDF upload, Gemini extraction, and data storage for vendor mapping sheets.
"""
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from typing import List, Optional
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



def safe_int(value, field_name="unknown"):
    """Safely convert value to int, handling floats and strings.
    
    Args:
        value: The value to convert
        field_name: Name of the field being converted (for logging)
    
    Returns:
        Integer value or None if conversion fails
    """
    if value is None:
        return None
    
    # If already an integer, return it
    if isinstance(value, int):
        return value
    
    try:
        # Convert to float first to handle "6.0", then to int
        result = int(float(value))
        logger.debug(f"safe_int({field_name}): '{value}' ({type(value).__name__}) -> {result}")
        return result
    except (ValueError, TypeError) as e:
        logger.warning(f"safe_int({field_name}): Failed to convert '{value}' ({type(value).__name__}): {e}")
        return None


def parse_priority(value) -> Optional[str]:
    """
    Parse priority field from various formats used by Indian SMBs.
    Handles: P0, P1, P2, P3, 0, 1, 2, 3, p0, Po, PO, etc.
    
    Args:
        value: Raw priority value from Gemini extraction
    
    Returns:
        String in P-format (P0, P1, P2, P3) or None if invalid/empty
    """
    if value is None or value == "":
        return None
    
    # Convert to string and clean
    value_str = str(value).strip().upper()
    
    # Handle P0-P3 format (already has 'P')
    if value_str.startswith('P'):
        value_str = value_str[1:]  # Remove 'P' to get the number
    
    # Try to convert to int and validate range
    try:
        priority_int = int(float(value_str))
        # Validate range 0-3
        if 0 <= priority_int <= 3:
            # Return in P-format for frontend
            result = f"P{priority_int}"
            logger.debug(f"parse_priority: '{value}' → {result}")
            return result
        else:
            logger.warning(f"parse_priority: '{value}' out of range (0-3), returning None")
            return None
    except (ValueError, TypeError) as e:
        logger.warning(f"parse_priority: Failed to parse '{value}': {e}")
        return None


def parse_stock_or_reorder(value, field_name="stock") -> Optional[int]:
    """
    Parse stock/reorder fields, handling zero vs empty circle ambiguity.
    
    Context: Indian SMBs often use:
    - Actual numbers (1, 2, 10, etc.) for counted items
    - "O" or circles for "not yet counted" (should be NULL)
    - "0" (zero) for actual zero count
    
    Rules:
    - Actual number (1, 2, 10, etc.) → return as-is
    - "0" (zero) → return 0
    - "O" (letter O), "o", circle symbols → return None (not counted)
    - Empty/blank → return None
    
    Args:
        value: Raw value from Gemini extraction
        field_name: Name of field for logging
    
    Returns:
        Integer value or None
    """
    if value is None or value == "":
        logger.debug(f"parse_{field_name}: empty/None → null")
        return None
    
    # Convert to string and clean
    value_str = str(value).strip()
    
    # Check for circle indicators (empty/not counted)
    # Common patterns: 'O', 'o', circle symbols, 'null' string
    circle_indicators = ['O', 'o', '○', '◯', 'null', 'NULL']
    if value_str in circle_indicators:
        logger.debug(f"parse_{field_name}: '{value}' → null (circle/empty marker)")
        return None
    
    # Try to parse as number (handles '0', '10', '5.0', etc.)
    try:
        result = int(float(value_str))
        logger.debug(f"parse_{field_name}: '{value}' → {result}")
        return result
    except (ValueError, TypeError) as e:
        logger.warning(f"parse_{field_name}: Failed to parse '{value}', treating as null: {e}")
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
                # Extract and convert all fields with robust parsing
                row_number = safe_int(row.get("row_number"), "row_number")
                if row_number is None:
                    row_number = index + 1
                    
                part_number = row.get("part_number")
                vendor_description = row.get("vendor_description")
                customer_item = row.get("customer_item")
                
                # Use robust parsing functions for handwritten fields
                priority = parse_priority(row.get("priority"))
                stock = parse_stock_or_reorder(row.get("stock"), "stock")
                reorder = parse_stock_or_reorder(row.get("reorder"), "reorder")
                
                logger.info(f"📋 Row {index + 1}: part={part_number}, priority={priority}, stock={stock}, reorder={reorder}")
                
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
                    
                    # Use 'is not None' to properly handle 0 values
                    if customer_item: 
                        mapping_upsert_data["customer_item_name"] = customer_item
                    if priority is not None: 
                        mapping_upsert_data["priority"] = priority
                        logger.info(f"✅ Setting priority={priority} for {part_number}")
                    else:
                        logger.warning(f"⚠️ Priority is None for {part_number}, not setting")
                    if reorder is not None: 
                        mapping_upsert_data["reorder_point"] = reorder
                    
                    try:
                        if existing_mapping.data:
                            logger.info(f"🔄 Updating existing mapping for {part_number}: {mapping_upsert_data}")
                            db.client.table("vendor_mapping_entries")\
                                .update(mapping_upsert_data)\
                                .eq("id", existing_mapping.data[0]["id"])\
                                .execute()
                            total_mappings_updated += 1
                        else:
                            mapping_upsert_data["row_number"] = row_number
                            mapping_upsert_data["created_at"] = datetime.now().isoformat()
                            if not customer_item: 
                                mapping_upsert_data["customer_item_name"] = ""
                            
                            logger.info(f"➕ Inserting new mapping for {part_number}: {mapping_upsert_data}")
                            db.client.table("vendor_mapping_entries")\
                                .insert(mapping_upsert_data)\
                                .execute()
                            total_mappings_created += 1
                    except Exception as db_err:
                        logger.error(f"Database error for mapping {part_number}: {db_err}")
                        logger.error(f"Problematic data: {mapping_upsert_data}")
                        raise
                        
                    # Update Stock Count (Map to ON HAND via manual_adjustment)
                    if stock is not None:
                         # Calculate adjustment needed to make On Hand == stock
                        # On Hand = current_stock + manual_adjustment
                        # desired_stock = current_stock + new_adjustment
                        # new_adjustment = desired_stock - current_stock
                        
                        # CRITICAL: Convert to int to prevent float values (e.g., "6.0" error)
                        current_sys_stock = int(stock_item.get("current_stock", 0) or 0)
                        adjustment_value = int(stock - current_sys_stock)
                        
                        stock_update_data = {
                            "old_stock": int(stock),  # Ensure integer
                            "manual_adjustment": adjustment_value,  # Now guaranteed to be int
                            "image_hash": file_hash,
                            "updated_at": datetime.now().isoformat()
                        }
                        
                        try:
                            logger.debug(f"Updating stock for {part_number}: {stock_update_data}")
                            db.client.table("stock_levels")\
                                .update(stock_update_data)\
                                .eq("username", username)\
                                .eq("part_number", part_number)\
                                .execute()
                            total_stock_updates += 1
                        except Exception as db_err:
                            logger.error(f"Database error updating stock for {part_number}: {db_err}")
                            logger.error(f"Problematic data: {stock_update_data}")
                            raise
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
                        
                        if customer_item: 
                            mapping_upsert_data["customer_item_name"] = customer_item
                        else: 
                            mapping_upsert_data["customer_item_name"] = ""
                        
                        if priority is not None: 
                            mapping_upsert_data["priority"] = priority
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
                                    "manual_adjustment": int(stock),  # Ensure integer
                                    "old_stock": int(stock),  # Ensure integer
                                    "updated_at": datetime.now().isoformat()
                                }).execute()
                                logger.info(f"✨ Created stock_level for restored item {part_number} with stock {stock}")
                            except Exception as insert_err:
                                logger.warning(f"Could not insert stock_level for restored item (might exist?): {insert_err}")
                                # Fallback update
                                db.client.table("stock_levels")\
                                    .update({"manual_adjustment": int(stock), "old_stock": int(stock)})\
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



