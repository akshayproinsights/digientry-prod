"""
Database helper functions for route endpoints.
Provides clean interface for common Supabase queries.
"""
from typing import List, Dict, Any, Optional
import logging
import pandas as pd
from database import get_database_client

logger = logging.getLogger(__name__)


def convert_numeric_types(row_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert numeric values to proper Python types for Supabase.
    - Integers without decimals: convert to int
    - Floats with decimals: convert to float
    - Remove .0 suffix from string representations
    """
    integer_fields = ['quantity', 'odometer']  # Fields that should be integers
    float_fields = ['rate', 'amount', 'total_bill_amount', 'calculated_amount', 'amount_mismatch']
    
    for key, value in row_dict.items():
        if value is None or pd.isna(value):
            row_dict[key] = None
            continue
            
        # Handle integer fields
        if key in integer_fields:
            try:
                # Convert to float first, then to int
                row_dict[key] = int(float(value))
            except (ValueError, TypeError):
                row_dict[key] = None
        
        # Handle float fields
        elif key in float_fields:
            try:
                row_dict[key] = float(value)
            except (ValueError, TypeError):
                row_dict[key] = None
        
        # Handle string fields that might be floats (e.g., "801.0" -> "801")
        elif isinstance(value, str) and value.endswith('.0'):
            try:
                # Check if it's a numeric string
                float_val = float(value)
                if float_val.is_integer():
                    row_dict[key] = value[:-2]  # Remove .0
            except ValueError:
                pass  # Keep as is if not numeric
    
    return row_dict



def get_all_invoices(username: str, limit: Optional[int] = None, offset: int = 0) -> List[Dict[str, Any]]:
    """
    Get all invoices for a user from Supabase.
    
    IMPORTANT: Supabase has a hard limit of 1000 records per query.
    This function automatically paginates to fetch ALL records.
    
    Args:
        username: Username for RLS filtering
        limit: Maximum number of records to return (if specified, uses single fetch)
        offset: Number of records to skip (only used when limit is specified)
    
    Returns:
        List of invoice dictionaries
    """
    try:
        db = get_database_client()
        
        # If a specific limit is requested, use simple pagination
        if limit is not None:
            query = db.query('invoices').eq('username', username).order('created_at', desc=True)
            query = query.limit(limit).offset(offset)
            result = query.execute()
            return result.data if result.data else []
        
        # Otherwise, fetch ALL records using pagination (for sync operations)
        all_records = []
        batch_size = 1000  # Supabase's maximum per request
        current_offset = 0
        
        logger.info(f"Fetching all invoice records for {username} (paginated)")
        
        while True:
            query = db.query('invoices').eq('username', username).order('created_at', desc=True)
            query = query.limit(batch_size).offset(current_offset)
            result = query.execute()
            
            if not result.data or len(result.data) == 0:
                break
            
            all_records.extend(result.data)
            logger.info(f"  Fetched batch {current_offset // batch_size + 1}: {len(result.data)} records (total so far: {len(all_records)})")
            
            # If we got less than batch_size records, we've reached the end
            if len(result.data) < batch_size:
                break
            
            current_offset += batch_size
        
        logger.info(f"✅ Fetched {len(all_records)} total invoice records for {username}")
        return all_records
    
    except Exception as e:
        logger.error(f"Error getting invoices for {username}: {e}")
        return []


def get_all_inventory(username: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Get inventory items for a user.
    
    IMPORTANT: Supabase has a hard limit of 1000 records per query.
    
    Args:
        username: Username for RLS filtering
        limit: If specified, return only this many most recent records (single query, fast).
               If None, fetch ALL records using pagination (slower, but gets everything).
    
    Returns:
        List of inventory item dictionaries
    """
    try:
        db = get_database_client()
        
        # If limit is specified and <= 1000, use simple query (fast path)
        if limit is not None and limit <= 1000:
            logger.info(f"Fetching {limit} most recent inventory items for {username}")
            query = db.query('inventory').eq('username', username).order('upload_date', desc=True)
            query = query.limit(limit)
            result = query.execute()
            logger.info(f"✅ Fetched {len(result.data) if result.data else 0} inventory records")
            return result.data if result.data else []
        
        # Otherwise, fetch ALL records using pagination (for searches/filters)
        all_records = []
        batch_size = 1000  # Supabase's maximum per request
        current_offset = 0
        
        logger.info(f"Fetching ALL inventory records for {username} (paginated, for filtering)")
        
        while True:
            query = db.query('inventory').eq('username', username).order('upload_date', desc=True)
            query = query.limit(batch_size).offset(current_offset)
            result = query.execute()
            
            if not result.data or len(result.data) == 0:
                break
            
            all_records.extend(result.data)
            logger.info(f"  Fetched batch {current_offset // batch_size + 1}: {len(result.data)} records (total so far: {len(all_records)})")
            
            # If we got less than batch_size records, we've reached the end
            if len(result.data) < batch_size:
                break
            
            current_offset += batch_size
        
        logger.info(f"✅ Fetched {len(all_records)} total inventory records for {username}")
        return all_records
    
    except Exception as e:
        logger.error(f"Error getting inventory for {username}: {e}")
        return []


def get_verified_invoices(username: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Get verified invoices for a user, sorted by upload_date descending.
    
    IMPORTANT: Supabase has a hard limit of 1000 records per query.
    
    Args:
        username: Username for RLS filtering
        limit: If specified, return only this many most recent records (single query, fast).
               If None, fetch ALL records using pagination (slower, but gets everything).
    
    Returns:
        List of verified invoice dictionaries
    """
    try:
        db = get_database_client()
        
        # If limit is specified and <= 1000, use simple query (fast path)
        if limit is not None and limit <= 1000:
            logger.info(f"Fetching {limit} most recent verified invoices for {username}")
            query = db.query('verified_invoices').eq('username', username).order('upload_date', desc=True)
            query = query.limit(limit)
            result = query.execute()
            logger.info(f"✅ Fetched {len(result.data) if result.data else 0} verified invoice records")
            return result.data if result.data else []
        
        # Otherwise, fetch ALL records using pagination (for searches/filters)
        all_records = []
        batch_size = 1000  # Supabase's maximum per request
        current_offset = 0
        
        logger.info(f"Fetching ALL verified invoice records for {username} (paginated, for filtering)")
        
        while True:
            query = db.query('verified_invoices').eq('username', username).order('upload_date', desc=True)
            query = query.limit(batch_size).offset(current_offset)
            result = query.execute()
            
            if not result.data or len(result.data) == 0:
                break
            
            all_records.extend(result.data)
            logger.info(f"  Fetched batch {current_offset // batch_size + 1}: {len(result.data)} records (total so far: {len(all_records)})")
            
            # If we got less than batch_size records, we've reached the end
            if len(result.data) < batch_size:
                break
            
            current_offset += batch_size
        
        logger.info(f"✅ Fetched {len(all_records)} total verified invoice records for {username}")
        return all_records
    
    except Exception as e:
        logger.error(f"Error getting verified invoices for {username}: {e}")
        return []




def get_verification_dates(username: str) -> List[Dict[str, Any]]:
    """
    Get all date verification records for a user.
    
    Args:
        username: Username for RLS filtering
    
    Returns:
        List of verification date dictionaries
    """
    try:
        db = get_database_client()
        result = db.query('verification_dates').eq('username', username).order('created_at', desc=True).execute()
        return result.data if result.data else []
    
    except Exception as e:
        logger.error(f"Error getting verification dates for {username}: {e}")
        return []


def get_verification_amounts(username: str) -> List[Dict[str, Any]]:
    """
    Get all amount verification records for a user.
    
    Args:
        username: Username for RLS filtering
    
    Returns:
        List of verification amount dictionaries
    """
    try:
        db = get_database_client()
        result = db.query('verification_amounts').eq('username', username).order('created_at', desc=True).execute()
        return result.data if result.data else []
    
    except Exception as e:
        logger.error(f"Error getting verification amounts for {username}: {e}")
        return []


def update_verified_invoices(username: str, data: List[Dict[str, Any]]) -> bool:
    """
    Update verified invoices using upsert (preserves existing records).
    
    Args:
        username: Username for RLS filtering
        data: List of invoice dictionaries to save
    
    Returns:
        True if successful, False otherwise
    """
    try:
        db = get_database_client()
        
        # Prepare records for batch upsert
        records = []
        for record in data:
            record['username'] = username  # Ensure username is set
            # CRITICAL: Clean empty date strings (Supabase rejects empty strings for date columns)
            if 'date' in record and (record['date'] == '' or pd.isna(record['date'])):
                record['date'] = None
            record = convert_numeric_types(record)
            records.append(record)
        
        # OPTIMIZED: Use batch upsert with row_id as conflict resolution
        # This allows updating existing records instead of throwing duplicate key errors
        count = db.batch_upsert('verified_invoices', records, batch_size=500, on_conflict='row_id')
        logger.info(f"✅ Upserted {count} verified invoices for {username} (preserving existing data)")
        return True
    
    except Exception as e:
        logger.error(f"Error upserting verified invoices for {username}: {e}")
        return False


def delete_records_by_receipt(username: str, receipt_number: str, table: str = 'verification_dates') -> bool:
    """
    Delete records by receipt number from a specific table.
    
    Args:
        username: Username for RLS filtering
        receipt_number: Receipt number to delete
        table: Table name ('verification_dates' or 'verification_amounts')
    
    Returns:
        True if successful, False otherwise
    """
    try:
        db = get_database_client()
        db.delete(table, {'username': username, 'receipt_number': receipt_number})
        logger.info(f"Deleted records for receipt {receipt_number} from {table}")
        return True
    
    except Exception as e:
        logger.error(f"Error deleting records from {table}: {e}")
        return False


def update_verification_records(username: str, table: str, data: List[Dict[str, Any]]) -> bool:
    """
    Update verification records (replace all for user).
    
    NOTE: This uses delete-all-then-insert pattern intentionally!
    Verification tables need to remove "Done" records after Sync & Finish.
    The caller (verification.py) filters the data to only include records that should remain.
    
    Args:
        username: Username for RLS filtering
        table: Table name ('verification_dates' or 'verification_amounts')
        data: List of record dictionaries (already filtered to keep only Pending/Duplicate)
    
    Returns:
        True if successful, False otherwise
    """
    try:
        db = get_database_client()
        
        # Delete existing records for this user (removes "Done" records)
        db.delete(table, {'username': username})
        
        # Insert filtered records (only Pending/Duplicate)
        for record in data:
            record['username'] = username  # Ensure username is set
            record = convert_numeric_types(record)
            db.insert(table, record)
        
        logger.info(f"Updated {len(data)} records in {table} for {username} (removed Done records)")
        return True
    
    except Exception as e:
        logger.error(f"Error updating {table} for {username}: {e}")
        return False
