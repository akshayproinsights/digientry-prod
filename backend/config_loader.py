"""
User Configuration Loader Service
Loads industry templates and user configs, merges them, and provides config to the application.
"""
import json
import os
from pathlib import Path
from typing import Dict, Any, Optional
import logging
from copy import deepcopy

logger = logging.getLogger(__name__)

# Paths
BASE_DIR = Path(__file__).parent
USER_CONFIGS_DIR = BASE_DIR / "user_configs"
TEMPLATES_DIR = USER_CONFIGS_DIR / "templates"

# Cache for loaded configs
_config_cache: Dict[str, Dict[str, Any]] = {}
_template_cache: Dict[str, Dict[str, Any]] = {}


def load_template(industry: str) -> Optional[Dict[str, Any]]:
    """
    Load an industry template from templates directory.
    
    Args:
        industry: Industry name (e.g., 'automobile', 'medical')
    
    Returns:
        Template config dict or None if not found
    """
    global _template_cache
    
    # Check cache first
    if industry in _template_cache:
        return deepcopy(_template_cache[industry])
    
    template_path = TEMPLATES_DIR / f"{industry}.json"
    
    if not template_path.exists():
        logger.warning(f"Template not found: {industry}")
        return None
    
    try:
        with open(template_path, 'r', encoding='utf-8') as f:
            template = json.load(f)
        
        _template_cache[industry] = template
        logger.info(f"Loaded template: {industry}")
        return deepcopy(template)
    
    except Exception as e:
        logger.error(f"Error loading template {industry}: {e}")
        return None


def load_user_config(username: str, bypass_cache: bool = False) -> Optional[Dict[str, Any]]:
    """
    Load user-specific configuration and merge with industry template.
    
    Args:
        username: Username (e.g., 'adnak')
        bypass_cache: If True, force reload from disk
    
    Returns:
        Merged config dict or None if not found
    """
    global _config_cache
    
    # Check cache first
    if not bypass_cache and username in _config_cache:
        return deepcopy(_config_cache[username])
    
    user_config_path = USER_CONFIGS_DIR / f"{username}.json"
    
    # CASE SENSITIVITY FIX: Fallback to lowercase if exact match not found
    if not user_config_path.exists():
        lowercase_path = USER_CONFIGS_DIR / f"{username.lower()}.json"
        if lowercase_path.exists():
            logger.info(f"User config found with lowercase name: {username.lower()}")
            user_config_path = lowercase_path
        else:
            logger.warning(f"User config not found: {username} (checked {user_config_path} and {lowercase_path})")
            return None
    
    try:
        # Load user config
        with open(user_config_path, 'r', encoding='utf-8') as f:
            user_config = json.load(f)
        
        logger.info(f"Loaded user config: {username}")
        
        # If user extends a template, merge them
        if "extends_template" in user_config:
            industry = user_config["extends_template"]
            template = load_template(industry)
            
            if template:
                merged_config = merge_configs(template, user_config)
            else:
                logger.warning(f"Template {industry} not found for user {username}, using user config only")
                merged_config = user_config
        else:
            # No template, use user config as-is
            merged_config = user_config
        
        # Cache the merged config
        _config_cache[username] = merged_config
        return deepcopy(merged_config)
    
    except Exception as e:
        logger.error(f"Error loading user config {username}: {e}")
        return None


def merge_configs(template: Dict[str, Any], user_overrides: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merge template config with user-specific overrides.
    
    Args:
        template: Base template config
        user_overrides: User-specific config with overrides
    
    Returns:
        Merged configuration
    """
    # Start with deep copy of template
    merged = deepcopy(template)
    
    # Override top-level fields from user config
    for key in ['username', 'display_name', 'r2_bucket', 'dashboard_url', 'industry']:
        if key in user_overrides:
            merged[key] = user_overrides[key]
    
    # Apply column label overrides
    if "column_label_overrides" in user_overrides and "columns" in merged:
        overrides = user_overrides["column_label_overrides"]
        
        # Apply to all column sections (invoice_all, verify_dates, etc.)
        for section_name, columns in merged["columns"].items():
            for column in columns:
                db_column = column.get("db_column")
                if db_column in overrides:
                    column["label"] = overrides[db_column]
                    logger.debug(f"Overrode label for {db_column}: {overrides[db_column]}")
    
    # Apply custom gemini prompt if provided
    if "gemini" in user_overrides:
        merged["gemini"] = user_overrides["gemini"]
    
    # Apply custom columns if provided (complete override)
    if "columns" in user_overrides:
        merged["columns"] = user_overrides["columns"]
    
    return merged


def get_user_config(username: str) -> Optional[Dict[str, Any]]:
    """
    Main entry point to get user configuration.
    Convenience wrapper around load_user_config.
    
    Args:
        username: Username
    
    Returns:
        User configuration dict or None
    """
    return load_user_config(username)


def get_gemini_prompt(username: str) -> Optional[str]:
    """
    Get the Gemini system instruction for a user.
    
    Args:
        username: Username
    
    Returns:
        Gemini prompt string or None
    """
    config = get_user_config(username)
    if config and "gemini" in config:
        return config["gemini"].get("system_instruction")
    return None


def get_columns_config(username: str, section: str = "invoice_all") -> Optional[list]:
    """
    Get column configuration for a specific section.
    
    Args:
        username: Username
        section: Column section name ('invoice_all', 'verify_dates', 'verify_amounts', 'verified')
    
    Returns:
        List of column definitions or None
    """
    config = get_user_config(username)
    if config and "columns" in config:
        return config["columns"].get(section)
    return None


def clear_cache():
    """Clear all cached configs (useful for development/testing)"""
    global _config_cache, _template_cache
    _config_cache.clear()
    _template_cache.clear()
    logger.info("Config cache cleared")


def list_available_users() -> list:
    """
    List all available user configurations.
    
    Returns:
        List of usernames
    """
    if not USER_CONFIGS_DIR.exists():
        return []
    
    users = []
    for file in USER_CONFIGS_DIR.glob("*.json"):
        users.append(file.stem)  # filename without extension
    
    return users


# For testing
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    print("=== Testing Config Loader ===")
    
    # Test loading user config
    print("\n1. Loading adnak config:")
    config = get_user_config("adnak")
    if config:
        print(f"  - Username: {config.get('username')}")
        print(f"  - Industry: {config.get('industry')}")
        print(f"  - Dashboard: {config.get('dashboard_url')}")
        print(f"  - Gemini prompt length: {len(config.get('gemini', {}).get('system_instruction', ''))}")
    
    # Test getting columns
    print("\n2. Getting invoice_all columns for adnak:")
    columns = get_columns_config("adnak", "invoice_all")
    if columns:
        print(f"  - Total columns: {len(columns)}")
        print(f"  - First 3 columns: {[c['label'] for c in columns[:3]]}")
    
    # Test listing users
    print("\n3. Available users:")
    users = list_available_users()
    print(f"  - {users}")
    
    print("\n=== Test Complete ===")
