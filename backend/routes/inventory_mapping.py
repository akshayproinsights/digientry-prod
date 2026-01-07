"""
Inventory Mapping API endpoints.
Matches customer items from verified_invoices to standardized inventory_items.
"""
import logging
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel
import re
from difflib import SequenceMatcher

from database import get_database_client
from auth import get_current_user
from services.fuzzy_matcher import get_fuzzy_matches

logger = logging.getLogger(__name__)

router = APIRouter()


# Pydantic Models
class ConfirmMappingRequest(BaseModel):
    """Request model for confirming mapping"""
    customer_item: str
    grouped_invoice_ids: List[int]
    mapped_inventory_item_id: int
    mapped_inventory_description: str


class UpdateStatusRequest(BaseModel):
    """Request model for updating mapping status"""
    status: str


# New models for customer item mapping
class CustomerItemMappingRequest(BaseModel):
    """Request model for confirming customer item mapping"""
    customer_item: str
    normalized_description: str
    vendor_item_id: Optional[int] = None
    vendor_description: Optional[str] = None
    vendor_part_number: Optional[str] = None
    priority: int = 0
    variations: Optional[List[str]] = None  # All variation descriptions to map together



class SkipItemRequest(BaseModel):
    """Request model for skipping an item"""
    customer_item: str


def clean_description(text: str) -> str:
    """
    Clean and normalize item descriptions for grouping.
    - Remove extra spaces
    - Title case
    - Remove special characters
    """
    if not text:
        return ""
    
    # Remove extra spaces and commas
    text = re.sub(r'\s+', ' ', text.strip())
    text = re.sub(r',+', ',', text)
    text = text.strip(',').strip()
    
    # Title case
    text = text.title()
    
    return text


def fuzzy_match_score(str1: str, str2: str) -> float:
    """
    Calculate fuzzy matching score between two strings using multiple strategies.
    Returns a score between 0.0 and 1.0
    
    Uses:
    1. SequenceMatcher for overall similarity
    2. Token-based matching (word-level comparison)
    3. Substring matching for partial matches
    """
    if not str1 or not str2:
        return 0.0
    
    # Normalize strings
    s1 = clean_description(str1).lower()
    s2 = clean_description(str2).lower()
    
    # 1. Overall sequence similarity
    sequence_score = SequenceMatcher(None, s1, s2).ratio()
    
    # 2. Token-based matching (compare individual words)
    tokens1 = set(s1.split())
    tokens2 = set(s2.split())
    
    if tokens1 and tokens2:
        # Jaccard similarity (intersection over union)
        intersection = tokens1.intersection(tokens2)
        union = tokens1.union(tokens2)
        token_score = len(intersection) / len(union) if union else 0.0
    else:
        token_score = 0.0
    
    # 3. Substring matching (check if one is contained in the other)
    substring_score = 0.0
    if s1 in s2 or s2 in s1:
        substring_score = 0.8
    
    # Calculate weighted average
    # Give more weight to token matching for automotive parts
    final_score = (
        sequence_score * 0.3 +
        token_score * 0.5 +
        substring_score * 0.2
    )
    
    return final_score


