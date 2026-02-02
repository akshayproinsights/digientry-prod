
import os
import sys
from database import get_database_client
from dotenv import load_dotenv

load_dotenv()

def list_columns():
    try:
        db = get_database_client()
        # Create a dummy query to inspect schema or use a direct SQL if possible via rpc or just check what we can select
        # PostgREST doesn't easily show schema, but we can try selecting one row and looking at keys
        response = db.client.table("inventory_items").select("*").limit(1).execute()
        
        if response.data:
            print("Columns found in inventory_items:")
            for key in response.data[0].keys():
                print(f"- {key}")
        else:
            print("Table empty, checking for missing columns...")
            cols_to_check = [
                "row_id", "username", "industry_type", "image_hash", 
                "source_file", "receipt_link", "invoice_type", 
                "invoice_date", "invoice_number", "vendor_name", 
                "part_number", "batch", "description", "hsn", 
                "qty", "rate", "disc_percent", "taxable_amount", 
                "cgst_percent", "sgst_percent", 
                "discounted_price", "taxed_amount", "net_bill", 
                "amount_mismatch",
                "model_used", "model_accuracy", "input_tokens", "output_tokens", "total_tokens", "cost_inr",
                "accuracy_score", "row_accuracy"
            ]
            print(f"Checking {len(cols_to_check)} columns...")
            for col in cols_to_check:
                try:
                    db.client.table("inventory_items").select(col).limit(1).execute()
                    print(f"Column '{col}' EXISTS.")
                except Exception as e:
                    print(f"Column '{col}' MISSING.")
                except Exception as e:
                    print(f"Column '{col}' MISSING.")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_columns()
