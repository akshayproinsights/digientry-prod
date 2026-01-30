"""
Image optimization utilities for invoice processing.
Optimizes images before R2 upload to reduce storage & API costs while maintaining Gemini accuracy.
"""
import io
from typing import Tuple, Optional
from PIL import Image
import logging

logger = logging.getLogger(__name__)

# Optimization settings tuned for Gemini handwriting recognition
OPTIMAL_MAX_DIMENSION = 1920  # Max width or height in pixels
OPTIMAL_QUALITY = 85  # JPEG quality (1-100)
MIN_DPI = 150  # Minimum DPI for OCR accuracy
TARGET_FILE_SIZE_KB = 500  # Target max file size in KB

def optimize_image_for_gemini(
    image_data: bytes,
    max_dimension: int = OPTIMAL_MAX_DIMENSION,
    quality: int = OPTIMAL_QUALITY,
    target_size_kb: Optional[int] = TARGET_FILE_SIZE_KB
) -> Tuple[bytes, dict]:
    """
    Optimize image for Gemini processing while maintaining handwriting recognition accuracy.
    
    Strategy:
    1. Resize if larger than max_dimension (maintains aspect ratio)
    2. Convert to RGB (remove alpha channel for smaller files)
    3. Compress as JPEG with optimal quality
    4. If still too large, reduce quality progressively
    
    Args:
        image_data: Original image bytes
        max_dimension: Maximum width or height (default: 1920px)
        quality: Initial JPEG quality (default: 85)
        target_size_kb: Target file size in KB (default: 500KB)
    
    Returns:
        Tuple of (optimized_bytes, metadata_dict)
    """
    
    # Load image
    original_img = Image.open(io.BytesIO(image_data))
    original_size = len(image_data)
    original_format = original_img.format
    original_dimensions = original_img.size
    
    logger.info(f"Original image: {original_dimensions[0]}x{original_dimensions[1]}, "
                f"{original_size / 1024:.2f}KB, format: {original_format}")
    
    # -----------------------------------------------------------
    # FAST PATH: Skip processed optimization if frontend already did it
    # -----------------------------------------------------------
    size_kb = original_size / 1024
    if size_kb <= 600 and original_format == 'JPEG':
        width, height = original_dimensions
        if width <= max_dimension and height <= max_dimension:
            logger.info(f"⚡ Fast Path: Image already optimized ({size_kb:.2f}KB, {width}x{height}, JPEG). Skipping re-processing.")
            metadata = {
                'original_size_kb': round(size_kb, 2),
                'optimized_size_kb': round(size_kb, 2),
                'original_dimensions': original_dimensions,
                'final_dimensions': original_dimensions,
                'compression_ratio': 0.0,
                'quality': 'original',
                'original_format': 'JPEG',
                'optimized_format': 'JPEG'
            }
            return image_data, metadata
    
    # Convert RGBA to RGB (removes alpha channel for JPEG compression)
    if original_img.mode in ('RGBA', 'LA', 'P'):
        # Create white background
        background = Image.new('RGB', original_img.size, (255, 255, 255))
        if original_img.mode == 'P':
            original_img = original_img.convert('RGBA')
        background.paste(original_img, mask=original_img.split()[-1] if original_img.mode == 'RGBA' else None)
        img = background
    elif original_img.mode != 'RGB':
        img = original_img.convert('RGB')
    else:
        img = original_img.copy()
    
    # Resize if needed (maintain aspect ratio)
    width, height = img.size
    if width > max_dimension or height > max_dimension:
        # Calculate new dimensions
        if width > height:
            new_width = max_dimension
            new_height = int((max_dimension / width) * height)
        else:
            new_height = max_dimension
            new_width = int((max_dimension / height) * width)
        
        # Use LANCZOS for best quality downsampling
        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        logger.info(f"Resized to: {new_width}x{new_height}")
    
    # Try initial compression
    output = io.BytesIO()
    img.save(output, format='JPEG', quality=quality, optimize=True)
    optimized_size = output.tell()
    
    # If still too large and target size specified, reduce quality progressively
    if target_size_kb and optimized_size > target_size_kb * 1024:
        # Progressive quality reduction
        for test_quality in range(quality - 5, 60, -5):  # Don't go below 60
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=test_quality, optimize=True)
            optimized_size = output.tell()
            
            if optimized_size <= target_size_kb * 1024:
                quality = test_quality
                logger.info(f"Reduced quality to {quality} to meet target size")
                break
    
    optimized_data = output.getvalue()
    final_size = len(optimized_data)
    final_dimensions = img.size
    
    # Calculate compression ratio
    compression_ratio = (1 - final_size / original_size) * 100
    
    metadata = {
        'original_size_kb': round(original_size / 1024, 2),
        'optimized_size_kb': round(final_size / 1024, 2),
        'original_dimensions': original_dimensions,
        'final_dimensions': final_dimensions,
        'compression_ratio': round(compression_ratio, 2),
        'quality': quality,
        'original_format': original_format,
        'optimized_format': 'JPEG'
    }
    
    logger.info(f"Optimization complete: {final_size / 1024:.2f}KB "
                f"({compression_ratio:.1f}% reduction), quality: {quality}")
    
    return optimized_data, metadata


