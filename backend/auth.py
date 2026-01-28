"""
Authentication module using JWT tokens.
Handles user login, token generation, and authentication middleware.
"""
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
import logging

from config import settings, get_users_db, get_user_config

logger = logging.getLogger(__name__)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# HTTP Bearer token scheme
security = HTTPBearer()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password"""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.jwt_expire_minutes)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    
    return encoded_jwt


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and validate a JWT token"""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return payload
    except JWTError as e:
        logger.warning(f"JWT decode error: {e}")
        return None


def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    """
    Authenticate a user against the users database.
    Returns user config if successful, None otherwise.
    
    Note: Currently passwords are stored in plain text in secrets.toml.
    For production, they should be hashed.
    """
    # Keep username case as-is (case-sensitive matching)
    user_config = get_user_config(username)
    
    if not user_config:
        logger.warning(f"User not found: {username}")
        return None
    
    stored_password = user_config.get("password")
    
    if not stored_password:
        logger.warning(f"No password configured for user: {username}")
        return None
    
    # Check if password is hashed (starts with known hash prefixes)
    if stored_password.startswith("$2b$") or stored_password.startswith("$2a$"):
        # Hashed password
        if not verify_password(password, stored_password):
            logger.warning(f"Invalid password for user: {username}")
            return None
    else:
        # Plain text password (current implementation)
        if password != stored_password:
            logger.warning(f"Invalid password for user: {username}")
            return None
    
    logger.info(f"User authenticated: {username}")
    return user_config


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Dict[str, Any]:
    """
    Dependency to get current authenticated user from JWT token.
    Raises HTTPException if token is invalid or expired.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        try:
            token = credentials.credentials
            payload = decode_access_token(token)
            
            if payload is None:
                logger.warning("Token payload is None")
                raise credentials_exception
            
            username: str = payload.get("sub")
            if username is None:
                logger.warning("Username in payload is None")
                raise credentials_exception
            
            # Keep username case as-is (case-sensitive matching)
            
            # Get user config
            try:
                user_config = get_user_config(username)
            except Exception as e:
                logger.error(f"Error loading user config for {username}: {e}")
                raise HTTPException(status_code=500, detail=f"Config error: {str(e)}")

            if user_config is None:
                logger.warning(f"User config not found for {username}")
                raise credentials_exception
            
            # Add username to user_config for convenience
            user_data = user_config.copy()
            user_data["username"] = username
            
            return user_data
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error processing token or user data: {e}")
            raise credentials_exception
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_current_user: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Auth error: {str(e)}")


async def get_current_user_sheet_id(current_user: Dict[str, Any] = Depends(get_current_user)) -> Optional[str]:
    """
    Dependency to get the current user's sheet_id.
    Returns None if sheet_id is not configured (optional).
    """
    sheet_id = current_user.get("sheet_id")
    # Make sheet_id optional - return None if missing instead of 400 error
    return sheet_id


async def get_current_user_r2_bucket(current_user: Dict[str, Any] = Depends(get_current_user)) -> str:
    """
    Dependency to get the current user's R2 bucket.
    Raises HTTPException if r2_bucket is not configured.
    """
    r2_bucket = current_user.get("r2_bucket")
    
    if not r2_bucket:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No r2_bucket configured for user"
        )
    
    return r2_bucket
