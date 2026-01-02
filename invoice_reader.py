import os
import glob
import json
import time
import pandas as pd
import google.generativeai as genai
from PIL import Image
from google.api_core.exceptions import DeadlineExceeded, InternalServerError, ResourceExhausted
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- CONFIGURATION ---
API_KEY = "AIzaSyCWxGGgNNNmkqTqvSulckaLjVHg2D00xCg"  # PASTE YOUR KEY HERE
IMAGE_FOLDER = r'C:\Users\MSi\Downloads\drive-download-20251230T122643Z-1-001'
OUTPUT_FILE = 'extracted_invoice_data_validated.xlsx'
MAX_RETRIES = 3 
MAX_WORKERS = 15  # Number of parallel workers
ACCURACY_THRESHOLD = 0.50  # Fallback to Pro model if accuracy < 50%

# Using the preview models
MODEL_NAME = "models/gemini-3-flash-preview"
PRO_MODEL_NAME = "models/gemini-3-pro-preview"

# Pricing in INR per million tokens (approximate rates as of Jan 2026)
# Flash: $0.075 per million input tokens, $0.30 per million output tokens
# Pro: $1.25 per million input tokens, $5.00 per million output tokens
# USD to INR conversion rate: ~83 INR per USD
PRICING_INR = {
    "Flash": {
        "input": 0.075 * 83 / 1_000_000,   # INR per token
        "output": 0.30 * 83 / 1_000_000     # INR per token
    },
    "Pro": {
        "input": 1.25 * 83 / 1_000_000,     # INR per token
        "output": 5.00 * 83 / 1_000_000     # INR per token
    }
}

# 1. Configure
genai.configure(api_key=API_KEY)

# 2. Define the Models
# REVISED INSTRUCTION: Added "Invoice_Type" for conditional validation and "Comments" for handwritten coordinates
model = genai.GenerativeModel(
    model_name=MODEL_NAME,
    system_instruction="""
    You are an expert Invoice Data Extraction AI.

    1. OBJECTIVE: Extract data into a standardized JSON format. Detect if invoice is Printed or Handwritten.

    2. JSON STRUCTURE:
       {
         "Invoice_Type": "String (Enum: 'Printed', 'Handwritten')",
         "Invoice_Date": "String (DD/MM/YYYY)",
         "Invoice_Number": "String",
         "Line_Items": [
             {
               "Part_Number": "String (If handwritten/missing, use 'N/A')",
               "Batch": "String (Extract Batch code if present. If missing, use 'N/A')",
               "Description": "String (Map 'Particulars' here)",
               "HSN": "String (If missing, use 'N/A')",
               "CGST_Percent": "Number (Critical: If listed per row, use that. If listed ONLY at bottom summary, apply that rate to ALL rows. e.g. 9)",
               "SGST_Percent": "Number (Same logic as CGST. e.g. 9)",
               "Qty": "Number (CLEAN DATA: Extract '800' from '800ml'. Remove units, keep only numbers)",
               "Rate": "Number",
               "Disc_Percent": "Number (Default to 0 if not found)",
               "Taxable_Amount": "Number (Map 'Amount' column here)",
               "Accuracy_Score": "Number (0.0 to 1.0)",
               "Comments": "String (CRITICAL: If ANY handwritten text, characters, or numbers are detected, extract their bounding box coordinates in format: 'field_name: [x1,y1,x2,y2]; field_name2: [x1,y1,x2,y2]'. If no handwritten content, use empty string '')"
             }
         ]
       }

    3. SPECIFIC RULES:
       - **Invoice_Type:** Look at the text. If it is computer font/table, set "Printed". If it is hand-scribed (like Kaviraj Sales), set "Handwritten".
       - **Handwritten Logic:** Map 'Particulars' -> 'Description', 'Amount' -> 'Taxable_Amount'. Extract numeric Qty from units.
       - **Comments Field:** For ANY handwritten characters or numbers (even in printed invoices), capture their bounding box coordinates.
       - **Printed Logic:** Capture all table rows precisely.
       - **Global Tax:** If "CGST 9%" is at the bottom summary, apply 9 to "CGST_Percent" for ALL rows.

    4. GENERAL RULES:
       - Output ONLY valid JSON.
    """,
    generation_config={
        "response_mime_type": "application/json",
        "temperature": 0.1
    }
)