def should_optimize_image(image_data: bytes, min_size_kb: int = 100) -> bool:
    """
    Determine if image should be optimized.
    
    Args:
        image_data: Image bytes
        min_size_kb: Minimum size in KB to trigger optimization
    
    Returns:
        True if image should be optimized
    """
    size_kb = len(image_data) / 1024
    
    # Skip optimization for very small images
    if size_kb < min_size_kb:
        logger.info(f"Image size ({size_kb:.2f}KB) below threshold ({min_size_kb}KB), skipping optimization")
        return False
    
    # Check format
    try:
        img = Image.open(io.BytesIO(image_data))
        
        # Always optimize PNG files (usually larger)
        if img.format == 'PNG':
            logger.info("PNG image detected, will optimize")
            return True
        
        # Optimize large JPEG files
        if img.format == 'JPEG' and size_kb > 500:
            logger.info(f"Large JPEG ({size_kb:.2f}KB), will optimize")
            return True
        
        # Optimize if dimensions are very large
        width, height = img.size
        if width > OPTIMAL_MAX_DIMENSION or height > OPTIMAL_MAX_DIMENSION:
            logger.info(f"Large dimensions ({width}x{height}), will optimize")
            return True
        
    except Exception as e:
        logger.warning(f"Error checking image: {e}, will optimize anyway")
        return True
    
    return False


def validate_image_quality(image_data: bytes) -> dict:
    """
    Validate image quality for OCR/handwriting recognition.
    
    Returns dict with:
    - is_acceptable: bool
    - warnings: list of warning messages
    - metrics: dict of quality metrics
    """
    try:
        img = Image.open(io.BytesIO(image_data))
        warnings = []
        
        # Check dimensions
        width, height = img.size
        min_dimension = min(width, height)
        max_dimension = max(width, height)
        
        # Warn if image is too small for good OCR
        if min_dimension < 600:
            warnings.append(f"Image dimension ({width}x{height}) may be too small for accurate text recognition")
        
        # Warn if aspect ratio is unusual
        aspect_ratio = max_dimension / min_dimension
        if aspect_ratio > 5:
            warnings.append(f"Unusual aspect ratio ({aspect_ratio:.1f}:1) detected")
        
        # Check file size
        size_kb = len(image_data) / 1024
        if size_kb < 20:
            warnings.append(f"Very small file size ({size_kb:.2f}KB) may indicate low quality")
        
        metrics = {
            'dimensions': (width, height),
            'size_kb': round(size_kb, 2),
            'aspect_ratio': round(aspect_ratio, 2),
            'format': img.format,
            'mode': img.mode
        }
        
        return {
            'is_acceptable': len(warnings) == 0,
            'warnings': warnings,
            'metrics': metrics
        }
        
    except Exception as e:
        return {
            'is_acceptable': False,
            'warnings': [f"Failed to validate image: {str(e)}"],
            'metrics': {}
        }
