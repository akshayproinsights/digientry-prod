"""
Dashboard Metrics API Routes
Provides aggregated data for custom dashboard visualizations.
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from pydantic import BaseModel
import logging

from database import get_database_client
from auth import get_current_user
from config_loader import get_user_config

router = APIRouter()
logger = logging.getLogger(__name__)


class RevenueSummary(BaseModel):
    """Revenue summary response"""
    total_revenue: float
    part_revenue: float
    labour_revenue: float
    total_transactions: int
    date_from: str
    date_to: str


class StockSummary(BaseModel):
    """Stock summary response"""
    total_stock_value: float
    low_stock_count: int
    out_of_stock_count: int
    below_reorder_count: int
    total_items: int


class DailyRevenue(BaseModel):
    """Daily revenue data point"""
    date: str
    total_amount: float
    part_amount: float
    labour_amount: float


class StockAlert(BaseModel):
    """Stock alert item"""
    part_number: str
    item_name: str
    current_stock: float
    reorder_point: float
    stock_value: float
    status: str
    priority: Optional[str] = None


class KPICard(BaseModel):
    """KPI card with comparison"""
    current_value: float
    previous_value: float
    change_percent: float
    label: str
    format_type: str  # 'currency', 'number', 'count'


class DailySalesVolume(BaseModel):
    """Daily sales with revenue and volume"""
    date: str
    revenue: int  # Total revenue as integer
    parts_revenue: int  # Spares revenue as integer
    labor_revenue: int  # Service revenue as integer
    volume: int  # count of receipts


class InventoryByPriority(BaseModel):
    """Inventory stats by priority"""
    priority: str
    total_items: int
    critical_items: int  # currentStock < 20% of reorder
    low_items: int  # currentStock < 50% of reorder
    healthy_items: int  # currentStock >= 50% of reorder
    critical_percentage: float
    low_percentage: float
    healthy_percentage: float



class DashboardKPIs(BaseModel):
    """All dashboard KPIs"""
    total_revenue: KPICard
    avg_job_value: KPICard
    inventory_alerts: KPICard
    pending_actions: KPICard


class UpdateStockRequest(BaseModel):
    """Request model for updating stock"""
    part_number: str
    new_stock: int




def get_date_range(date_from: Optional[str], date_to: Optional[str], default_days: int = 30):
    """
    Get normalized date range with defaults.
    Returns tuple of (date_from_str, date_to_str)
    """
    if not date_to:
        date_to_obj = datetime.now()
    else:
        try:
            date_to_obj = datetime.strptime(date_to, "%Y-%m-%d")
        except:
            date_to_obj = datetime.now()
    
    if not date_from:
        date_from_obj = date_to_obj - timedelta(days=default_days)
    else:
        try:
            date_from_obj = datetime.strptime(date_from, "%Y-%m-%d")
        except:
            date_from_obj = date_to_obj - timedelta(days=default_days)
    
    return date_from_obj.strftime("%Y-%m-%d"), date_to_obj.strftime("%Y-%m-%d")


@router.get("/revenue-summary", response_model=RevenueSummary)
async def get_revenue_summary(
    date_from: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get revenue summary with part/labour breakdown for date range.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Load user config for column mappings
        config = get_user_config(username)
        if not config or "dashboard_visuals" not in config:
            raise HTTPException(status_code=400, detail="Dashboard configuration not found")
        
        revenue_config = config["dashboard_visuals"].get("revenue_metrics", {})
        if not revenue_config.get("enabled"):
            raise HTTPException(status_code=400, detail="Revenue metrics not enabled")
        
        # Get column names from config
        date_col = revenue_config.get("date_column", "date")
        amount_col = revenue_config.get("amount_column", "amount")
        type_col = revenue_config.get("type_column", "type")
        data_source = revenue_config.get("data_source", "verified_invoices")
        
        # Get date range
        default_days = revenue_config.get("filters", {}).get("default_days", 30)
        date_from_str, date_to_str = get_date_range(date_from, date_to, default_days)
        
        # Query database
        query = db.client.table(data_source).select(f"{amount_col}, {type_col}")
        query = query.eq("username", username)
        query = query.gte(date_col, date_from_str)
        query = query.lte(date_col, date_to_str)
        
        response = query.execute()
        items = response.data or []
        
        # Calculate totals
        total_revenue = 0.0
        part_revenue = 0.0
        labour_revenue = 0.0
        
        for item in items:
            amount = float(item.get(amount_col) or 0)
            item_type = item.get(type_col, "").lower()
            
            total_revenue += amount
            
            if "part" in item_type:
                part_revenue += amount
            elif "labour" in item_type or "labor" in item_type:
                labour_revenue += amount
        
        logger.info(f"Revenue summary for {username}: {len(items)} transactions, ₹{total_revenue:.2f}")
        
        return RevenueSummary(
            total_revenue=round(total_revenue, 2),
            part_revenue=round(part_revenue, 2),
            labour_revenue=round(labour_revenue, 2),
            total_transactions=len(items),
            date_from=date_from_str,
            date_to=date_to_str
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting revenue summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/revenue-trends", response_model=List[DailyRevenue])
async def get_revenue_trends(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get daily revenue trends with part/labour breakdown.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Load user config
        config = get_user_config(username)
        if not config or "dashboard_visuals" not in config:
            raise HTTPException(status_code=400, detail="Dashboard configuration not found")
        
        revenue_config = config["dashboard_visuals"].get("revenue_metrics", {})
        if not revenue_config.get("enabled"):
            raise HTTPException(status_code=400, detail="Revenue metrics not enabled")
        
        # Get column names
        date_col = revenue_config.get("date_column", "date")
        amount_col = revenue_config.get("amount_column", "amount")
        type_col = revenue_config.get("type_column", "type")
        data_source = revenue_config.get("data_source", "verified_invoices")
        
        # Get date range
        default_days = revenue_config.get("filters", {}).get("default_days", 30)
        date_from_str, date_to_str = get_date_range(date_from, date_to, default_days)
        
        # Query database
        query = db.client.table(data_source).select(f"{date_col}, {amount_col}, {type_col}")
        query = query.eq("username", username)
        query = query.gte(date_col, date_from_str)
        query = query.lte(date_col, date_to_str)
        query = query.order(date_col)
        
        response = query.execute()
        items = response.data or []
        
        # Group by date
        daily_data: Dict[str, Dict[str, float]] = {}
        
        for item in items:
            date_value = item.get(date_col)
            if not date_value:
                continue
            
            # Normalize date format (handle both DD-MMM-YYYY and YYYY-MM-DD)
            try:
                # Try parsing as YYYY-MM-DD first
                date_obj = datetime.fromisoformat(date_value.replace('Z', '+00:00').split('T')[0])
                date_key = date_obj.strftime("%Y-%m-%d")
            except:
                # Try other formats
                try:
                    date_obj = datetime.strptime(date_value, "%d-%b-%Y")
                    date_key = date_obj.strftime("%Y-%m-%d")
                except:
                    # Use as-is if parsing fails
                    date_key = str(date_value)[:10]
            
            if date_key not in daily_data:
                daily_data[date_key] = {
                    "total": 0.0,
                    "part": 0.0,
                    "labour": 0.0
                }
            
            amount = float(item.get(amount_col) or 0)
            item_type = item.get(type_col, "").lower()
            
            daily_data[date_key]["total"] += amount
            
            if "part" in item_type:
                daily_data[date_key]["part"] += amount
            elif "labour" in item_type or "labor" in item_type:
                daily_data[date_key]["labour"] += amount
        
        # Convert to list and sort
        trends = [
            DailyRevenue(
                date=date_key,
                total_amount=round(data["total"], 2),
                part_amount=round(data["part"], 2),
                labour_amount=round(data["labour"], 2)
            )
            for date_key, data in sorted(daily_data.items())
        ]
        
        logger.info(f"Revenue trends for {username}: {len(trends)} days")
        
        return trends
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting revenue trends: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stock-summary", response_model=StockSummary)
async def get_stock_summary(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get stock summary statistics.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Load user config
        config = get_user_config(username)
        if not config or "dashboard_visuals" not in config:
            raise HTTPException(status_code=400, detail="Dashboard configuration not found")
        
        stock_config = config["dashboard_visuals"].get("stock_metrics", {})
        if not stock_config.get("enabled"):
            raise HTTPException(status_code=400, detail="Stock metrics not enabled")
        
        # Get column names
        stock_col = stock_config.get("stock_column", "current_stock")
        value_col = stock_config.get("value_column", "total_value")
        reorder_col = stock_config.get("reorder_column", "reorder_point")
        data_source = stock_config.get("data_source", "stock_levels")
        
        # Query database
        response = db.client.table(data_source)\
            .select(f"{stock_col}, {value_col}, {reorder_col}")\
            .eq("username", username)\
            .execute()
        
        items = response.data or []
        
        # Calculate summary
        total_stock_value = 0.0
        low_stock_count = 0
        out_of_stock_count = 0
        below_reorder_count = 0
        
        for item in items:
            stock = float(item.get(stock_col) or 0)
            value = float(item.get(value_col) or 0)
            reorder = float(item.get(reorder_col) or 2)
            
            total_stock_value += value
            
            if stock <= 0:
                out_of_stock_count += 1
            elif stock < reorder:
                low_stock_count += 1
            
            if stock < reorder:
                below_reorder_count += 1
        
        logger.info(f"Stock summary for {username}: {len(items)} items, ₹{total_stock_value:.2f}")
        
        return StockSummary(
            total_stock_value=round(total_stock_value, 2),
            low_stock_count=low_stock_count,
            out_of_stock_count=out_of_stock_count,
            below_reorder_count=below_reorder_count,
            total_items=len(items)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting stock summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stock-alerts", response_model=List[StockAlert])
async def get_stock_alerts(
    limit: int = Query(10, ge=1, le=50, description="Maximum number of alerts to return"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get items below reorder point, sorted by urgency (lowest stock first).
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Load user config
        config = get_user_config(username)
        if not config or "dashboard_visuals" not in config:
            raise HTTPException(status_code=400, detail="Dashboard configuration not found")
        
        stock_config = config["dashboard_visuals"].get("stock_metrics", {})
        if not stock_config.get("enabled"):
            raise HTTPException(status_code=400, detail="Stock metrics not enabled")
        
        # Get column names
        stock_col = stock_config.get("stock_column", "current_stock")
        value_col = stock_config.get("value_column", "total_value")
        reorder_col = stock_config.get("reorder_column", "reorder_point")
        item_col = stock_config.get("item_column", "internal_item_name")
        part_col = stock_config.get("part_number_column", "part_number")
        data_source = stock_config.get("data_source", "stock_levels")
        
        # Query database - get all items
        response = db.client.table(data_source)\
            .select(f"{part_col}, {item_col}, {stock_col}, {value_col}, {reorder_col}")\
            .eq("username", username)\
            .execute()
        
        items = response.data or []
        
        # Filter items below reorder point and sort by stock level (ascending)
        alerts = []
        for item in items:
            stock = float(item.get(stock_col) or 0)
            reorder = float(item.get(reorder_col) or 2)
            
            if stock < reorder:
                # Determine status
                if stock <= 0:
                    status = "Out of Stock"
                else:
                    status = "Low Stock"
                
                alerts.append(StockAlert(
                    part_number=item.get(part_col) or "N/A",
                    item_name=item.get(item_col) or "Unknown Item",
                    current_stock=round(stock, 2),
                    reorder_point=round(reorder, 2),
                    stock_value=round(float(item.get(value_col) or 0), 2),
                    status=status
                ))
        
        # Sort by current stock (lowest first = most urgent)
        alerts.sort(key=lambda x: x.current_stock)
        
        # Limit results
        alerts = alerts[:limit]
        
        logger.info(f"Stock alerts for {username}: {len(alerts)} items below reorder point")
        
        return alerts
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting stock alerts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kpis", response_model=DashboardKPIs)
async def get_dashboard_kpis(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    customer_name: Optional[str] = Query(None, description="Filter by customer name"),
    vehicle_number: Optional[str] = Query(None, description="Filter by vehicle number"),
    part_number: Optional[str] = Query(None, description="Filter by part number"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get all KPIs with period-over-period comparison.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        config = get_user_config(username)
        if not config or "dashboard_visuals" not in config:
            raise HTTPException(status_code=400, detail="Dashboard configuration not found")
        
        revenue_config = config["dashboard_visuals"].get("revenue_metrics", {})
        stock_config = config["dashboard_visuals"].get("stock_metrics", {})
        
        # Get date ranges for current and previous periods
        default_days = revenue_config.get("filters", {}).get("default_days", 30)
        current_from, current_to = get_date_range(date_from, date_to, default_days)
        
        logger.info(f"KPI date range for {username}: {current_from} to {current_to}")
        
        current_from_dt = datetime.strptime(current_from, "%Y-%m-%d")
        current_to_dt = datetime.strptime(current_to, "%Y-%m-%d")
        period_length = (current_to_dt - current_from_dt).days
        
        prev_from_dt = current_from_dt - timedelta(days=period_length + 1)
        prev_to_dt = current_from_dt - timedelta(days=1)
        prev_from = prev_from_dt.strftime("%Y-%m-%d")
        prev_to = prev_to_dt.strftime("%Y-%m-%d")
        
        # --- Total Revenue KPI ---
        date_col = revenue_config.get("date_column", "date")
        amount_col = revenue_config.get("amount_column", "amount")
        receipt_col = revenue_config.get("receipt_column", "receipt_number")
        data_source = revenue_config.get("data_source", "verified_invoices")
        
        logger.info(f"KPI query config: table={data_source}, date_col={date_col}, amount_col={amount_col}, receipt_col={receipt_col}")
        
        # Current period
        curr_query = db.client.table(data_source).select(f"{amount_col}, {receipt_col}")
        curr_query = curr_query.eq("username", username)
        curr_query = curr_query.gte(date_col, current_from)
        curr_query = curr_query.lte(date_col, current_to)
        
        # Apply optional filters
        if customer_name:
            curr_query = curr_query.ilike("customer_name", f"%{customer_name}%")
        if vehicle_number:
            curr_query = curr_query.ilike("car_number", f"%{vehicle_number}%")
        if part_number:
            curr_query = curr_query.ilike("description", f"%{part_number}%")
        
        curr_items = (curr_query.execute()).data or []
        
        logger.info(f"KPI current period: Found {len(curr_items)} line items")
        
        current_revenue = sum(float(item.get(amount_col) or 0) for item in curr_items)
        current_receipts = len(set(item.get(receipt_col) for item in curr_items if item.get(receipt_col)))
        
        logger.info(f"KPI current calculations: revenue={current_revenue}, unique_receipts={current_receipts}")
        
        # Previous period
        prev_query = db.client.table(data_source).select(f"{amount_col}, {receipt_col}")
        prev_query = prev_query.eq("username", username)
        prev_query = prev_query.gte(date_col, prev_from)
        prev_query = prev_query.lte(date_col, prev_to)
        
        # Apply same filters to previous period for fair comparison
        if customer_name:
            prev_query = prev_query.ilike("customer_name", f"%{customer_name}%")
        if vehicle_number:
            prev_query = prev_query.ilike("car_number", f"%{vehicle_number}%")
        if part_number:
            prev_query = prev_query.ilike("description", f"%{part_number}%")
        
        prev_items = (prev_query.execute()).data or []
        
        prev_revenue = sum(float(item.get(amount_col) or 0) for item in prev_items)
        prev_receipts = len(set(item.get(receipt_col) for item in prev_items if item.get(receipt_col)))
        
        revenue_change = ((current_revenue - prev_revenue) / prev_revenue * 100) if prev_revenue > 0 else 0
        
        # --- Avg Job Value KPI ---
        current_avg = current_revenue / current_receipts if current_receipts > 0 else 0
        prev_avg = prev_revenue / prev_receipts if prev_receipts > 0 else 0
        avg_change = ((current_avg - prev_avg) / prev_avg * 100) if prev_avg > 0 else 0
        
        logger.info(f"KPI final: total_revenue={current_revenue}, avg_job_value={current_avg}")
        
        # --- Inventory Alerts KPI ---
        stock_col = stock_config.get("stock_column", "current_stock")
        reorder_col = stock_config.get("reorder_column", "reorder_point")
        stock_source = stock_config.get("data_source", "stock_levels")
        
        stock_resp = db.client.table(stock_source)\
            .select(f"{stock_col}, {reorder_col}")\
            .eq("username", username)\
            .execute()
        
        stock_items = stock_resp.data or []
        current_alerts = sum(1 for item in stock_items 
                           if float(item.get(stock_col) or 0) < float(item.get(reorder_col) or 2))
        
        # For previous period, we don't have historical data, so use same value
        prev_alerts = current_alerts
        alerts_change = 0
        
        # --- Pending Actions KPI ---
        # TODO: Implement proper pending tasks tracking
        # For now, return 0 as we don't have a tasks/pending table
        current_pending = 0
        prev_pending = 0
        pending_change = 0
        
        return DashboardKPIs(
            total_revenue=KPICard(
                current_value=round(current_revenue, 2),
                previous_value=round(prev_revenue, 2),
                change_percent=round(revenue_change, 1),
                label="Total Revenue",
                format_type="currency"
            ),
            avg_job_value=KPICard(
                current_value=round(current_avg, 2),
                previous_value=round(prev_avg, 2),
                change_percent=round(avg_change, 1),
                label="Avg. Job Value",
                format_type="currency"
            ),
            inventory_alerts=KPICard(
                current_value=float(current_alerts),
                previous_value=float(prev_alerts),
                change_percent=round(alerts_change, 1),
                label="Inventory Alerts",
                format_type="count"
            ),
            pending_actions=KPICard(
                current_value=float(current_pending),
                previous_value=float(prev_pending),
                change_percent=round(pending_change, 1),
                label="Pending Actions",
                format_type="count"
            )
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting dashboard KPIs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/daily-sales-volume", response_model=List[DailySalesVolume])
async def get_daily_sales_volume(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    customer_name: Optional[str] = Query(None, description="Filter by customer name"),
    vehicle_number: Optional[str] = Query(None, description="Filter by vehicle number"),
    part_number: Optional[str] = Query(None, description="Filter by part number"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get daily sales revenue and transaction volume with parts/labor breakdown.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        config = get_user_config(username)
        if not config or "dashboard_visuals" not in config:
            raise HTTPException(status_code=400, detail="Dashboard configuration not found")
        
        revenue_config = config["dashboard_visuals"].get("revenue_metrics", {})
        date_col = revenue_config.get("date_column", "date")
        amount_col = revenue_config.get("amount_column", "amount")
        receipt_col = revenue_config.get("receipt_column", "receipt_number")
        type_col = revenue_config.get("type_column", "type")  # NEW: Get type column
        data_source = revenue_config.get("data_source", "verified_invoices")
        
        default_days = revenue_config.get("filters", {}).get("default_days", 30)
        date_from_str, date_to_str = get_date_range(date_from, date_to, default_days)
        
        # Query with type column to enable parts/labor breakdown
        query = db.client.table(data_source).select(f"{date_col}, {amount_col}, {receipt_col}, {type_col}")
        query = query.eq("username", username)
        query = query.gte(date_col, date_from_str)
        query = query.lte(date_col, date_to_str)
        
        # Apply optional filters
        if customer_name:
            query = query.ilike("customer_name", f"%{customer_name}%")
        if vehicle_number:
            query = query.ilike("car_number", f"%{vehicle_number}%")
        if part_number:
            query = query.ilike("description", f"%{part_number}%")
        
        query = query.order(date_col)
        
        items = (query.execute()).data or []
        
        # Group by date with parts/labor breakdown
        daily_data: Dict[str, Dict[str, Any]] = {}
        
        for item in items:
            date_value = item.get(date_col)
            if not date_value:
                continue
            
            # Normalize date
            try:
                date_obj = datetime.fromisoformat(date_value.replace('Z', '+00:00').split('T')[0])
                date_key = date_obj.strftime("%Y-%m-%d")
            except:
                try:
                    date_obj = datetime.strptime(date_value, "%d-%b-%Y")
                    date_key = date_obj.strftime("%Y-%m-%d")
                except:
                    date_key = str(date_value)[:10]
            
            if date_key not in daily_data:
                daily_data[date_key] = {
                    "revenue": 0.0,
                    "parts_revenue": 0.0,
                    "labor_revenue": 0.0,
                    "receipts": set()
                }
            
            amount = float(item.get(amount_col) or 0)
            item_type = item.get(type_col, "").lower()
            
            daily_data[date_key]["revenue"] += amount
            
            # Split by type
            if "part" in item_type:
                daily_data[date_key]["parts_revenue"] += amount
            elif "labour" in item_type or "labor" in item_type:
                daily_data[date_key]["labor_revenue"] += amount
            
            receipt = item.get(receipt_col)
            if receipt:
                daily_data[date_key]["receipts"].add(receipt)
        
        # Convert to list with integer values
        result = [
            DailySalesVolume(
                date=date_key,
                revenue=int(round(data["revenue"])),  # Integer, no decimals
                parts_revenue=int(round(data["parts_revenue"])),  # Integer, no decimals
                labor_revenue=int(round(data["labor_revenue"])),  # Integer, no decimals
                volume=len(data["receipts"])
            )
            for date_key, data in sorted(daily_data.items())
        ]
        
        logger.info(f"Daily sales volume for {username}: {len(result)} days")
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting daily sales volume: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/inventory-by-priority")
async def get_inventory_by_priority(
    priority: Optional[str] = Query(None, description="P1, P2, P3, or All"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get inventory statistics filtered by priority.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        config = get_user_config(username)
        if not config or "dashboard_visuals" not in config:
            raise HTTPException(status_code=400, detail="Dashboard configuration not found")
        
        stock_config = config["dashboard_visuals"].get("stock_metrics", {})
        stock_col = stock_config.get("stock_column", "current_stock")
        reorder_col = stock_config.get("reorder_column", "reorder_point")
        data_source = stock_config.get("data_source", "stock_levels")
        
        # Get all stock items with priority and value
        value_col = stock_config.get("value_column", "total_value")
        query = db.client.table(data_source)\
            .select(f"part_number, internal_item_name, {stock_col}, old_stock, {reorder_col}, {value_col}, priority, unit_value")\
            .eq("username", username)
        
        # Filter by priority if specified
        if priority and priority != "All":
            query = query.eq("priority", priority)
        
        items = (query.execute()).data or []
        
        
        # Calculate stats and categorize items
        total_items = len(items)
        missing_purchase_count = 0  # NEW: Negative stock
        out_of_stock_count = 0      # Zero stock
        low_stock_count = 0
        healthy_count = 0
        
        missing_purchase_list = []  # NEW
        out_of_stock_list = []
        low_stock_list = []
        healthy_list = []  # NEW: Include healthy items too
        
        for item in items:
            current_stock = float(item.get(stock_col) or 0)
            old_stock = float(item.get("old_stock") or 0)
            stock_on_hand = current_stock + old_stock  # Total stock on hand
            reorder = float(item.get(reorder_col) or 0)
            stock_value = float(item.get(value_col) or 0)
            
            item_data = {
                "part_number": item.get("part_number") or "N/A",
                "item_name": item.get("internal_item_name") or "Unknown Item",
                "current_stock": round(stock_on_hand, 2),  # Stock on hand (current + old)
                "reorder_point": round(reorder, 2),
                "stock_value": round(stock_value, 2),
                "priority": item.get("priority"),
                "unit_value": item.get("unit_value")  # Last buy price
            }
            
            # Categorize based on stock_on_hand into 4 categories
            if stock_on_hand < 0:
                missing_purchase_count += 1
                missing_purchase_list.append(item_data)
            elif stock_on_hand == 0:
                out_of_stock_count += 1
                out_of_stock_list.append(item_data)
            elif stock_on_hand < reorder:
                low_stock_count += 1
                low_stock_list.append(item_data)
            else:
                healthy_count += 1
                healthy_list.append(item_data)  # Include healthy items
        
        # Sort all lists by stock level (lowest first = most urgent)
        missing_purchase_list.sort(key=lambda x: x["current_stock"])
        out_of_stock_list.sort(key=lambda x: x["current_stock"])
        low_stock_list.sort(key=lambda x: x["current_stock"])
        healthy_list.sort(key=lambda x: x["current_stock"])  # Sort healthy items too
        
        # Combine lists: missing purchase first, then out-of-stock, then low stock, then healthy
        all_items = missing_purchase_list + out_of_stock_list + low_stock_list + healthy_list
        
        # Log what we're returning
        logger.info(f"Inventory for {username} (priority={priority}): total={total_items}, missing_purchase={missing_purchase_count}, out_of_stock={out_of_stock_count}, low={low_stock_count}, healthy={healthy_count}")
        logger.info(f"Returning ALL {len(all_items)} items (no limit)")
        
        # Calculate percentages
        missing_purchase_pct = (missing_purchase_count / total_items * 100) if total_items > 0 else 0
        out_of_stock_pct = (out_of_stock_count / total_items * 100) if total_items > 0 else 0
        low_stock_pct = (low_stock_count / total_items * 100) if total_items > 0 else 0
        healthy_pct = (healthy_count / total_items * 100) if total_items > 0 else 0
        
        return {
            "summary": {
                "priority": priority or "All",
                "total_items": total_items,
                "missing_purchase_items": missing_purchase_count,  # NEW
                "critical_items": out_of_stock_count,  # Now only zero stock
                "low_items": low_stock_count,
                "healthy_items": healthy_count,
                "missing_purchase_percentage": round(missing_purchase_pct, 1),  # NEW
                "critical_percentage": round(out_of_stock_pct, 1),
                "low_percentage": round(low_stock_pct, 1),
                "healthy_percentage": round(healthy_pct, 1)
            },
            "critical_items": all_items  # Return ALL items (no [:20] limit)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting inventory by priority: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inventory-search")
async def search_inventory(
    q: str = Query(..., min_length=1, description="Search query for item name or part number"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of results to return"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Search all inventory items by item name or part number.
    Returns all matching items from the stock register, not limited to top 20 or status.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        config = get_user_config(username)
        if not config or "dashboard_visuals" not in config:
            raise HTTPException(status_code=400, detail="Dashboard configuration not found")
        
        stock_config = config["dashboard_visuals"].get("stock_metrics", {})
        stock_col = stock_config.get("stock_column", "current_stock")
        reorder_col = stock_config.get("reorder_column", "reorder_point")
        data_source = stock_config.get("data_source", "stock_levels")
        value_col = stock_config.get("value_column", "total_value")
        
        # Search query - match on item name OR part number
        query = db.client.table(data_source)\
            .select(f"part_number, internal_item_name, {stock_col}, old_stock, {reorder_col}, {value_col}, priority, unit_value")\
            .eq("username", username)
        
        # Execute query and filter in memory (Supabase doesn't support OR in a simple way)
        response = query.execute()
        all_items = response.data or []
        
        # Filter by search query (case-insensitive)
        search_lower = q.lower()
        matched_items = []
        
        for item in all_items:
            item_name = (item.get("internal_item_name") or "").lower()
            part_number = (item.get("part_number") or "").lower()
            
            if search_lower in item_name or search_lower in part_number:
                current_stock = float(item.get(stock_col) or 0)
                old_stock = float(item.get("old_stock") or 0)
                stock_on_hand = current_stock + old_stock
                reorder = float(item.get(reorder_col) or 0)
                
                matched_items.append({
                    "part_number": item.get("part_number") or "N/A",
                    "item_name": item.get("internal_item_name") or "Unknown Item",
                    "current_stock": round(stock_on_hand, 2),
                    "reorder_point": round(reorder, 2),
                    "stock_value": round(float(item.get(value_col) or 0), 2),
                    "priority": item.get("priority"),
                    "unit_value": item.get("unit_value")  # Last buy price - ADDED
                })
        
        # Sort by stock level (lowest first = most urgent)
        matched_items.sort(key=lambda x: x["current_stock"])
        
        # Limit results
        result_items = matched_items[:limit]
        
        logger.info(f"Inventory search for '{q}' by {username}: {len(result_items)} of {len(matched_items)} matches returned")
        
        return {
            "query": q,
            "total_matches": len(matched_items),
            "returned_count": len(result_items),
            "items": result_items
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching inventory: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/autocomplete/customers")
async def get_customer_suggestions(
    q: str = Query(..., min_length=2, description="Search query (min 2 characters)"),
    limit: int = Query(10, ge=1, le=50, description="Maximum suggestions to return"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get customer name suggestions for autocomplete.
    Returns distinct customer names matching the query.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        config = get_user_config(username)
        revenue_config = config.get("dashboard_visuals", {}).get("revenue_metrics", {})
        data_source = revenue_config.get("data_source", "verified_invoices")
        
        # Query for distinct customer names matching the search
        response = db.client.table(data_source)\
            .select("customer_name")\
            .eq("username", username)\
            .ilike("customer_name", f"%{q}%")\
            .limit(1000)\
            .execute()
        
        items = response.data or []
        
        # Get distinct values and count occurrences
        customer_counts: Dict[str, int] = {}
        for item in items:
            customer = item.get("customer_name")
            if customer and customer.strip():
                customer_counts[customer] = customer_counts.get(customer, 0) + 1
        
        # Sort by frequency (most common first) and limit results
        suggestions = sorted(customer_counts.keys(), key=lambda x: customer_counts[x], reverse=True)[:limit]
        
        logger.info(f"Customer autocomplete for '{q}': {len(suggestions)} suggestions")
        return suggestions
        
    except Exception as e:
        logger.error(f"Error getting customer suggestions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/autocomplete/vehicles")
async def get_vehicle_suggestions(
    q: str = Query(..., min_length=2, description="Search query (min 2 characters)"),
    limit: int = Query(10, ge=1, le=50, description="Maximum suggestions to return"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get vehicle number suggestions for autocomplete.
    Returns distinct vehicle numbers matching the query.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        config = get_user_config(username)
        revenue_config = config.get("dashboard_visuals", {}).get("revenue_metrics", {})
        data_source = revenue_config.get("data_source", "verified_invoices")
        
        # Query for distinct vehicle numbers matching the search
        response = db.client.table(data_source)\
            .select("car_number")\
            .eq("username", username)\
            .ilike("car_number", f"%{q}%")\
            .limit(1000)\
            .execute()
        
        items = response.data or []
        
        # Get distinct values and count occurrences
        vehicle_counts: Dict[str, int] = {}
        for item in items:
            vehicle = item.get("car_number")
            if vehicle and vehicle.strip():
                vehicle_counts[vehicle] = vehicle_counts.get(vehicle, 0) + 1
        
        # Sort by frequency (most common first) and limit results
        suggestions = sorted(vehicle_counts.keys(), key=lambda x: vehicle_counts[x], reverse=True)[:limit]
        
        logger.info(f"Vehicle autocomplete for '{q}': {len(suggestions)} suggestions")
        return suggestions
        
    except Exception as e:
        logger.error(f"Error getting vehicle suggestions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/autocomplete/parts")
async def get_part_suggestions(
    q: str = Query(..., min_length=2, description="Search query (min 2 characters)"),
    limit: int = Query(10, ge=1, le=50, description="Maximum suggestions to return"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get part number suggestions for autocomplete.
    Returns distinct part numbers matching the query.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        config = get_user_config(username)
        revenue_config = config.get("dashboard_visuals", {}).get("revenue_metrics", {})
        data_source = revenue_config.get("data_source", "verified_invoices")
        
        # Query for distinct part descriptions matching the search
        response =db.client.table(data_source)\
            .select("description")\
            .eq("username", username)\
            .ilike("description", f"%{q}%")\
            .limit(1000)\
            .execute()
        
        items = response.data or []
        
        # Get distinct values and count occurrences
        part_counts: Dict[str, int] = {}
        for item in items:
            part = item.get("description")
            if part and part.strip():
                part_counts[part] = part_counts.get(part, 0) + 1
        
        # Sort by frequency (most common first) and limit results
        suggestions = sorted(part_counts.keys(), key=lambda x: part_counts[x], reverse=True)[:limit]
        
        logger.info(f"Part autocomplete for '{q}': {len(suggestions)} suggestions")
        return suggestions
        
    except Exception as e:
        logger.error(f"Error getting part suggestions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/update-stock")
async def update_stock(
    request: UpdateStockRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update stock value for a specific item.
    Returns status_corrected: true if stock went from negative to positive.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Load user config
        config = get_user_config(username)
        if not config or "dashboard_visuals" not in config:
            raise HTTPException(status_code=400, detail="Dashboard configuration not found")
        
        stock_config = config["dashboard_visuals"].get("stock_metrics", {})
        stock_col = stock_config.get("stock_column", "current_stock")
        data_source = stock_config.get("data_source", "stock_levels")
        part_col = stock_config.get("part_number_column", "part_number")
        
        # 1. Fetch current stock to check for negative status
        current_data = db.client.table(data_source)\
            .select(f"{stock_col}")\
            .eq("username", username)\
            .eq(part_col, request.part_number)\
            .single()\
            .execute()
            
        old_stock_val = 0
        if current_data.data:
            old_stock_val = float(current_data.data.get(stock_col) or 0)
            
        # 2. Update stock
        update_data = {stock_col: request.new_stock}
        
        response = db.client.table(data_source)\
            .update(update_data)\
            .eq("username", username)\
            .eq(part_col, request.part_number)\
            .execute()
            
        if not response.data:
            raise HTTPException(status_code=404, detail="Item not found")
            
        # 3. Check for status correction (Negative -> Positive)
        status_corrected = False
        if old_stock_val < 0 and request.new_stock >= 0:
            status_corrected = True
            
        logger.info(f"Stock updated for {request.part_number}: {old_stock_val} -> {request.new_stock}")
            
        return {
            "success": True,
            "part_number": request.part_number,
            "new_stock": request.new_stock,
            "status_corrected": status_corrected,
            "message": "Inventory Log Updated" if status_corrected else "Stock updated successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating stock: {e}")
        raise HTTPException(status_code=500, detail=str(e))

