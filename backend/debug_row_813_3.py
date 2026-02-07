
import asyncio
from database import get_database_client

async def debug_receipt():
    db = get_database_client()
    username = 'adnak-test'
    receipt_number = '813'
    row_id_target = '813_3'
    
    print(f"--- Debugging Receipt: {receipt_number} for user: {username} ---")
    
    # Check invoices
    print("\n[INVOICES TABLE - All rows for receipt 813]")
    try:
        res = db.query('invoices').eq('username', username).eq('receipt_number', receipt_number).execute()
        if res.data:
            for row in res.data:
                print(f"Row_ID: {row.get('row_id')}, R2: {row.get('r2_file_path')}, Link: {row.get('receipt_link')}")
        else:
            print("No record found in invoices table.")
    except Exception as e:
        print(f"Error querying invoices: {e}")

    # Check verification_dates
    print("\n[VERIFICATION_DATES TABLE]")
    try:
        res = db.query('verification_dates').eq('username', username).eq('receipt_number', receipt_number).execute()
        if res.data:
            for row in res.data:
                print(f"Row_ID: {row.get('row_id')}, Link: {row.get('receipt_link')}")
        else:
            print("No record found in verification_dates.")
    except Exception as e:
        print(f"Error querying verification_dates: {e}")

    # Check verification_amounts
    print("\n[VERIFICATION_AMOUNTS TABLE - Target Row Only]")
    try:
        res = db.query('verification_amounts').eq('username', username).eq('row_id', row_id_target).execute()
        if res.data:
            for row in res.data:
                print(f"Row_ID: {row.get('row_id')}, Link: {row.get('receipt_link')}")
        else:
            print("No record found in verification_amounts.")
    except Exception as e:
        print(f"Error querying verification_amounts: {e}")

if __name__ == "__main__":
    asyncio.run(debug_receipt())
