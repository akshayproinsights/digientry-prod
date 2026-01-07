"""
Inventory processor service with Gemini AI integration.
Uses vendor_gemini prompt for vendor invoice extraction.
"""
import os
import json
import time
import logging
from typing import List, Dict, Any, Optional, Callable
from datetime import datetime

from google import genai
from google.genai import types
from PIL import Image
import tempfile

from services.processor import (
    calculate_image_hash,
    RateLimiter,
    calculate_accuracy,
    calculate_cost_inr
)
from services.storage import get_storage_client
from database import get_database_client
from config import get_google_api_key
from config_loader import get_user_config
from utils.date_helpers import normalize_date, format_to_db, get_ist_now_str

logger = logging.getLogger(__name__)

# Rate limiter for API calls
limiter = RateLimiter(rpm=30)

# Model Configuration
PRIMARY_MODEL = "gemini-3-flash-preview"
FALLBACK_MODEL = "gemini-3-pro-preview"
ACCURACY_THRESHOLD = 50.0  # Switch to Pro if accuracy < 50%


def process_vendor_invoice(
    image_bytes: bytes,
    filename: str,
    receipt_link: str,
    username: str
) -> Optional[Dict[str, Any]]:
    """
    Process a vendor invoice image using Gemini AI with vendor_gemini prompt.
    
    Args:
        image_bytes: Image data
        filename: Original filename
        receipt_link: R2 presigned URL
        username: Username for config lookup
        
    Returns:
        Extracted invoice data dictionary or None
    """
    logger.info(f"Processing vendor invoice: {filename}")
    
    # Get user config with vendor_gemini prompt
    user_config = get_user_config(username)
    if not user_config:
        logger.error(f"No config found for user: {username}")
        return None
    
    vendor_prompt = user_config.get("vendor_gemini", {}).get("system_instruction")
    if not vendor_prompt:
        logger.error(f"No vendor_gemini prompt found for user: {username}")
        return None
    
    # Get API key
    api_key = get_google_api_key()
    if not api_key:
        logger.error("No Google API key configured")
        return None
    
    # Configure Gemini client
    client = genai.Client(api_key=api_key)
    
    # Convert bytes to PIL Image
    import io
    img = Image.open(io.BytesIO(image_bytes))
    
    try:
        # Try with Flash model first
        logger.info(f"Trying {PRIMARY_MODEL} for vendor invoice extraction...")
        
        config = types.GenerateContentConfig(
            system_instruction=vendor_prompt,
            response_mime_type="application/json",
            temperature=0.1
        )
        
        response = client.models.generate_content(
            model=PRIMARY_MODEL,
            contents=[img, "Extract all vendor invoice data according to the instructions."],
            config=config
        )
        
        # Parse response
        json_text = response.text.strip()
        extracted_data = json.loads(json_text)
        
        # Handle case where Gemini returns just the items array instead of full structure
        if isinstance(extracted_data, list):
            extracted_data = {
                "invoice_type": "Printed",
                "invoice_date": "",
                "invoice_number": "",
                "items": extracted_data
            }
        
        # Calculate accuracy
        items = extracted_data.get("items", [])
        accuracy = calculate_accuracy(items)
        
        # Get token usage
        usage = response.usage_metadata
        input_tokens = usage.prompt_token_count if usage else 0
        output_tokens = usage.candidates_token_count if usage else 0
        total_tokens = input_tokens + output_tokens
        
        # Calculate cost
        cost_inr = calculate_cost_inr(input_tokens, output_tokens, "Flash")
        
        model_used = "Flash"
        
        # Fallback to Pro if accuracy is low
        if accuracy < ACCURACY_THRESHOLD:
            logger.warning(f"Flash accuracy ({accuracy}%) < {ACCURACY_THRESHOLD}%, falling back to Pro model...")
            
            config_pro = types.GenerateContentConfig(
                system_instruction=vendor_prompt,
                response_mime_type="application/json",
                temperature=0.1
            )
            
            response_pro = client.models.generate_content(
                model=FALLBACK_MODEL,
                contents=[img, "Extract all vendor invoice data according to the instructions."],
                config=config_pro
            )
            
            json_text = response_pro.text.strip()
            extracted_data = json.loads(json_text)
            
            # Recalculate with Pro model
            items = extracted_data.get("items", [])
            accuracy = calculate_accuracy(items)
            
            usage_pro = response_pro.usage_metadata
            input_tokens = usage_pro.prompt_token_count if usage_pro else 0
            output_tokens = usage_pro.candidates_token_count if usage_pro else 0
            total_tokens = input_tokens + output_tokens
            cost_inr = calculate_cost_inr(input_tokens, output_tokens, "Pro")
            
            model_used = "Pro"
            logger.info(f"Pro model accuracy: {accuracy}%")
        
        # Transform to match expected format
        result = {
            "header": {
                "invoice_type": extracted_data.get("invoice_type", "Printed"),
                "invoice_number": extracted_data.get("invoice_number", ""),
                "date": extracted_data.get("invoice_date", ""),
                "source_file": filename
            },
            "items": items,
            "receipt_link": receipt_link,
            "upload_date": get_ist_now_str(),
            "model_used": model_used,
            "model_accuracy": accuracy,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "cost_inr": cost_inr
        }
        
        logger.info(f"✓ Vendor invoice processed: {filename} (Model: {model_used}, Accuracy: {accuracy}%)")
        return result
        
    except Exception as e:
        logger.error(f"Error processing vendor invoice {filename}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None

def convert_to_inventory_rows(
    invoice_data: Dict[str, Any],
    username: str,
    image_hash: str  # Add image_hash parameter
) -> List[Dict[str, Any]]:
    """
    Convert extracted invoice data to inventory_items table rows.
    Similar to convert_to_dataframe_rows but for inventory schema.
    
    Args:
        invoice_data: Extracted data from Gemini
        username: Username for RLS
        image_hash: Image hash for duplicate detection
        
    Returns:
        List of row dictionaries for inventory_items table
    """
    header = invoice_data.get("header", {})
    items = invoice_data.get("items", [])
    receipt_link = invoice_data.get("receipt_link", "")
    upload_date = invoice_data.get("upload_date", "")
    
    # Model metadata
    model_used = invoice_data.get("model_used", "")
    model_accuracy = invoice_data.get("model_accuracy", 0.0)
    input_tokens = invoice_data.get("input_tokens", 0)
    output_tokens = invoice_data.get("output_tokens", 0)
    total_tokens = invoice_data.get("total_tokens", 0)
    cost_inr = invoice_data.get("cost_inr", 0.0)
    
    # Get user config
    user_config = get_user_config(username)
    if not user_config:
        logger.error(f"No config found for user: {username}")
        return []
    
    # Normalize date
    raw_date = header.get("date", "")
    normalized_date = normalize_date(raw_date)
    if normalized_date:
        date_to_store = format_to_db(normalized_date)
    elif raw_date and raw_date.strip():
        date_to_store = raw_date
    else:
        date_to_store = None
    
    def safe_float(val, default=0):
        """Safely convert to float"""
        if val is None or val == "" or val == "N/A":
            return default
        try:
            return float(val)
        except (ValueError, TypeError):
            return default
    
    def get_bbox_json(data_dict, field_name):
        """Extract bbox and convert to JSON, or None if missing"""
        bbox = data_dict.get(f"{field_name}_bbox")
        if bbox and isinstance(bbox, dict):
            return bbox
        return None
    
    rows = []
    for idx, item in enumerate(items):
        qty = safe_float(item.get("quantity"), 1)
        rate = safe_float(item.get("rate"), 0)
        taxable_amount = safe_float(item.get("amount"), 0)
        
        # Calculate derived fields
        disc_percent = safe_float(item.get("disc_percent"), 0)
        cgst_percent = safe_float(item.get("cgst_percent"), 0)
        sgst_percent = safe_float(item.get("sgst_percent"), 0)
        
        discounted_price = ((100 - disc_percent) * taxable_amount) / 100
        taxed_amount = (cgst_percent + sgst_percent) * discounted_price / 100
        net_bill = discounted_price + taxed_amount
        
        # Calculate amount mismatch (for printed invoices)
        invoice_type = header.get("invoice_type", "Printed")
        if invoice_type.lower() == "printed":
            calc_amount = qty * rate
            amount_mismatch = abs(calc_amount - taxable_amount)
        else:
            amount_mismatch = 0.0
        
        # Build inventory row
        row = {
            # System columns
            "row_id": f"{header.get('invoice_number', '')}_{idx}",
            "username": username,
            "industry_type": user_config.get("industry", ""),
            "image_hash": image_hash,  # Add image hash for duplicate detection
            
            # File information
            "source_file": header.get("source_file", ""),
            "receipt_link": receipt_link,
            
            # Invoice header
            "invoice_type": invoice_type,
            "invoice_date": date_to_store,
            "invoice_number": header.get("invoice_number", ""),
            
            # Line item details
            "part_number": item.get("part_number", "N/A"),
            "batch": item.get("batch", "N/A"),
            "description": item.get("description", ""),
            "hsn": item.get("hsn", "N/A"),
            
            # Quantities and pricing
            "qty": qty,
            "rate": rate,
            "disc_percent": disc_percent,
            "taxable_amount": taxable_amount,
            
            # Tax information
            "cgst_percent": cgst_percent,
            "sgst_percent": sgst_percent,
            
            # Calculated fields
            "discounted_price": round(discounted_price, 2),
            "taxed_amount": round(taxed_amount, 2),
            "net_bill": round(net_bill, 2),
            "amount_mismatch": round(amount_mismatch, 2),
            
            # AI model tracking
            "model_used": model_used,
            "model_accuracy": model_accuracy,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "cost_inr": cost_inr,
            "accuracy_score": item.get("confidence", 0),
            
            # Bounding boxes
            "part_number_bbox": get_bbox_json(item, "part_number"),
            "batch_bbox": get_bbox_json(item, "batch"),
            "description_bbox": get_bbox_json(item, "description"),
            "hsn_bbox": get_bbox_json(item, "hsn"),
            "qty_bbox": get_bbox_json(item, "quantity"),
            "rate_bbox": get_bbox_json(item, "rate"),
            "disc_percent_bbox": get_bbox_json(item, "disc_percent"),
            "taxable_amount_bbox": get_bbox_json(item, "amount"),
            "cgst_percent_bbox": get_bbox_json(item, "cgst_percent"),
            "sgst_percent_bbox": get_bbox_json(item, "sgst_percent"),
            "line_item_row_bbox": get_bbox_json(item, "line_item_row"),
        }
        
        rows.append(row)
    
    return rows

    header = invoice_data.get("header", {})
    items = invoice_data.get("items", [])
    receipt_link = invoice_data.get("receipt_link", "")
    upload_date = invoice_data.get("upload_date", "")
    
    # Model metadata
    model_used = invoice_data.get("model_used", "")
    model_accuracy = invoice_data.get("model_accuracy", 0.0)
    input_tokens = invoice_data.get("input_tokens", 0)
    output_tokens = invoice_data.get("output_tokens", 0)
    total_tokens = invoice_data.get("total_tokens", 0)
    cost_inr = invoice_data.get("cost_inr", 0.0)
    
    # Get user config
    user_config = get_user_config(username)
    if not user_config:
        logger.error(f"No config found for user: {username}")
        return []
    
    # Normalize date
    raw_date = header.get("date", "")
    normalized_date = normalize_date(raw_date)
    if normalized_date:
        date_to_store = format_to_db(normalized_date)
    elif raw_date and raw_date.strip():
        date_to_store = raw_date
    else:
        date_to_store = None
    
    def safe_float(val, default=0):
        """Safely convert to float"""
        if val is None or val == "" or val == "N/A":
            return default
        try:
            return float(val)
        except (ValueError, TypeError):
            return default
    
    def get_bbox_json(data_dict, field_name):
        """Extract bbox and convert to JSON, or None if missing"""
        bbox = data_dict.get(f"{field_name}_bbox")
        if bbox and isinstance(bbox, dict):
            return bbox
        return None
    
    rows = []
    for idx, item in enumerate(items):
        qty = safe_float(item.get("quantity"), 1)
        rate = safe_float(item.get("rate"), 0)
        taxable_amount = safe_float(item.get("amount"), 0)
        
        # Calculate derived fields
        disc_percent = safe_float(item.get("disc_percent"), 0)
        cgst_percent = safe_float(item.get("cgst_percent"), 0)
        sgst_percent = safe_float(item.get("sgst_percent"), 0)
        
        discounted_price = ((100 - disc_percent) * taxable_amount) / 100
        taxed_amount = (cgst_percent + sgst_percent) * discounted_price / 100
        net_bill = discounted_price + taxed_amount
        
        # Calculate amount mismatch (for printed invoices)
        invoice_type = header.get("invoice_type", "Printed")
        if invoice_type.lower() == "printed":
            calc_amount = qty * rate
            amount_mismatch = abs(calc_amount - taxable_amount)
        else:
            amount_mismatch = 0.0
        
        # Build inventory row
        row = {
            # System columns
            "row_id": f"{header.get('invoice_number', '')}_{idx}",
            "username": username,
            "industry_type": user_config.get("industry", ""),
            
            # File information
            "source_file": header.get("source_file", ""),
            "receipt_link": receipt_link,
            
            # Invoice header
            "invoice_type": invoice_type,
            "invoice_date": date_to_store,
            "invoice_number": header.get("invoice_number", ""),
            
            # Line item details
            "part_number": item.get("part_number", "N/A"),
            "batch": item.get("batch", "N/A"),
            "description": item.get("description", ""),
            "hsn": item.get("hsn", "N/A"),
            
            # Quantities and pricing
            "qty": qty,
            "rate": rate,
            "disc_percent": disc_percent,
            "taxable_amount": taxable_amount,
            
            # Tax information
            "cgst_percent": cgst_percent,
            "sgst_percent": sgst_percent,
            
            # Calculated fields
            "discounted_price": round(discounted_price, 2),
            "taxed_amount": round(taxed_amount, 2),
            "net_bill": round(net_bill, 2),
            "amount_mismatch": round(amount_mismatch, 2),
            
            # AI model tracking
            "model_used": model_used,
            "model_accuracy": model_accuracy,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "cost_inr": cost_inr,
            "accuracy_score": item.get("confidence", 0),
            
            # Bounding boxes
            "part_number_bbox": get_bbox_json(item, "part_number"),
            "batch_bbox": get_bbox_json(item, "batch"),
            "description_bbox": get_bbox_json(item, "description"),
            "hsn_bbox": get_bbox_json(item, "hsn"),
            "qty_bbox": get_bbox_json(item, "quantity"),
            "rate_bbox": get_bbox_json(item, "rate"),
            "disc_percent_bbox": get_bbox_json(item, "disc_percent"),
            "taxable_amount_bbox": get_bbox_json(item, "amount"),
            "cgst_percent_bbox": get_bbox_json(item, "cgst_percent"),
            "sgst_percent_bbox": get_bbox_json(item, "sgst_percent"),
            "line_item_row_bbox": get_bbox_json(item, "line_item_row"),
            
            # New fields for verification
            "upload_date": datetime.now().isoformat(),
            "verification_status": "Done" if amount_mismatch == 0 else "Pending",
        }
        
        rows.append(row)
    
    return rows


def save_to_inventory_table(rows: List[Dict[str, Any]], username: str):
    """
    Save inventory rows to Supabase inventory_items table.
    
    Args:
        rows: List of inventory item dictionaries
        username: Username for RLS
    """
    if not rows:
        logger.warning("No rows to save to inventory_items")
        return
    
    try:
        db = get_database_client()
        
        # Insert all rows
        response = db.client.table("inventory_items").insert(rows).execute()
        
        logger.info(f"✓ Saved {len(rows)} rows to inventory_items table")
        
    except Exception as e:
        logger.error(f"Error saving to inventory_items: {e}")
        raise


def process_inventory_batch(
    file_keys: List[str],
    r2_bucket: str,
    username: str,
    progress_callback: Optional[Callable] = None
) -> Dict[str, Any]:
    """
    Process a batch of inventory images with Gemini AI.
    
    Args:
        file_keys: List of R2 file keys to process
        r2_bucket: R2 bucket name
        username: Username for config and RLS
        progress_callback: Optional callback for progress updates
        
    Returns:
        Dictionary with processing results
    """
    logger.info(f"Starting inventory batch processing: {len(file_keys)} files")
    
    storage = get_storage_client()
    db = get_database_client()
    processed = 0
    failed = 0
    errors = []
    duplicates = []  # Track duplicates for user decision
    
    for idx, file_key in enumerate(file_keys):
        try:
            # Update progress
            if progress_callback:
                progress_callback(idx, len(file_keys), file_key)
            
            logger.info(f"Processing inventory file {idx + 1}/{len(file_keys)}: {file_key}")
            
            # Download image from R2
            image_bytes = storage.download_file(r2_bucket, file_key)
            if not image_bytes:
                raise Exception(f"Failed to download file from R2: {file_key}")
            
            # Calculate image hash for duplicate detection
            img_hash = calculate_image_hash(image_bytes)
            logger.info(f"Image hash: {img_hash}")
            
            # Check for duplicates in inventory_items table
            try:
                duplicate_check = db.client.table("inventory_items")\
                    .select("*")\
                    .eq("image_hash", img_hash)\
                    .eq("username", username)\
                    .limit(1)\
                    .execute()
                
                if duplicate_check.data and len(duplicate_check.data) > 0:
                    # Duplicate found!
                    existing_record = duplicate_check.data[0]
                    logger.warning(f"Duplicate detected for {file_key}: image_hash={img_hash}")
                    
                    # Add to duplicates list for user decision
                    duplicates.append({
                        "file_key": file_key,
                        "image_hash": img_hash,
                        "existing_record": {
                            "id": existing_record.get("id"),
                            "invoice_number": existing_record.get("invoice_number"),
                            "invoice_date": existing_record.get("invoice_date"),
                            "receipt_link": existing_record.get("receipt_link"),
                            "upload_date": existing_record.get("upload_date"),
                            "part_number": existing_record.get("part_number"),
                            "description": existing_record.get("description")
                        },
                        "message": f"This vendor invoice was already uploaded on {existing_record.get('upload_date', 'unknown date')}"
                    })
                    
                    # Skip processing this file - let user decide
                    logger.info(f"Skipping {file_key} - duplicate detected")
                    continue
                    
            except Exception as e:
                logger.error(f"Error checking for duplicates: {e}")
                # Continue processing even if duplicate check fails
            
            # Generate presigned URL for receipt link
            client = storage.get_client()
            receipt_link = client.generate_presigned_url(
                'get_object',
                Params={'Bucket': r2_bucket, 'Key': file_key},
                ExpiresIn=604800  # 7 days
            )
            
            # Process with Gemini AI using VENDOR prompt
            invoice_data = process_vendor_invoice(
                image_bytes=image_bytes,
                filename=file_key.split('/')[-1],
                receipt_link=receipt_link,
                username=username
            )
            
            if not invoice_data:
                raise Exception("Gemini processing returned no data")
            
            # Convert to inventory rows
            inventory_rows = convert_to_inventory_rows(invoice_data, username, img_hash)
            
            if not inventory_rows:
                raise Exception("No inventory rows generated from extracted data")
            
            # Save to inventory_items table
            save_to_inventory_table(inventory_rows, username)
            
            processed += 1
            logger.info(f"✓ Successfully processed inventory item: {file_key}")
            
        except Exception as e:
            failed += 1
            error_msg = f"Failed to process {file_key}: {str(e)}"
            errors.append(error_msg)
            logger.error(error_msg)
            continue
    
    # Final progress update
    if progress_callback:
        progress_callback(len(file_keys), len(file_keys), "Complete")
    
    results = {
        "processed": processed,
        "failed": failed,
        "errors": errors,
        "duplicates": duplicates  # Include duplicates for frontend handling
    }
    
    logger.info(f"Inventory batch processing complete: {processed} succeeded, {failed} failed, {len(duplicates)} duplicates")
    
    return results
