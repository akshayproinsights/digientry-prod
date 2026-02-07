"""
Purchase Order Management Routes
Handles draft purchase orders and PO generation with PDF export.
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from fastapi.responses import Response
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import logging
from datetime import datetime, date
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from io import BytesIO
import uuid
import os

from database import get_database_client
from auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

# Pydantic Models
class DraftPOItem(BaseModel):
    """Draft PO item request"""
    part_number: str
    item_name: str
    current_stock: float
    reorder_point: float
    reorder_qty: int
    unit_value: Optional[float] = None
    priority: Optional[str] = "P2"
    supplier_name: Optional[str] = None
    notes: Optional[str] = None

class DraftPOUpdateQty(BaseModel):
    """Update quantity for draft PO item"""
    reorder_qty: int

class ProceedToPORequest(BaseModel):
    """Request to proceed with PO creation"""
    supplier_name: Optional[str] = None
    notes: Optional[str] = None
    delivery_date: Optional[str] = None

class PurchaseOrderResponse(BaseModel):
    """Purchase order response"""
    id: str
    po_number: str
    po_date: str
    supplier_name: Optional[str]
    total_items: int
    total_estimated_cost: float
    status: str
    pdf_file_path: Optional[str]
    created_at: str

def generate_po_number(username: str) -> str:
    """Generate unique PO number for user"""
    today = datetime.now()
    date_prefix = today.strftime("%Y%m%d")
    
    # Get user's initials (first 2 chars of username)
    user_prefix = username[:2].upper()
    
    # Generate format: AB20241125001 (User-Date-Sequence)
    return f"{user_prefix}{date_prefix}001"

def increment_po_number(base_po_number: str, existing_numbers: List[str]) -> str:
    """Increment PO number if it already exists"""
    base_num = int(base_po_number[-3:])  # Last 3 digits
    prefix = base_po_number[:-3]  # Everything except last 3 digits
    
    while f"{prefix}{base_num:03d}" in existing_numbers:
        base_num += 1
    
    return f"{prefix}{base_num:03d}"

@router.get("/draft/items")
async def get_draft_items(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get all items in current user's draft purchase order.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        logger.info(f"🔍 CHECKPOINT 1: Getting draft items for user: {username}")
        
        response = db.client.table("draft_purchase_orders")\
            .select("*")\
            .eq("username", username)\
            .order("added_at", desc=True)\
            .execute()
        
        items = response.data or []
        
        # Calculate totals
        total_items = len(items)
        total_estimated_cost = sum(item.get("estimated_cost", 0) or 0 for item in items)
        
        logger.info(f"🔍 CHECKPOINT 2: Retrieved {total_items} draft PO items for {username}, total cost: ₹{total_estimated_cost}")
        
        return {
            "success": True,
            "items": items,
            "summary": {
                "total_items": total_items,
                "total_estimated_cost": total_estimated_cost
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Error getting draft items: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/draft/items")
async def add_draft_item(
    item: DraftPOItem,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Add or update item in draft purchase order.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        logger.info(f"📝 CHECKPOINT A1: Adding draft item for user {username}: {item.part_number}")
        
        # Validate inputs
        if item.reorder_qty <= 0:
            raise HTTPException(status_code=400, detail="Reorder quantity must be > 0")
        

        
        if item.reorder_point < 0:
            raise HTTPException(status_code=400, detail="Reorder point must be >= 0")
        
        logger.info(f"📝 CHECKPOINT A2: Validation passed for {item.part_number}")
        
        # Handle negative stock (backorders) for DB constraint
        # Clamp to 0 and add note, as DB has draft_po_stock_non_negative check
        save_stock = item.current_stock
        save_notes = item.notes
        
        if save_stock < 0:
            backorder_note = f"[Backorder: {save_stock}]"
            if save_notes:
                save_notes = f"{save_notes} {backorder_note}"
            else:
                save_notes = backorder_note
            save_stock = 0

        # Prepare data for upsert
        draft_data = {
            "username": username,
            "part_number": item.part_number,
            "item_name": item.item_name,
            "current_stock": save_stock,
            "reorder_point": item.reorder_point,
            "reorder_qty": item.reorder_qty,
            "unit_value": item.unit_value,
            "priority": item.priority or "P2",
            "supplier_name": item.supplier_name,
            "notes": save_notes,
            "quantity": item.reorder_qty,  # Populate legacy column to satisfy NotNull constraint
            "added_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        logger.info(f"📝 CHECKPOINT A3: Upserting data: {draft_data}")
        
        # Use upsert to handle add/update
        response = db.client.table("draft_purchase_orders")\
            .upsert(draft_data, on_conflict="username,part_number")\
            .execute()
        
        if not response.data:
            logger.error(f"❌ CHECKPOINT A4: Failed to upsert, no data returned")
            raise HTTPException(status_code=500, detail="Failed to add/update draft item")
        
        logger.info(f"✅ CHECKPOINT A5: Successfully added/updated draft PO item: {item.part_number} (qty: {item.reorder_qty})")
        
        return {
            "success": True,
            "item": response.data[0],
            "message": "Item added to draft PO"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ CHECKPOINT A6: Error adding draft item: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/draft/items/{part_number}/quantity")
async def update_draft_quantity(
    part_number: str,
    update: DraftPOUpdateQty,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update quantity for a draft PO item.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        if update.reorder_qty <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be > 0")
        
        response = db.client.table("draft_purchase_orders")\
            .update({
                "reorder_qty": update.reorder_qty,
                "updated_at": datetime.now().isoformat()
            })\
            .eq("username", username)\
            .eq("part_number", part_number)\
            .execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Draft item not found")
        
        logger.info(f"Updated draft PO quantity: {part_number} -> {update.reorder_qty}")
        
        return {
            "success": True,
            "item": response.data[0],
            "message": "Quantity updated"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating draft quantity: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/draft/items/{part_number}")
async def remove_draft_item(
    part_number: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Remove item from draft purchase order.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        response = db.client.table("draft_purchase_orders")\
            .delete()\
            .eq("username", username)\
            .eq("part_number", part_number)\
            .execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Draft item not found")
        
        logger.info(f"Removed draft PO item: {part_number}")
        
        return {
            "success": True,
            "message": "Item removed from draft"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing draft item: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/draft/clear")
async def clear_draft(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Clear entire draft purchase order.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        response = db.client.table("draft_purchase_orders")\
            .delete()\
            .eq("username", username)\
            .execute()
        
        deleted_count = len(response.data) if response.data else 0
        
        logger.info(f"Cleared {deleted_count} draft PO items for {username}")
        
        return {
            "success": True,
            "message": f"Cleared {deleted_count} items from draft",
            "deleted_count": deleted_count
        }
        
    except Exception as e:
        logger.error(f"Error clearing draft: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/draft/proceed")
async def proceed_to_purchase_order(
    request: ProceedToPORequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Convert draft items to finalized purchase order with PDF generation.
    Clears draft after successful creation.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        logger.info(f"🚀 CHECKPOINT 3: Starting PO creation for user: {username}")
        logger.info(f"🚀 CHECKPOINT 4: Request data - supplier: {request.supplier_name}, notes: {request.notes}")
        
        # 1. Get all draft items
        draft_response = db.client.table("draft_purchase_orders")\
            .select("*")\
            .eq("username", username)\
            .order("added_at")\
            .execute()
        
        draft_items = draft_response.data or []
        logger.info(f"🚀 CHECKPOINT 5: Found {len(draft_items)} draft items")
        
        if not draft_items:
            logger.warning(f"❌ CHECKPOINT 6: No draft items found for user: {username}")
            raise HTTPException(status_code=400, detail="No items in draft to process")
        
        # 2. Generate unique PO number
        base_po_number = generate_po_number(username)
        
        # Check for existing PO numbers to avoid conflicts
        existing_pos = db.client.table("purchase_orders")\
            .select("po_number")\
            .eq("username", username)\
            .like("po_number", f"{base_po_number[:-3]}%")\
            .execute()
        
        existing_numbers = [po.get("po_number") for po in (existing_pos.data or [])]
        po_number = increment_po_number(base_po_number, existing_numbers)
        
        # 3. Calculate totals
        total_items = len(draft_items)
        total_estimated_cost = sum(item.get("estimated_cost", 0) or 0 for item in draft_items)
        
        # 4. Create main PO record
        po_data = {
            "username": username,
            "po_number": po_number,
            "po_date": date.today().isoformat(),
            "supplier_name": request.supplier_name,
            "total_items": total_items,
            "total_estimated_cost": total_estimated_cost,
            "status": "draft",
            "notes": request.notes,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        po_response = db.client.table("purchase_orders")\
            .insert(po_data)\
            .execute()
        
        if not po_response.data:
            raise HTTPException(status_code=500, detail="Failed to create purchase order")
        
        po_record = po_response.data[0]
        po_id = po_record["id"]
        
        # 5. Create PO line items
        po_items_data = []
        for item in draft_items:
            po_items_data.append({
                "po_id": po_id,
                "username": username,  # Required by schema
                "part_number": item.get("part_number"),
                "item_name": item.get("item_name"),
                "current_stock": item.get("current_stock"),
                "reorder_point": item.get("reorder_point"),
                "ordered_qty": item.get("reorder_qty"),
                "quantity": item.get("reorder_qty"),  # Legacy column required by schema
                "unit_value": item.get("unit_value"),
                "priority": item.get("priority"),
                "supplier_part_number": item.get("part_number"),  # Can be different from internal part#
                "notes": item.get("notes")
            })
        
        items_response = db.client.table("purchase_order_items")\
            .insert(po_items_data)\
            .execute()
        
        if not items_response.data:
            raise HTTPException(status_code=500, detail="Failed to create PO line items")
        
        logger.info(f"🚀 CHECKPOINT 10: Generating PDF for PO {po_number}")
        
        # 6. Generate PDF
        pdf_buffer = generate_po_pdf(po_record, draft_items, username)
        
        logger.info(f"🚀 CHECKPOINT 11: PDF generated, size: {len(pdf_buffer.getvalue())} bytes")
        
        # 7. Save PDF (in production, upload to storage service)
        pdf_filename = f"PO_{po_number}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        pdf_path = f"/tmp/{pdf_filename}"  # Temporary path - update for production
        
        with open(pdf_path, "wb") as f:
            f.write(pdf_buffer.getvalue())
        
        logger.info(f"🚀 CHECKPOINT 12: PDF saved to {pdf_path}")
        
        # Update PO record with PDF path
        db.client.table("purchase_orders")\
            .update({"pdf_file_path": pdf_path})\
            .eq("id", po_id)\
            .execute()
        
        # 8. Clear draft items
        clear_response = db.client.table("draft_purchase_orders")\
            .delete()\
            .eq("username", username)\
            .execute()
        
        cleared_count = len(clear_response.data) if clear_response.data else 0
        logger.info(f"🚀 CHECKPOINT 13: Cleared {cleared_count} draft items")
        
        logger.info(f"✅ CHECKPOINT 14: Successfully created PO {po_number} with {total_items} items (₹{total_estimated_cost:,.2f})")
        
        # Return PDF as response for immediate download
        return Response(
            content=pdf_buffer.getvalue(),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename={pdf_filename}",
                "X-PO-Number": po_number,
                "X-PO-ID": str(po_id),
                "X-Total-Items": str(total_items),
                "X-Total-Cost": str(total_estimated_cost)
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error proceeding to PO: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/history")
async def get_purchase_order_history(
    limit: int = Query(50, description="Number of POs to return"),
    offset: int = Query(0, description="Offset for pagination"),
    status_filter: Optional[str] = Query(None, description="Filter by status"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get purchase order history for current user.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        query = db.client.table("purchase_orders")\
            .select("*")\
            .eq("username", username)
        
        if status_filter:
            query = query.eq("status", status_filter)
        
        query = query.order("created_at", desc=True)\
            .limit(limit)\
            .offset(offset)
        
        response = query.execute()
        pos = response.data or []
        
        logger.info(f"Retrieved {len(pos)} purchase orders for {username}")
        
        return {
            "success": True,
            "purchase_orders": pos,
            "count": len(pos)
        }
        
    except Exception as e:
        logger.error(f"Error getting PO history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{po_id}/pdf")
async def download_po_pdf(
    po_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Download PDF for a specific purchase order.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Get PO record
        po_response = db.client.table("purchase_orders")\
            .select("*")\
            .eq("id", po_id)\
            .eq("username", username)\
            .execute()
        
        if not po_response.data:
            raise HTTPException(status_code=404, detail="Purchase order not found")
        
        po_record = po_response.data[0]
        
        # Get PO items
        items_response = db.client.table("purchase_order_items")\
            .select("*")\
            .eq("po_id", po_id)\
            .order("item_name")\
            .execute()
        
        po_items = items_response.data or []
        
        # Generate PDF
        pdf_buffer = generate_po_pdf(po_record, po_items, username)
        
        return Response(
            content=pdf_buffer.getvalue(),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename=PO_{po_record['po_number']}.pdf"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading PO PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def generate_po_pdf(po_record: Dict, items: List[Dict], username: str) -> BytesIO:
    """
    Generate professional purchase order PDF.
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=30,
        leftMargin=30,
        topMargin=40,
        bottomMargin=40
    )
    
    elements = []
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'POTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1f2937'),
        spaceAfter=10,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )
    
    header_style = ParagraphStyle(
        'POHeader',
        parent=styles['Normal'],
        fontSize=12,
        textColor=colors.HexColor('#374151'),
        spaceAfter=6,
        fontName='Helvetica-Bold'
    )
    
    normal_style = ParagraphStyle(
        'PONormal',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor('#374151'),
        spaceAfter=3
    )
    
    # Company Header
    elements.append(Paragraph("<b>PURCHASE ORDER</b>", title_style))
    elements.append(Spacer(1, 0.2*inch))
    
    # PO Details Table
    po_details_data = [
        ['PO Number:', po_record.get('po_number', '')],
        ['Date:', po_record.get('po_date', '')],
        ['Supplier:', po_record.get('supplier_name', 'TBD')],
        ['Prepared by:', username.upper()]
    ]
    
    po_details_table = Table(po_details_data, colWidths=[1.5*inch, 3*inch])
    po_details_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
        ('ALIGN', (1, 0), (1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    
    elements.append(po_details_table)
    elements.append(Spacer(1, 0.3*inch))
    
    # Items table header
    elements.append(Paragraph("<b>ITEMS TO ORDER</b>", header_style))
    elements.append(Spacer(1, 0.1*inch))
    
    # Items table data
    table_data = [
        ['#', 'Part Number', 'Description', 'Current\nStock', 'Reorder\nPoint', 'Order\nQty', 'Unit\nPrice', 'Total\nAmount']
    ]
    
    total_amount = 0
    for idx, item in enumerate(items, 1):
        qty = item.get('reorder_qty') or item.get('ordered_qty', 0)
        unit_price = item.get('unit_value', 0) or 0
        line_total = qty * unit_price
        total_amount += line_total
        
        table_data.append([
            str(idx),
            item.get('part_number', ''),
            item.get('item_name', ''),
            str(item.get('current_stock', 0)),
            str(item.get('reorder_point', 0)),
            str(qty),
            f"₹{unit_price:,.2f}" if unit_price > 0 else '₹--',
            f"₹{line_total:,.2f}" if unit_price > 0 else '₹--'
        ])
    
    # Add total row
    table_data.append([
        '', '', '', '', '', '', 'TOTAL:', f"₹{total_amount:,.2f}"
    ])
    
    # Create items table with proper column widths
    items_table = Table(table_data, colWidths=[
        0.3*inch,  # #
        1.2*inch,  # Part Number
        2.2*inch,  # Description
        0.7*inch,  # Current Stock
        0.7*inch,  # Reorder Point
        0.6*inch,  # Order Qty
        0.8*inch,  # Unit Price
        0.9*inch   # Total Amount
    ])
    
    items_table.setStyle(TableStyle([
        # Header styling
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3b82f6')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('VALIGN', (0, 0), (-1, 0), 'MIDDLE'),
        
        # Data rows styling
        ('BACKGROUND', (0, 1), (-1, -2), colors.white),
        ('TEXTCOLOR', (0, 1), (-1, -2), colors.black),
        ('ALIGN', (0, 1), (0, -2), 'CENTER'),  # # column
        ('ALIGN', (1, 1), (2, -2), 'LEFT'),    # Part & Description
        ('ALIGN', (3, 1), (-1, -2), 'CENTER'), # Numeric columns
        ('FONTNAME', (0, 1), (-1, -2), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -2), 8),
        
        # Total row styling
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#f3f4f6')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, -1), (-1, -1), 10),
        ('ALIGN', (0, -1), (-2, -1), 'RIGHT'),
        ('ALIGN', (-1, -1), (-1, -1), 'CENTER'),
        
        # Grid and padding
        ('GRID', (0, 0), (-1, -1), 1, colors.black),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    
    elements.append(items_table)
    elements.append(Spacer(1, 0.3*inch))
    
    # Notes section
    if po_record.get('notes'):
        elements.append(Paragraph("<b>Notes:</b>", header_style))
        elements.append(Paragraph(po_record['notes'], normal_style))
        elements.append(Spacer(1, 0.2*inch))
    
    # Terms and conditions
    elements.append(Paragraph("<b>Terms &amp; Conditions:</b>", header_style))
    terms = [
        "1. Please confirm delivery dates upon order acceptance",
        "2. Quality as per standard specifications required",
        "3. Invoice to be sent with delivery",
        "4. Payment terms: As per agreement"
    ]
    
    for term in terms:
        elements.append(Paragraph(term, normal_style))
    
    elements.append(Spacer(1, 0.4*inch))
    
    # Signature section
    signature_data = [
        ['Prepared By:', 'Approved By:', 'Supplier Acceptance:'],
        ['', '', ''],
        ['', '', ''],
        [f'Name: {username.title()}', 'Name: _________________', 'Name: _________________'],
        [f'Date: {date.today().strftime("%d/%m/%Y")}', 'Date: _________________', 'Date: _________________']
    ]
    
    signature_table = Table(signature_data, colWidths=[2.5*inch, 2.5*inch, 2.5*inch])
    signature_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 1), (-1, 2), 15),  # Space for signatures
        ('BOTTOMPADDING', (0, 1), (-1, 2), 5),
        ('LINEABOVE', (0, 1), (-1, 1), 1, colors.black),  # Signature lines
    ]))
    
    elements.append(signature_table)
    
    # Build PDF
    doc.build(elements)
    buffer.seek(0)
    
    return buffer

