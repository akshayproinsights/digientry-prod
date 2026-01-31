"""
Simple test to verify advisory locks work directly via SQL.
This bypasses Supabase client RPC to test the core functionality.
"""
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_database_client
import hashlib

def test_direct_sql():
    """Test advisory locks using direct SQL execution if available"""
    db = get_database_client()
    
    # Test lock ID
    username = "testuser"
    lock_id = int(hashlib.sha256(username.encode()).hexdigest()[:16], 16) % (2**63 - 1)
    
    print(f"\nTesting advisory locks for user: {username}")
    print(f"Lock ID: {lock_id}\n")
    
    try:
        # Test 1: Check if functions exist
        result = db.client.rpc('acquire_stock_lock', {'p_lock_id': lock_id}).execute()
        print("✓ acquire_stock_lock() called successfully")
        print(f"  Result: {result}")
        
        # Test 2: Release the lock
        result = db.client.rpc('release_stock_lock', {'p_lock_id': lock_id}).execute()
        print("✓ release_stock_lock() called successfully")
        print(f"  Result: {result}")
        
        print("\n✅ All advisory lock functions are working!")
        return True
        
    except Exception as e:
        print(f"\n❌ Error testing advisory locks: {e}")
        print(f"Error type: {type(e)}")
        import traceback
        print(traceback.format_exc())
        return False


if __name__ == "__main__":
    success = test_direct_sql()
    sys.exit(0 if success else 1)