@router.get("/grouped-items")
async def get_grouped_items(
    page: int = Query(1),
    limit: int = Query(20),
    status: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get grouped unique items from verified_invoices table.
    Groups similar items using fuzzy matching.
    
    Query params:
    - page: Page number (default: 1)
    - limit: Items per page (default: 20)
    - status: Filter by status ('Pending' or 'Done')
    """
    username = current_user.get("username")
    offset = (page - 1) * limit
    
    try:
        db = get_database_client()
        
        # First, get all unique descriptions from verified_invoices
        result = db.client.table('verified_invoices')\
            .select('id, description')\
            .eq('username', username)\
            .execute()
        
        if not result.data:
            return {
                'items': [],
                'total': 0,
                'page': page,
                'limit': limit
            }
        
        # Group similar items
        grouped_map: Dict[str, List[Dict]] = {}
        
        for record in result.data:
            desc = record.get('description', '')
            if not desc:
                continue
            
            cleaned = clean_description(desc)
            
            # Check if this description matches any existing group
            matched = False
            for key in grouped_map.keys():
                if fuzzy_match_score(cleaned, key) > 0.85:  # 85% similarity threshold
                    grouped_map[key].append(record)
                    matched = True
                    break
            
            # If no match found, create new group
            if not matched:
                grouped_map[cleaned] = [record]
        
        # Get existing mappings from inventory_mapping table
        mappings_result = db.client.table('inventory_mapping')\
            .select('*')\
            .eq('username', username)\
            .execute()
        
        mappings_dict = {m['customer_item']: m for m in (mappings_result.data or [])}
        
        # Build response items
        items = []
        for customer_item, records in grouped_map.items():
            # Check if mapping exists
            mapping = mappings_dict.get(customer_item)
            
            # Apply status filter if provided
            if status and mapping:
                if mapping.get('status') != status:
                    continue
            elif status == 'Pending' and mapping:
                # Skip items that are already mapped
                continue
            
            # Extract unique descriptions from grouped records
            unique_descriptions = list(set([r['description'] for r in records if r.get('description')]))
            unique_descriptions.sort()  # Sort alphabetically
            
            item_data = {
                'customer_item': customer_item,
                'grouped_count': len(records),
                'grouped_invoice_ids': [r['id'] for r in records],
                'grouped_descriptions': unique_descriptions,  # Add this new field
                'status': mapping.get('status', 'Pending') if mapping else 'Pending',
                'mapped_description': mapping.get('mapped_inventory_description') if mapping else None,
                'mapped_inventory_item_id': mapping.get('mapped_inventory_item_id') if mapping else None,
                'confirmed_at': mapping.get('confirmed_at') if mapping else None,
                'id': mapping.get('id') if mapping else None
            }
            items.append(item_data)
        
        # Sort by grouped_count (descending)
        items.sort(key=lambda x: x['grouped_count'], reverse=True)
        
        # Paginate
        total = len(items)
        paginated_items = items[offset:offset + limit]
        
        return {
            'items': paginated_items,
            'total': total,
            'page': page,
            'limit': limit
        }
        
    except Exception as e:
        logger.error(f"Error getting grouped items: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/suggestions")
async def get_suggestions(
    customer_item: str = Query(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get top 5 inventory item suggestions for a customer item.
    
    Query params:
    - customer_item: The customer item description to match
    """
    username = current_user.get("username")
    
    try:
        # customer_item is already validated by Query(...)
        
        db = get_database_client()
        
        # Get all inventory items
        result = db.client.table('inventory_items')\
            .select('id, description, part_number')\
            .eq('username', username)\
            .execute()
        
        if not result.data:
            return {'suggestions': []}
        
        # Calculate fuzzy match scores for each inventory item
        matches = []
        for item in result.data:
            score = fuzzy_match_score(customer_item, item['description'])
            matches.append({
                'id': item['id'],
                'description': item['description'],
                'part_number': item.get('part_number', 'N/A'),
                'score': score
            })
        
        # Sort by score and get top 5
        matches.sort(key=lambda x: x['score'], reverse=True)
        top_5 = matches[:5]
        
        return {'suggestions': top_5}
        
    except Exception as e:
        logger.error(f"Error getting suggestions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search")
async def search_inventory(
    query: str = Query(...),
    limit: int = Query(10),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Search inventory items by query string.
    
    Query params:
    - query: Search query
    - limit: Max results (default: 10)
    """
    username = current_user.get("username")
    query_lower = query.lower()
    
    try:
        if not query_lower:
            return {'results': []}
        
        db = get_database_client()
        
        # Get all inventory items (we'll filter in Python for case-insensitive search)
        result = db.client.table('inventory_items')\
            .select('id, description, part_number')\
            .eq('username', username)\
            .execute()
        
        if not result.data:
            return {'results': []}
        
        # Filter by query (case-insensitive substring match)
        filtered = [
            {
                'id': item['id'],
                'description': item['description'],
                'part_number': item.get('part_number', 'N/A')
            }
            for item in result.data
            if query_lower in item['description'].lower()
        ]
        
        # Sort alphabetically and limit
        filtered.sort(key=lambda x: x['description'])
        filtered = filtered[:limit]
        
        return {'results': filtered}
        
    except Exception as e:
        logger.error(f"Error searching inventory: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/confirm")
async def confirm_mapping(
    request: ConfirmMappingRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Confirm a mapping between customer item and inventory item.
    
    Request body:
    {
        "customer_item": "Engine Oil",
        "grouped_invoice_ids": [1, 2, 3],
        "mapped_inventory_item_id": 123,
        "mapped_inventory_description": "ENGINE OIL 5W30"
    }
    """
    username = current_user.get("username")
    
    try:
        customer_item = request.customer_item
        grouped_invoice_ids = request.grouped_invoice_ids
        mapped_inventory_item_id = request.mapped_inventory_item_id
        mapped_inventory_description = request.mapped_inventory_description
        
        if not customer_item or not mapped_inventory_item_id:
            raise HTTPException(status_code=400, detail='customer_item and mapped_inventory_item_id are required')
        
        db = get_database_client()
        
        # Check if mapping already exists
        existing = db.client.table('inventory_mapping')\
            .select('*')\
            .eq('customer_item', customer_item)\
            .eq('username', username)\
            .execute()
        
        mapping_data = {
            'username': username,
            'customer_item': customer_item,
            'grouped_items': grouped_invoice_ids,
            'mapped_inventory_item_id': mapped_inventory_item_id,
            'mapped_inventory_description': mapped_inventory_description,
            'status': 'Done',
            'confirmed_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }
        
        if existing.data and len(existing.data) > 0:
            # Update existing mapping
            result = db.client.table('inventory_mapping')\
                .update(mapping_data)\
                .eq('id', existing.data[0]['id'])\
                .execute()
        else:
            # Insert new mapping
            result = db.client.table('inventory_mapping')\
                .insert(mapping_data)\
                .execute()
        
        # Update all grouped invoices with mapped_inventory_item_id
        if grouped_invoice_ids:
            for invoice_id in grouped_invoice_ids:
                db.client.table('verified_invoices')\
                    .update({'mapped_inventory_item_id': mapped_inventory_item_id})\
                    .eq('id', invoice_id)\
                    .execute()
        
        logger.info(f"✓ Mapping confirmed: {customer_item} -> {mapped_inventory_description}")
        
        return {
            'success': True,
            'mapping': result.data[0] if result.data else mapping_data
        }
        
    except Exception as e:
        logger.error(f"Error confirming mapping: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{mapping_id}/status")
async def update_mapping_status(
    mapping_id: int,
    request: UpdateStatusRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Update mapping status (toggle between Pending and Done).
    
    Request body:
    {
        "status": "Done" or "Pending"
    }
    """
    username = current_user.get("username")
    
    try:
        new_status = request.status
        
        if new_status not in ['Pending', 'Done']:
            raise HTTPException(status_code=400, detail='Invalid status. Must be Pending or Done')
        
        db = get_database_client()
        
        update_data = {
            'status': new_status,
            'updated_at': datetime.utcnow().isoformat()
        }
        
        if new_status == 'Done':
            update_data['confirmed_at'] = datetime.utcnow().isoformat()
        
        result = db.client.table('inventory_mapping')\
            .update(update_data)\
            .eq('id', mapping_id)\
            .eq('username', username)\
            .execute()
        
        return {
            'success': True,
            'mapping': result.data[0] if result.data else None
        }
        
    except Exception as e:
        logger.error(f"Error updating mapping status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== NEW CUSTOMER ITEM MAPPING ENDPOINTS ====================


@router.get("/customer-items/unmapped")
async def get_unmapped_customer_items(
    search: str = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get unique customer items from verified_invoices (type='Part') with smart grouping.
    Groups similar items (e.g., 'Oil Filter', 'Oil Filter -') together.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    def normalize_for_grouping(text: str) -> str:
        """
        Normalize text for smart grouping.
        - Removes ALL punctuation (., -, etc.)
        - Removes extra spaces
        - Converts to lowercase
        Example: "Bal. Rod Bush" -> "bal rod bush"
        """
        if not text:
            return ""
        import re
        # Remove all punctuation
        normalized = re.sub(r'[.,;:\-_()\/\\]', ' ', text.lower())
        # Collapse multiple spaces into one
        normalized = ' '.join(normalized.split())
        return normalized
    
    try:
        # Get all Part items
        result = db.client.table("verified_invoices")\
            .select("description, quantity")\
            .eq("username", username)\
            .eq("type", "Part")\
            .not_.is_("description", "null")\
            .execute()
        
        items = result.data or []
        
        # First, group by exact description
        exact_grouped = {}
        for item in items:
            desc = item.get("description")
            if not desc or (search and search.lower() not in desc.lower()):
                continue
                
            qty = float(item.get("quantity", 0) or 0)
            
            if desc in exact_grouped:
                exact_grouped[desc]["occurrence_count"] += 1
                exact_grouped[desc]["total_qty"] += qty
            else:
                exact_grouped[desc] = {
                    "description": desc,
                    "occurrence_count": 1,
                    "total_qty": qty
                }
        
        # Smart grouping with spelling tolerance
        from rapidfuzz import fuzz
        
        smart_groups = {}
        normalized_to_group = {}  # Maps normalized text to group key
        
        for desc, data in exact_grouped.items():
            normalized = normalize_for_grouping(desc)
            
            # Check if this normalized text is similar to any existing group
            found_match = False
            for existing_normalized, group_key in normalized_to_group.items():
                # Use fuzzy matching to catch spelling variations
                similarity = fuzz.ratio(normalized, existing_normalized)
                
                # 90% similarity threshold - catches typos but not different items
                if similarity >= 90:
                    # Add to existing group
                    smart_groups[group_key]["variations"].append({
                        "original_description": desc,
                        "occurrence_count": data["occurrence_count"],
                        "total_qty": data["total_qty"]
                    })
                    smart_groups[group_key]["total_occurrence_count"] += data["occurrence_count"]
                    smart_groups[group_key]["total_qty"] += data["total_qty"]
                    found_match = True
                    break
            
            if not found_match:
                # Create new group
                group_key = normalized
                normalized_to_group[normalized] = group_key
                smart_groups[group_key] = {
                    "variations": [{
                        "original_description": desc,
                        "occurrence_count": data["occurrence_count"],
                        "total_qty": data["total_qty"]
                    }],
                    "total_occurrence_count": data["occurrence_count"],
                    "total_qty": data["total_qty"]
                }
        
        # Get mapped items to exclude
        mapped_result = db.client.table("inventory_mapped")\
            .select("customer_item")\
            .eq("username", username)\
            .in_("status", ["Done", "Skipped"])\
            .execute()
        
        mapped_items = {item["customer_item"] for item in (mapped_result.data or [])}
        
        # Filter and prepare response
        unmapped_groups = []
        for group in smart_groups.values():
            # Remove mapped variations
            unmapped_vars = [v for v in group["variations"] if v["original_description"] not in mapped_items]
            
            if unmapped_vars:
                # Sort by occurrence (most common first)
                unmapped_vars.sort(key=lambda x: x["occurrence_count"], reverse=True)
                most_common = unmapped_vars[0]
                
                total_occ = sum(v["occurrence_count"] for v in unmapped_vars)
                total_qty = sum(v["total_qty"] for v in unmapped_vars)
                
                unmapped_groups.append({
                    "customer_item": most_common["original_description"],
                    "occurrence_count": total_occ,
                    "total_qty": total_qty,
                    "variation_count": len(unmapped_vars),
                    "variations": unmapped_vars,
                    "normalized_description": None
                })
        
        # Sort alphabetically by customer item name
        unmapped_groups.sort(key=lambda x: x["customer_item"].lower())
        
        logger.info(f"Found {len(unmapped_groups)} unmapped groups for {username}")
        
        return {
            "success": True,
            "items": unmapped_groups,
            "count": len(unmapped_groups)
        }
        
    except Exception as e:
        logger.error(f"Error getting unmapped items: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/customer-items/suggestions")
async def get_customer_item_suggestions(
    customer_item: str = Query(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get top 6-7 fuzzy matches from inventory_items for a customer item.
    Uses rapidfuzz with ≥70% similarity threshold.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Get all inventory items for this user
        result = db.client.table("inventory_items")\
            .select("id, description, part_number, qty, rate")\
            .eq("username", username)\
            .execute()
        
        vendor_items = result.data or []
        
        if not vendor_items:
            logger.warning(f"No inventory items found for {username}")
            return {
                "success": True,
                "suggestions": [],
                "count": 0
            }
        
        # Get fuzzy matches using rapidfuzz (threshold=40, limit=10)
        matches = get_fuzzy_matches(customer_item, vendor_items, threshold=40, limit=10)
        
        logger.info(f"Found {len(matches)} suggestions for '{customer_item}' (user: {username})")
        
        return {
            "success": True,
            "suggestions": matches,
            "count": len(matches)
        }
        
    except Exception as e:
        logger.error(f"Error getting customer item suggestions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/customer-items/search")
async def search_vendor_items_for_mapping(
    query: str,
    limit: int = 20,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Live search inventory items as user types.
    Returns unique items sorted in ascending order by description.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        if not query or len(query.strip()) < 2:
            return {
                "success": True,
                "results": [],
                "count": 0
            }
        
        # Search with ilike for substring matching
        result = db.client.table("inventory_items")\
            .select("id, description, part_number, qty, rate")\
            .eq("username", username)\
            .ilike("description", f"%{query}%")\
            .order("description")\
            .limit(limit)\
            .execute()
        
        items = result.data or []
        
        # Get unique descriptions
        seen_descriptions = set()
        unique_items = []
        for item in items:
            desc = item.get("description")
            if desc and desc not in seen_descriptions:
                seen_descriptions.add(desc)
                unique_items.append(item)
        
        logger.info(f"Search '{query}': found {len(unique_items)} unique items")
        
        return {
            "success": True,
            "results": unique_items,
            "count": len(unique_items)
        }
        
    except Exception as e:
        logger.error(f"Error searching vendor items: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/customer-items/confirm")
async def confirm_customer_item_mapping(
    request: CustomerItemMappingRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Mark mapping as Done and save to inventory_mapped table.
    If variations are provided, maps all of them together.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Determine which items to map
        items_to_map = request.variations if request.variations else [request.customer_item]
        
        # Create mapping records for each item
        mapping_records = []
        now = datetime.now().isoformat()
        
        for item_desc in items_to_map:
            mapping_records.append({
                "customer_item": item_desc,
                "normalized_description": request.normalized_description,
                "vendor_item_id": request.vendor_item_id,
                "vendor_description": request.vendor_description,
                "vendor_part_number": request.vendor_part_number,
                "priority": request.priority,
                "status": "Added",
                "username": username,
                "created_at": now,
                "updated_at": now,
                "mapped_on": now
            })
        
        # Batch upsert all mappings
        result = db.client.table("inventory_mapped")\
            .upsert(mapping_records, on_conflict="customer_item,username")\
            .execute()
        
        logger.info(f"Confirmed mapping for {len(items_to_map)} items to '{request.normalized_description}'")
        
        return {
            "success": True,
            "message": f"Mapped {len(items_to_map)} item(s)",
            "items_mapped": len(items_to_map)
        }

        
    except Exception as e:
        logger.error(f"Error confirming customer item mapping: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/customer-items/skip")
async def skip_customer_item(
    request: SkipItemRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Mark item as Skipped - won't appear in unmapped items anymore.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        skip_data = {
            "customer_item": request.customer_item,
            "normalized_description": "SKIPPED",
            "status": "Skipped",
            "username": username,
            "priority": 0,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        result = db.client.table("inventory_mapped")\
            .upsert(skip_data, on_conflict="customer_item,username")\
            .execute()
        
        logger.info(f"Skipped mapping for: '{request.customer_item}'")
        
        return {
            "success": True,
            "message": "Item skipped successfully"
        }
        
    except Exception as e:
        logger.error(f"Error skipping customer item: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/customer-items/sync")
async def sync_customer_item_mappings(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Finalize all Done mappings by marking them as synced.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        from datetime import datetime, timezone
        
        # Get all Done mappings that haven't been synced
        result = db.client.table("inventory_mapped")\
            .select("*")\
            .eq("username", username)\
            .eq("status", "Done")\
            .is_("synced_at", "null")\
            .execute()
        
        mappings = result.data or []
        
        if not mappings:
            return {
                "success": True,
                "message": "No mappings to sync",
                "mappings_synced": 0
            }
        
        # Mark all as synced with current timestamp
        now = datetime.now(timezone.utc).isoformat()
        for mapping in mappings:
            db.client.table("inventory_mapped")\
                .update({"synced_at": now})\
                .eq("id", mapping["id"])\
                .execute()
        
        logger.info(f"Synced {len(mappings)} Done mappings for {username}")
        
        return {
            "success": True,
            "message": f"Synced {len(mappings)} mappings",
            "mappings_synced": len(mappings)
        }
        
    except Exception as e:
        logger.error(f"Error syncing customer item mappings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/customer-items/stats")
async def get_customer_item_mapping_stats(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get counts for Pending, Done (not synced), and Skipped items for progress tracking.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Get total unique customer items (type='Part')
        all_items_result = db.client.table("verified_invoices")\
            .select("description")\
            .eq("username", username)\
            .eq("type", "Part")\
            .not_.is_("description", "null")\
            .execute()
        
        unique_items = set(item["description"] for item in (all_items_result.data or []) if item.get("description"))
        total_items = len(unique_items)
        
        # Get Done count (items marked Done but not yet synced)
        # We'll mark items as synced by adding a synced_at timestamp
        done_result = db.client.table("inventory_mapped")\
            .select("customer_item", count="exact")\
            .eq("username", username)\
            .eq("status", "Done")\
            .is_("synced_at", "null")\
            .execute()
        done_count = done_result.count if done_result.count is not None else 0
        
        # Get Skipped count
        skipped_result = db.client.table("inventory_mapped")\
            .select("customer_item", count="exact")\
            .eq("username", username)\
            .eq("status", "Skipped")\
            .execute()
        skipped_count = skipped_result.count if skipped_result.count is not None else 0
        
        # Get total mapped (Done + Skipped)
        total_mapped_result = db.client.table("inventory_mapped")\
            .select("customer_item", count="exact")\
            .eq("username", username)\
            .in_("status", ["Done", "Skipped"])\
            .execute()
        total_mapped = total_mapped_result.count if total_mapped_result.count is not None else 0
        
        # Pending = Total - Total Mapped
        pending_count = max(0, total_items - total_mapped)
        
        return {
            "success": True,
            "stats": {
                "total": total_items,
                "pending": pending_count,
                "done": done_count,  # Only unsynced Done items
                "skipped": skipped_count,
                "completion_percentage": round((total_mapped / total_items * 100) if total_items > 0 else 0, 1)
            }
        }
        
    except Exception as e:
        logger.error(f"Error getting customer item mapping stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/customer-items/mapped")
async def get_mapped_items(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get all mapped items (Done and Skipped) for the Inventory Mapped page.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        result = db.client.table("inventory_mapped")\
            .select("*")\
            .eq("username", username)\
            .order("created_at", desc=True)\
            .execute()
        
        items = result.data or []
        
        logger.info(f"Found {len(items)} mapped items for {username}")
        
        return {
            "success": True,
            "items": items,
            "count": len(items)
        }
        
    except Exception as e:
        logger.error(f"Error getting mapped items: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/customer-items/unmap/{mapping_id}")
async def unmap_customer_item(
    mapping_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete a mapping from inventory_mapped. Item will reappear in unmapped items.
    """
    username = current_user.get("username")
    db = get_database_client()
    
    try:
        # Delete the mapping
        result = db.client.table("inventory_mapped")\
            .delete()\
            .eq("id", mapping_id)\
            .eq("username", username)\
            .execute()
        
        logger.info(f"Unmapped item ID {mapping_id} for {username}")
        
        return {
            "success": True,
            "message": "Item unmapped successfully"
        }
        
    except Exception as e:
        logger.error(f"Error unmapping item: {e}")
        raise HTTPException(status_code=500, detail=str(e))