@router.get("/")
async def get_purchase_orders(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get all purchase orders for current user.
    """
    return await get_purchase_order_history(current_user=current_user)

# Quick reorder integration
@router.post("/quick-add/{part_number}")
async def quick_add_to_draft(
    part_number: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Quick add item from stock levels to draft PO with default reorder quantity.
    Used by the "Add to PO" buttons in inventory lists.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        logger.info(f"🛒 CHECKPOINT B1: Quick-adding {part_number} to draft PO for user {username}")
        
        # Get stock level record
        stock_response = db.client.table("stock_levels")\
            .select("*")\
            .eq("username", username)\
            .eq("part_number", part_number)\
            .execute()
        
        if not stock_response.data:
            logger.warning(f"❌ CHECKPOINT B2: Stock item not found: {part_number}")
            raise HTTPException(status_code=404, detail="Stock item not found")
        
        stock_item = stock_response.data[0]
        logger.info(f"🛒 CHECKPOINT B3: Found stock item: {stock_item.get('internal_item_name')}")
        
        # Create draft item from stock data
        draft_item = DraftPOItem(
            part_number=stock_item.get("part_number"),
            item_name=stock_item.get("internal_item_name", "Unknown Item"),
            current_stock=stock_item.get("current_stock", 0),
            reorder_point=stock_item.get("reorder_point", 2),
            reorder_qty=max(1, int(stock_item.get("reorder_point", 2))),  # Default to reorder point
            unit_value=stock_item.get("unit_value"),
            priority=stock_item.get("priority", "P2")
        )
        
        logger.info(f"🛒 CHECKPOINT B4: Created draft item with qty: {draft_item.reorder_qty}")
        
        # Add to draft
        await add_draft_item(draft_item, current_user={"username": username})
        
        return {
            "success": True,
            "item": draft_item,
            "message": "Item added to draft PO"
        }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error quick adding to draft: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/suppliers")
async def get_suppliers(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get unique supplier names from inventory items.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Query distinct vendor names from inventory_items
        # Fetching only vendor_name column to minimize data transfer
        response = db.client.table("inventory_items")\
            .select("vendor_name")\
            .eq("username", username)\
            .execute()
            
        items = response.data or []
        
        # Deduplicate and filter empty/None values
        suppliers = list(set(
            item.get("vendor_name") 
            for item in items 
            if item.get("vendor_name") and str(item.get("vendor_name")).strip() and str(item.get("vendor_name")).lower() != "nan"
        ))
        
        # Sort alphabetically
        suppliers.sort(key=lambda x: x.lower())
        
        return {
            "success": True,
            "suppliers": suppliers
        }
        
    except Exception as e:
        logger.error(f"Error getting suppliers: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        result = await add_draft_item(draft_item, current_user)
        logger.info(f"✅ CHECKPOINT B5: Quick-add completed successfully")
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ CHECKPOINT B6: Error quick-adding to draft: {e}")
        raise HTTPException(status_code=500, detail=str(e))

