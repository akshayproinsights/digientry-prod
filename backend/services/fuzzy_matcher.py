"""
Fuzzy string matching service for inventory item mapping.
Uses rapidfuzz for efficient fuzzy matching with configurable threshold.
"""
import logging
from typing import List, Dict, Any, Optional
from rapidfuzz import fuzz, process

logger = logging.getLogger(__name__)


def get_fuzzy_matches(
    customer_item: str,
    vendor_items: List[Dict[str, Any]],
    threshold: int = 70,
    limit: int = 7
) -> List[Dict[str, Any]]:
    """
    Find best matching vendor items using fuzzy string matching.
    
    Args:
        customer_item: Customer item description to match
        vendor_items: List of vendor items with 'description' field
        threshold: Minimum similarity score (0-100), default 70
        limit: Maximum number of results to return
        
    Returns:
        List of vendor items with match_score field, sorted by score descending
    """
    if not customer_item or not vendor_items:
        return []
    
    try:
        # Extract descriptions for matching
        descriptions = [item.get('description', '') for item in vendor_items]
        
        # Perform fuzzy matching using token_sort_ratio (handles word order variations)
        matches = process.extract(
            customer_item,
            descriptions,
            scorer=fuzz.token_sort_ratio,
            limit=min(limit, len(vendor_items))
        )
        
        # Build results with match scores
        results = []
        for match_text, score, idx in matches:
            if score >= threshold:
                item_copy = vendor_items[idx].copy()
                item_copy['match_score'] = round(score, 1)
                results.append(item_copy)
        
        logger.info(f"Fuzzy match for '{customer_item[:50]}...': {len(results)} matches found")
        return results
        
    except Exception as e:
        logger.error(f"Error in fuzzy matching: {e}")
        return []


def get_best_match(
    customer_item: str,
    vendor_items: List[Dict[str, Any]],
    threshold: int = 70
) -> Optional[Dict[str, Any]]:
    """
    Get the single best matching vendor item.
    
    Args:
        customer_item: Customer item description to match
        vendor_items: List of vendor items
        threshold: Minimum similarity score
        
    Returns:
        Best matching item with match_score, or None if no match above threshold
    """
    matches = get_fuzzy_matches(customer_item, vendor_items, threshold, limit=1)
    return matches[0] if matches else None


def batch_match_items(
    customer_items: List[str],
    vendor_items: List[Dict[str, Any]],
    threshold: int = 70,
    limit: int = 7
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Perform fuzzy matching for multiple customer items at once.
    
    Args:
        customer_items: List of customer item descriptions
        vendor_items: List of vendor items
        threshold: Minimum similarity score
        limit: Max results per customer item
        
    Returns:
        Dictionary mapping customer_item -> list of matches
    """
    results = {}
    for customer_item in customer_items:
        matches = get_fuzzy_matches(customer_item, vendor_items, threshold, limit)
        results[customer_item] = matches
    
    logger.info(f"Batch matched {len(customer_items)} customer items")
    return results
