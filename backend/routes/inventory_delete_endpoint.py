
@router.delete("/by-hash/{image_hash}")
async def delete_by_image_hash(
    image_hash: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Delete all inventory items with the given image_hash (for duplicate replacement)
    """
    try:
        db = get_database_client()
        username = current_user.get("username")
        
        # Delete all items with this image_hash for this user
        result = db.client.table("inventory_items")\
            .delete()\
            .eq("image_hash", image_hash)\
            .eq("username", username)\
            .execute()
        
        deleted_count = len(result.data) if result.data else 0
        
        logger.info(f"Deleted {deleted_count} inventory items with image_hash: {image_hash}")
        
        return {
            "success": True,
            "deleted_count": deleted_count,
            "message": f"Deleted {deleted_count} inventory item(s)"
        }
        
    except Exception as e:
        logger.error(f"Error deleting inventory items by image_hash: {e}")
        raise HTTPException(status_code=500, detail=str(e))
