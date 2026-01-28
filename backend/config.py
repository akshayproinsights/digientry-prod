"""
Configuration management for the FastAPI backend.
Loads settings from environment variables and secrets.toml
"""
from typing import Dict, Any, Optional
import os

# Trigger reload 2
from pydantic_settings import BaseSettings
from pydantic import Field
import sys
from pathlib import Path

# Add parent directory to path to import configs - REMOVED
# parent_dir = Path(__file__).parent.parent
# sys.path.insert(0, str(parent_dir))

import configs


class Settings(BaseSettings):
    """Application settings"""
    
    # JWT Configuration
    jwt_secret: str = Field(default="your-secret-key-change-in-production", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expire_minutes: int = Field(default=1440, alias="JWT_EXPIRE_MINUTES")  # 24 hours
    
    # CORS
    cors_origins: list = Field(default=["http://localhost:3000", "http://localhost:5173", "http://localhost:5174", "http://localhost:5175"], alias="CORS_ORIGINS")
    
    # Google API
    google_api_key: Optional[str] = Field(default=None, alias="GOOGLE_API_KEY")
    
    class Config:
        env_file = ".env"
        case_sensitive = False


# Global settings instance
settings = Settings()


def get_r2_config() -> Dict[str, str]:
    """Get Cloudflare R2 configuration from secrets"""
    return configs.get_r2_config()


def get_users_db() -> Dict[str, Dict[str, Any]]:
    """Get users database from secrets"""
    return configs.get_users_db()


def get_user_config(username: str) -> Optional[Dict[str, Any]]:
    """Get single user's config"""
    return configs.get_user_config(username)


def get_gcp_service_account() -> Optional[Dict[str, str]]:
    """Get GCP service account for Google Sheets authentication"""
    return configs.get_gcp_service_account()


def get_google_api_key() -> Optional[str]:
    """Get Google API key for Gemini"""
    if settings.google_api_key:
        return settings.google_api_key
    
    # Try from secrets
    secrets = configs.load_secrets()
    return secrets.get("google_api_key") or secrets.get("GOOGLE_API_KEY")

def get_supabase_config() -> Optional[Dict[str, str]]:
    """
    Returns Supabase configuration.
    Checks environment variables first, then falls back to secrets file.
    """
    # Check environment variables first
    env_config = {
        "url": os.getenv("SUPABASE_URL"),
        "anon_key": os.getenv("SUPABASE_ANON_KEY"),
        "service_role_key": os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    }
    
    # If all env vars present, return them
    if all(env_config.values()):
        return env_config
        
    # BACKWARD COMPATIBILITY: Allow SUPABASE_KEY to map to service_role_key
    # This matches what is defined in deploy.yml
    supabase_key = os.getenv("SUPABASE_KEY")
    if supabase_key and env_config["url"]:
        return {
            "url": env_config["url"],
            "anon_key": supabase_key,       # Use same key for anon if missing
            "service_role_key": supabase_key
        }
    
    # Fallback to secrets file
    secrets = configs.load_secrets()
    supabase = secrets.get("supabase", {})
    
    if isinstance(supabase, dict) and supabase.get("url"):
        return {
            "url": supabase.get("url"),
            "anon_key": supabase.get("anon_key"),
            "service_role_key": supabase.get("service_role_key")
        }
    
    return None


def get_sales_folder(username: str) -> str:
    """
    Get R2 folder path for sales invoice uploads.
    
    Args:
        username: Username to get folder path for
        
    Returns:
        R2 folder path for sales invoices (e.g., "Adnak/sales/")
    """
    return f"{username}/sales/"


def get_purchases_folder(username: str) -> str:
    """
    Get R2 folder path for purchase/vendor invoice uploads.
    
    Args:
        username: Username to get folder path for
        
    Returns:
        R2 folder path for purchase invoices (e.g., "Adnak/purchases/")
    """
    return f"{username}/purchases/"


def get_mappings_folder(username: str) -> str:
    """
    Get R2 folder path for vendor mapping PDF uploads.
    
    Args:
        username: Username to get folder path for
        
    Returns:
        R2 folder path for vendor mappings (e.g., "Adnak/mappings/")
    """
    return f"{username}/mappings/"


def get_inventory_r2_folder(username: str) -> str:
    """
    Get R2 folder path for inventory uploads (vendor invoices).
    DEPRECATED: Use get_purchases_folder() instead.
    
    Args:
        username: Username to get folder path for
        
    Returns:
        R2 folder path for inventory items
    """
    # Use the new purchases folder function for consistency
    return get_purchases_folder(username)