# Pro model for low accuracy fallback
pro_model = genai.GenerativeModel(
    model_name=PRO_MODEL_NAME,
    system_instruction="""
    You are an expert Invoice Data Extraction AI.

    1. OBJECTIVE: Extract data into a standardized JSON format. Detect if invoice is Printed or Handwritten.

    2. JSON STRUCTURE:
       {
         "Invoice_Type": "String (Enum: 'Printed', 'Handwritten')",
         "Invoice_Date": "String (DD/MM/YYYY)",
         "Invoice_Number": "String",
         "Line_Items": [
             {
               "Part_Number": "String (If handwritten/missing, use 'N/A')",
               "Batch": "String (Extract Batch code if present. If missing, use 'N/A')",
               "Description": "String (Map 'Particulars' here)",
               "HSN": "String (If missing, use 'N/A')",
               "CGST_Percent": "Number (Critical: If listed per row, use that. If listed ONLY at bottom summary, apply that rate to ALL rows. e.g. 9)",
               "SGST_Percent": "Number (Same logic as CGST. e.g. 9)",
               "Qty": "Number (CLEAN DATA: Extract '800' from '800ml'. Remove units, keep only numbers)",
               "Rate": "Number",
               "Disc_Percent": "Number (Default to 0 if not found)",
               "Taxable_Amount": "Number (Map 'Amount' column here)",
               "Accuracy_Score": "Number (0.0 to 1.0)",
               "Comments": "String (CRITICAL: If ANY handwritten text, characters, or numbers are detected, extract their bounding box coordinates in format: 'field_name: [x1,y1,x2,y2]; field_name2: [x1,y1,x2,y2]'. If no handwritten content, use empty string '')"
             }
         ]
       }

    3. SPECIFIC RULES:
       - **Invoice_Type:** Look at the text. If it is computer font/table, set "Printed". If it is hand-scribed (like Kaviraj Sales), set "Handwritten".
       - **Handwritten Logic:** Map 'Particulars' -> 'Description', 'Amount' -> 'Taxable_Amount'. Extract numeric Qty from units.
       - **Comments Field:** For ANY handwritten characters or numbers (even in printed invoices), capture their bounding box coordinates.
       - **Printed Logic:** Capture all table rows precisely.
       - **Global Tax:** If "CGST 9%" is at the bottom summary, apply 9 to "CGST_Percent" for ALL rows.

    4. GENERAL RULES:
       - Output ONLY valid JSON.
    """,
    generation_config={
        "response_mime_type": "application/json",
        "temperature": 0.1
    }
)

def clean_json_string(text_response):
    """Cleans markdown formatting."""
    text_response = text_response.strip()
    if text_response.startswith("```json"):
        return text_response[7:-3]
    elif text_response.startswith("```"):
        return text_response[3:-3]
    return text_response

def calculate_cost(input_tokens, output_tokens, model_type):
    """Calculate cost in INR based on token usage and model type."""
    if model_type not in PRICING_INR:
        return 0.0
    
    input_cost = input_tokens * PRICING_INR[model_type]["input"]
    output_cost = output_tokens * PRICING_INR[model_type]["output"]
    return input_cost + output_cost

