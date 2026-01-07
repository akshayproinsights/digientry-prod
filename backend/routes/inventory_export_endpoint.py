"""
Export endpoint for inventory items
Add this to backend/routes/inventory.py
"""

@router.get("/export")
async def export_inventory_to_excel(
    search: Optional[str] = None,
    invoice_number: Optional[str] = None,
    part_number: Optional[str] = None,
    description: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Export filtered inventory items to Excel
    Includes ALL columns up to amount_mismatch from the database
    """
    from database import get_database_client
    import pandas as pd
    from io import BytesIO
    from fastapi.responses import StreamingResponse
    
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Build query with all columns
        query = db.client.table("inventory_items").select("*").eq("username", username)
        
        # Apply filters
        if invoice_number:
            query = query.ilike("invoice_number", f"%{invoice_number}%")
        
        if part_number:
            query = query.ilike("part_number", f"%{part_number}%")
        
        if description:
            query = query.ilike("description", f"%{description}%")
        
        if date_from:
            query = query.gte("invoice_date", date_from)
        
        if date_to:
            query = query.lte("invoice_date", date_to)
        
        # Order by upload_date descending
        query = query.order("upload_date", desc=True)
        
        response = query.execute()
        items = response.data or []
        
        # Apply status filter (post-query since it's computed)
        if status:
            items = [
                item for item in items
                if (item.get('amount_mismatch', 0) == 0 and status == 'Done') or
                   (item.get('amount_mismatch', 0) != 0 and item.get('verification_status', 'Pending') == status)
            ]
        
        # Apply general search filter (post-query)
        if search:
            search_lower = search.lower()
            items = [
                item for item in items
                if any(str(val).lower().find(search_lower) != -1 for val in item.values() if val is not None)
            ]
        
        if not items:
            # Return empty Excel file
            df = pd.DataFrame()
        else:
            # Select columns up to and including amount_mismatch
            columns_to_export = [
                'id',
                'invoice_date',
                'invoice_number',
                'part_number',
                'batch',
                'description',
                'hsn',
                'qty',
                'rate',
                'disc_percent',
                'taxable_amount',
                'cgst_percent',
                'sgst_percent',
                'discounted_price',
                'taxed_amount',
                'net_bill',
                'amount_mismatch',
                'verification_status',
                'upload_date',
                'receipt_link',
            ]
            
            # Filter to only existing columns
            available_columns = [col for col in columns_to_export if col in items[0]]
            
            # Create DataFrame
            df = pd.DataFrame(items)[available_columns]
            
            # Rename columns for better readability
            column_names = {
                'id': 'ID',
                'invoice_date': 'Invoice Date',
                'invoice_number': 'Invoice Number',
                'part_number': 'Part Number',
                'batch': 'Batch',
                'description': 'Description',
                'hsn': 'HSN',
                'qty': 'Quantity',
                'rate': 'Rate',
                'disc_percent': 'Discount %',
                'taxable_amount': 'Taxable Amount',
                'cgst_percent': 'CGST %',
                'sgst_percent': 'SGST %',
                'discounted_price': 'Discounted Price',
                'taxed_amount': 'Taxed Amount',
                'net_bill': 'Net Bill',
                'amount_mismatch': 'Amount Mismatch',
                'verification_status': 'Verification Status',
                'upload_date': 'Upload Date',
                'receipt_link': 'Receipt Link',
            }
            df.rename(columns=column_names, inplace=True)
        
        # Create Excel file in memory
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Inventory')
            
            # Auto-adjust column widths
            worksheet = writer.sheets['Inventory']
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
        
        output.seek(0)
        
        # Return as streaming response
        filename = f"inventory_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        logger.error(f"Error exporting inventory to Excel: {e}")
        raise HTTPException(status_code=500, detail=str(e))
