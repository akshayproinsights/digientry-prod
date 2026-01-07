"""Verified invoices routes"""
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import logging
import pandas as pd
import math

from auth import get_current_user
from database_helpers import get_verified_invoices, update_verified_invoices
from database import get_database_client

router = APIRouter()
logger = logging.getLogger(__name__)


class VerifiedInvoice(BaseModel):
    """Verified invoice model"""
    data: Dict[str, Any]


class SaveVerifiedRequest(BaseModel):
    """Request to save verified records"""
    records: List[Dict[str, Any]]


def sanitize_value(val):
    """Convert non-JSON-compliant values to None"""
    if val is None:
        return None
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return None
    return val


def sanitize_records(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert records to JSON-serializable format"""
    sanitized = []
    for record in records:
        sanitized_record = {}
        for key, val in record.items():
            sanitized_record[key] = sanitize_value(val)
        sanitized.append(sanitized_record)
    return sanitized


@router.get("/")
async def get_verified_invoices_route(
    current_user: Dict[str, Any] = Depends(get_current_user),
    search: Optional[str] = Query(None, description="General search term"),
    date_from: Optional[str] = Query(None, description="Date from (DD-MM-YYYY)"),
    date_to: Optional[str] = Query(None, description="Date to (DD-MM-YYYY)"),
    receipt_number: Optional[str] = Query(None, description="Filter by receipt number"),
    vehicle_number: Optional[str] = Query(None, description="Filter by vehicle/car number"),
    customer_name: Optional[str] = Query(None, description="Filter by customer name"),
    description: Optional[str] = Query(None, description="Filter by description"),
    limit: Optional[int] = Query(None, description="Limit results"),
    offset: Optional[int] = Query(0, description="Offset for pagination")
):
    """
    Get verified invoices with optional filtering
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        # Check if any filters are active
        has_filters = bool(search or date_from or date_to or receipt_number or 
                          vehicle_number or customer_name or description)
        
        # Smart loading strategy:
        # - No filters: Load only 500 most recent (fast)
        # - With filters: Load ALL records to search across entire dataset
        initial_limit = None if has_filters else 500
        
        # Get data from Supabase
        records = get_verified_invoices(username, limit=initial_limit)
        
        if not records:
            return {"records": [], "total": 0}
        
        # Convert to DataFrame for filtering
        df = pd.DataFrame(records)
        
        # Sort by upload_date in descending order if column exists
        if 'upload_date' in df.columns:
            # Parse dates and sort
            df['_sort_date'] = pd.to_datetime(df['upload_date'], errors='coerce')
            df = df.sort_values('_sort_date', ascending=False, na_position='last')
            df = df.drop(columns=['_sort_date'], errors='ignore')
        
        # Apply general search filter
        if search:
            mask = df.apply(lambda row: row.astype(str).str.contains(search, case=False, na=False).any(), axis=1)
            df = df[mask]
        
        # Apply receipt number filter (snake_case for Supabase)
        if receipt_number and 'receipt_number' in df.columns:
            df = df[df['receipt_number'].astype(str).str.contains(receipt_number, case=False, na=False)]
        
        # Apply vehicle number filter
        if vehicle_number:
            vehicle_col = None
            for col in ['car_number', 'vehicle_number']:
                if col in df.columns:
                    vehicle_col = col
                    break
            if vehicle_col:
                df = df[df[vehicle_col].astype(str).str.contains(vehicle_number, case=False, na=False)]
        
        # Apply customer name filter
        if customer_name and 'customer_name' in df.columns:
            df = df[df['customer_name'].astype(str).str.contains(customer_name, case=False, na=False)]
        
        # Apply description filter
        if description and 'description' in df.columns:
            df = df[df['description'].astype(str).str.contains(description, case=False, na=False)]
        
        # Apply date filters
        if (date_from or date_to) and 'date' in df.columns:
            from datetime import datetime
            
            def parse_date(date_str):
                if pd.isna(date_str) or not date_str:
                    return None
                s = str(date_str).strip()
                for fmt in ["%d-%b-%Y", "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"]:
                    try:
                        return datetime.strptime(s, fmt)
                    except:
                        continue
                return None
            
            df['_parsed_date'] = df['date'].apply(parse_date)
            
            if date_from:
                try:
                    from_dt = datetime.strptime(date_from, "%Y-%m-%d")
                    df = df[df['_parsed_date'].apply(lambda x: x is not None and x >= from_dt)]
                except:
                    pass
            
            if date_to:
                try:
                    to_dt = datetime.strptime(date_to, "%Y-%m-%d")
                    df = df[df['_parsed_date'].apply(lambda x: x is not None and x <= to_dt)]
                except:
                    pass
            
            df = df.drop(columns=['_parsed_date'], errors='ignore')
        
        total = len(df)
        
        # Apply pagination
        if limit:
            df = df.iloc[offset:offset+limit]
        
        filtered_records = df.to_dict('records')
        sanitized = sanitize_records(filtered_records)
        
        return {
            "records": sanitized,
            "total": total
        }
    
    except Exception as e:
        logger.error(f"Error reading verified invoices: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read verified invoices: {str(e)}")


@router.post("/save")
async def save_verified_invoices_route(
    request: SaveVerifiedRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Save all verified invoice records (replaces all records for user)
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        # Save to Supabase
        success = update_verified_invoices(username, request.records)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save to database")
        
        logger.info(f"Saved {len(request.records)} verified invoice records for {username}")
        
        return {
            "success": True,
            "message": f"Saved {len(request.records)} records successfully"
        }
    
    except Exception as e:
        logger.error(f"Error saving verified invoices: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save verified invoices: {str(e)}")


@router.put("/update")
async def update_single_verified_invoice(
    record: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update a single verified invoice record by row_id
    """
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    row_id = record.get('row_id')
    if not row_id:
        raise HTTPException(status_code=400, detail="row_id is required for update")
    
    try:
        db = get_database_client()
        
        # Ensure username is set in the record
        record['username'] = username
        
        # Convert numeric types
        from database_helpers import convert_numeric_types
        record = convert_numeric_types(record)
        
        # Delete the old record
        db.delete('verified_invoices', {'username': username, 'row_id': row_id})
        
        # Insert the updated record
        db.insert('verified_invoices', record)
        
        logger.info(f"Updated verified invoice record {row_id} for {username}")
        
        return {
            "success": True,
            "message": f"Updated record {row_id} successfully"
        }
    
    except Exception as e:
        logger.error(f"Error updating verified invoice: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update verified invoice: {str(e)}")


@router.get("/export")
async def export_verified_invoices(
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    receipt_number: Optional[str] = None,
    vehicle_number: Optional[str] = None,
    customer_name: Optional[str] = None,
    description: Optional[str] = None,
    format: str = Query("excel", description="Export format (excel)"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Export verified invoices to Excel (only frontend columns)
    """
    from io import BytesIO
    from fastapi.responses import StreamingResponse
    from datetime import datetime as dt
    
    username = current_user.get("username")
    
    if not username:
        raise HTTPException(status_code=400, detail="No username in token")
    
    try:
        # Get all records
        records = get_verified_invoices(username)
        
        if not records:
            # Return empty Excel file
            df = pd.DataFrame()
        else:
            # Convert to DataFrame for filtering
            df = pd.DataFrame(records)
            
            # Apply general search filter
            if search:
                mask = df.apply(lambda row: row.astype(str).str.contains(search, case=False, na=False).any(), axis=1)
                df = df[mask]
            
            # Apply receipt number filter
            if receipt_number and 'receipt_number' in df.columns:
                df = df[df['receipt_number'].astype(str).str.contains(receipt_number, case=False, na=False)]
            
            # Apply vehicle number filter
            if vehicle_number:
                vehicle_col = None
                for col in ['car_number', 'vehicle_number']:
                    if col in df.columns:
                        vehicle_col = col
                        break
                if vehicle_col:
                    df = df[df[vehicle_col].astype(str).str.contains(vehicle_number, case=False, na=False)]
            
            # Apply customer name filter
            if customer_name and 'customer_name' in df.columns:
                df = df[df['customer_name'].astype(str).str.contains(customer_name, case=False, na=False)]
            
            # Apply description filter
            if description and 'description' in df.columns:
                df = df[df['description'].astype(str).str.contains(description, case=False, na=False)]
            
            # Apply date filters
            if (date_from or date_to) and 'date' in df.columns:
                def parse_date(date_str):
                    if pd.isna(date_str) or not date_str:
                        return None
                    s = str(date_str).strip()
                    for fmt in ["%d-%b-%Y", "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"]:
                        try:
                            return dt.strptime(s, fmt)
                        except:
                            continue
                    return None
                
                df['_parsed_date'] = df['date'].apply(parse_date)
                
                if date_from:
                    try:
                        from_dt = dt.strptime(date_from, "%Y-%m-%d")
                        df = df[df['_parsed_date'].apply(lambda x: x is not None and x >= from_dt)]
                    except:
                        pass
                
                if date_to:
                    try:
                        to_dt = dt.strptime(date_to, "%Y-%m-%d")
                        df = df[df['_parsed_date'].apply(lambda x: x is not None and x <= to_dt)]
                    except:
                        pass
                
                df = df.drop(columns=['_parsed_date'], errors='ignore')
            
            # Select only frontend-visible columns (in proper order)
            frontend_columns = [
                'receipt_number',
                'date',
                'customer_name',
                'car_number',  # or vehicle_number
                'description',
                'type',
                'quantity',
                'rate',
                'amount',
                'receipt_link',
                'upload_date',
            ]
            
            # Filter to only existing columns
            available_columns = []
            for col in frontend_columns:
                if col in df.columns:
                    available_columns.append(col)
                elif col == 'car_number' and 'vehicle_number' in df.columns:
                    # Handle car_number/vehicle_number alias
                    available_columns.append('vehicle_number')
            
            if available_columns:
                df = df[available_columns]
                
                # Rename columns for Excel export (user-friendly names)
                column_names = {
                    'receipt_number': 'Receipt Number',
                    'date': 'Date',
                    'customer_name': 'Customer Name',
                    'car_number': 'Vehicle Number',
                    'vehicle_number': 'Vehicle Number',
                    'description': 'Description',
                    'type': 'Type',
                    'quantity': 'Quantity',
                    'rate': 'Rate',
                    'amount': 'Amount',
                    'receipt_link': 'Receipt Link',
                    'upload_date': 'Upload Date',
                }
                df.rename(columns=column_names, inplace=True)
        
        # Create Excel file in memory
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Verified Invoices')
            
            # Auto-adjust column widths
            if not df.empty:
                worksheet = writer.sheets['Verified Invoices']
                for column in worksheet.columns:
                    max_length = 0
                    column_letter = column[0].column_letter
                    for cell in column:
                        try:
                            if len(str(cell.value)) > max_length:
                                max_length = len(str(cell.value))
                        except:
                            pass
                    adjusted_width = min(max_length + 2, 50)
                    worksheet.column_dimensions[column_letter].width = adjusted_width
                
                # Convert receipt links to clickable hyperlinks
                from openpyxl.styles import Font, colors
                receipt_link_col = None
                for idx, col in enumerate(worksheet[1], 1):  # Header row
                    if col.value == 'Receipt Link':
                        receipt_link_col = idx
                        break
                
                if receipt_link_col:
                    for row_idx in range(2, worksheet.max_row + 1):  # Skip header
                        cell = worksheet.cell(row=row_idx, column=receipt_link_col)
                        if cell.value and str(cell.value).startswith('http'):
                            cell.hyperlink = cell.value
                            cell.value = 'View Image'
                            cell.font = Font(color=colors.BLUE, underline='single')
        
        output.seek(0)
        
        # Return as streaming response
        filename = f"verified_invoices_export_{dt.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        logger.error(f"Error exporting verified invoices to Excel: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to export verified invoices: {str(e)}")