def process_image_with_retry(image_path):
    filename = os.path.basename(image_path)
    print(f"Processing: {filename}...")
    
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            img = Image.open(image_path)
            
            # Try with Flash model first
            response = model.generate_content(
                img,
                request_options={'timeout': 120} 
            )
            
            # Extract token usage from Flash model
            flash_input_tokens = response.usage_metadata.prompt_token_count if hasattr(response, 'usage_metadata') else 0
            flash_output_tokens = response.usage_metadata.candidates_token_count if hasattr(response, 'usage_metadata') else 0
            flash_total_tokens = flash_input_tokens + flash_output_tokens
            
            clean_text = clean_json_string(response.text)
            
            try:
                data = json.loads(clean_text)
            except json.JSONDecodeError:
                raise ValueError("Invalid JSON format")

            # --- LIST HANDLING ---
            if isinstance(data, list):
                # Fallback if model forgets root object
                data = {
                    "Invoice_Type": "Printed", # Default assumption
                    "Invoice_Date": "Not Found",
                    "Invoice_Number": "Not Found",
                    "Line_Items": data
                }
            # ---------------------

            # Check average accuracy score
            line_items = data.get("Line_Items", [])
            model_used = "Flash" # Default to Flash
            input_tokens = flash_input_tokens
            output_tokens = flash_output_tokens
            total_tokens = flash_total_tokens
            cost_inr = calculate_cost(input_tokens, output_tokens, "Flash")
            
            if line_items:
                accuracy_scores = [item.get("Accuracy_Score", 0) for item in line_items if isinstance(item, dict)]
                avg_accuracy = sum(accuracy_scores) / len(accuracy_scores) if accuracy_scores else 0
                
                # Fallback to Pro model if accuracy is below threshold
                if avg_accuracy < ACCURACY_THRESHOLD:
                    print(f"  -> Low accuracy ({avg_accuracy:.2%}), retrying with Pro model...")
                    try:
                        pro_response = pro_model.generate_content(
                            img,
                            request_options={'timeout': 180}  # Longer timeout for Pro model
                        )
                        
                        # Extract token usage from Pro model
                        pro_input_tokens = pro_response.usage_metadata.prompt_token_count if hasattr(pro_response, 'usage_metadata') else 0
                        pro_output_tokens = pro_response.usage_metadata.candidates_token_count if hasattr(pro_response, 'usage_metadata') else 0
                        pro_total_tokens = pro_input_tokens + pro_output_tokens
                        
                        pro_clean_text = clean_json_string(pro_response.text)
                        pro_data = json.loads(pro_clean_text)
                        
                        # Use Pro model data if successful
                        if isinstance(pro_data, list):
                            pro_data = {
                                "Invoice_Type": "Printed",
                                "Invoice_Date": "Not Found",
                                "Invoice_Number": "Not Found",
                                "Line_Items": pro_data
                            }
                        data = pro_data
                        model_used = "Pro"
                        # Update token counts and cost to Pro model
                        input_tokens = pro_input_tokens
                        output_tokens = pro_output_tokens
                        total_tokens = pro_total_tokens
                        cost_inr = calculate_cost(input_tokens, output_tokens, "Pro")
                        print(f"  -> Pro model completed successfully")
                    except Exception as pro_error:
                        print(f"  -> Pro model failed: {pro_error}, using Flash results")
                        model_used = "Flash (Pro failed)"
                        # Keep Flash token counts and cost
            else:
                model_used = "Flash"

            flattened_rows = []
            invoice_type = data.get("Invoice_Type", "Printed") # Default to Printed
            invoice_date = data.get("Invoice_Date", "")
            invoice_number = data.get("Invoice_Number", "")
            line_items = data.get("Line_Items", [])
            
            if not line_items:
                 if "Description" in data: 
                    line_items = [data]
                 else:
                    flattened_rows.append({
                        "Source_File": filename,
                        "Invoice_Type": invoice_type,
                        "Invoice_Date": invoice_date,
                        "Invoice_Number": invoice_number,
                        "Description": "No items found",
                        "Accuracy_Score": 0,
                        "Model_Used": model_used,
                        "Input_Tokens": input_tokens,
                        "Output_Tokens": output_tokens,
                        "Total_Tokens": total_tokens,
                        "Cost_INR": cost_inr,
                        "Comments": ""
                    })

            if line_items:
                for item in line_items:
                    if isinstance(item, dict):
                        row = {
                            "Source_File": filename,
                            "Invoice_Type": invoice_type,
                            "Invoice_Date": invoice_date,
                            "Invoice_Number": invoice_number,
                            "Model_Used": model_used,
                            "Input_Tokens": input_tokens,
                            "Output_Tokens": output_tokens,
                            "Total_Tokens": total_tokens,
                            "Cost_INR": cost_inr
                        }
                        # Ensure Comments field exists
                        if "Comments" not in item:
                            item["Comments"] = ""
                        row.update(item)
                        flattened_rows.append(row)
            
            return flattened_rows

        except (DeadlineExceeded, InternalServerError, ResourceExhausted, ValueError) as e:
            print(f"  -> Attempt {attempt} failed: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(4) 
            else:
                return [{
                    "Source_File": filename, 
                    "Description": f"Failed: {str(e)}", 
                    "Model_Used": "Failed",
                    "Input_Tokens": 0,
                    "Output_Tokens": 0,
                    "Total_Tokens": 0,
                    "Cost_INR": 0.0,
                    "Comments": ""
                }]
        except Exception as e:
            print(f"  -> Unexpected error on {filename}: {e}")
            return [{
                "Source_File": filename, 
                "Description": f"Error: {str(e)}", 
                "Model_Used": "Error",
                "Input_Tokens": 0,
                "Output_Tokens": 0,
                "Total_Tokens": 0,
                "Cost_INR": 0.0,
                "Comments": ""
            }]

def main():
    image_files = []
    for ext in ['*.jpg', '*.jpeg', '*.png', '*.webp']:
        image_files.extend(glob.glob(os.path.join(IMAGE_FOLDER, ext)))

    if not image_files:
        print(f"No images found in {IMAGE_FOLDER}")
        return

    print(f"Found {len(image_files)} images. Using model: {MODEL_NAME}")
    print(f"Using {MAX_WORKERS} parallel workers")
    print("Starting extraction...")
    
    all_rows = []

    # Parallel processing with ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # Submit all tasks
        future_to_file = {executor.submit(process_image_with_retry, img_file): img_file 
                         for img_file in image_files}
        
        # Process completed tasks as they finish
        for future in as_completed(future_to_file):
            img_file = future_to_file[future]
            try:
                rows = future.result()
                all_rows.extend(rows)
            except Exception as e:
                print(f"Error processing {os.path.basename(img_file)}: {e}")
                all_rows.append({
                    "Source_File": os.path.basename(img_file),
                    "Description": f"Processing error: {str(e)}",
                    "Model_Used": "Error",
                    "Input_Tokens": 0,
                    "Output_Tokens": 0,
                    "Total_Tokens": 0,
                    "Cost_INR": 0.0,
                    "Comments": ""
                })
            time.sleep(0.5)  # Small delay between processing

    if all_rows:
        df = pd.DataFrame(all_rows)

        # --- DATA CLEANING ---
        numeric_cols = ['Qty', 'Rate', 'Disc_Percent', 'Taxable_Amount', 'CGST_Percent', 'SGST_Percent']
        for col in numeric_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            else:
                df[col] = 0

        # Ensure Comments column exists
        if 'Comments' not in df.columns:
            df['Comments'] = ""
        
        # Ensure Model_Used column exists
        if 'Model_Used' not in df.columns:
            df['Model_Used'] = "Flash"
        
        # Ensure token and cost columns exist
        if 'Input_Tokens' not in df.columns:
            df['Input_Tokens'] = 0
        if 'Output_Tokens' not in df.columns:
            df['Output_Tokens'] = 0
        if 'Total_Tokens' not in df.columns:
            df['Total_Tokens'] = 0
        if 'Cost_INR' not in df.columns:
            df['Cost_INR'] = 0.0

        # --- CALCULATIONS ---
        try:
            # 1. Existing Formulas
            df['Discounted_Price'] = ((100 - df['Disc_Percent']) * df['Taxable_Amount']) / 100
            df['Taxed_Amount'] = (df['CGST_Percent'] + df['SGST_Percent']) * df['Discounted_Price'] / 100
            df['Net_Bill'] = df['Discounted_Price'] + df['Taxed_Amount']

            # 2. NEW: Amount Mismatch Validation
            # Logic: If 'Printed', calc abs((Qty * Rate) - Taxable_Amount). If 'Handwritten', set to 0.0.
            def calc_mismatch(row):
                if str(row.get('Invoice_Type')).lower() == 'printed':
                    calculated = row['Qty'] * row['Rate']
                    actual = row['Taxable_Amount']
                    return abs(calculated - actual)
                return 0.0

            df['Amount_Mismatch'] = df.apply(calc_mismatch, axis=1)

        except Exception as e:
            print(f"Warning: Calculation error: {e}")

        # --- ROUNDING ---
        cols_to_round = ['Rate', 'Taxable_Amount', 'Discounted_Price', 'Taxed_Amount', 'Net_Bill', 'Amount_Mismatch', 'Qty', 'Cost_INR']
        for col in cols_to_round:
            if col in df.columns:
                df[col] = df[col].round(2)

        # --- FINAL COLUMN ORDERING ---
        preferred_order = [
            'Source_File', 'Invoice_Type', 'Invoice_Date', 'Invoice_Number',
            'Part_Number', 'Batch', 'Description', 'HSN',
            'Qty', 'Rate', 'Disc_Percent', 'Taxable_Amount',
            'Amount_Mismatch',
            'CGST_Percent', 'SGST_Percent',
            'Discounted_Price', 'Taxed_Amount', 'Net_Bill',
            'Accuracy_Score', 'Model_Used', 
            'Input_Tokens', 'Output_Tokens', 'Total_Tokens', 'Cost_INR',
            'Comments'
        ]
        
        final_cols = [c for c in preferred_order if c in df.columns]
        remaining_cols = [c for c in df.columns if c not in final_cols]
        final_cols.extend(remaining_cols)
        
        df = df[final_cols]
        
        try:
            df.to_excel(OUTPUT_FILE, index=False)
            print(f"\nSuccess! Extracted {len(all_rows)} rows to {OUTPUT_FILE}")
            print(f"\nModel usage summary:")
            if 'Model_Used' in df.columns:
                print(df['Model_Used'].value_counts().to_string())
            
            # Display cost summary
            if 'Cost_INR' in df.columns and 'Total_Tokens' in df.columns:
                total_cost = df['Cost_INR'].sum()
                total_tokens = df['Total_Tokens'].sum()
                print(f"\nCost Summary:")
                print(f"  Total Tokens Used: {int(total_tokens):,}")
                print(f"  Total Cost: ₹{total_cost:.4f}")
                print(f"  Average Cost per Invoice: ₹{total_cost/len(df):.4f}" if len(df) > 0 else "")
        except PermissionError:
            print(f"\nError: Could not save. Please close {OUTPUT_FILE} if it is open.")
    else:
        print("No data extracted.")

if __name__ == "__main__":
    main()
