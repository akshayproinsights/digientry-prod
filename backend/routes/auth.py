"""Authentication routes for login and user management"""
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
from typing import Dict, Any, Optional
from datetime import timedelta

import auth
import config

router = APIRouter()


class LoginRequest(BaseModel):
    """Login request model"""
    username: str
    password: str


class LoginResponse(BaseModel):
    """Login response model"""
    access_token: str
    token_type: str
    user: Dict[str, Any]


class UserResponse(BaseModel):
    """User information response"""
    username: str
    r2_bucket: str
    sheet_id: Optional[str] = None
    dashboard_url: Optional[str] = None


@router.post("/login", response_model=LoginResponse)
async def login(credentials: LoginRequest):
    """
    Authenticate user and return JWT token
    """
    user_config = auth.authenticate_user(credentials.username, credentials.password)
    
    if not user_config:
        # DEBUG: Reveal why auth failed
        available_users = list(config.get_users_db().keys())
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"User not found. Available users: {available_users}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    stored_password = user_config.get("password")
    if not stored_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No password configured for this user",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if password is hashed (starts with known hash prefixes)
    password_valid = False
    if stored_password.startswith("$2b$") or stored_password.startswith("$2a$"):
        # Hashed password
        password_valid = auth.verify_password(credentials.password, stored_password)
    else:
        # Plain text password (current implementation)
        password_valid = (credentials.password == stored_password)
        
    if not password_valid:
         raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create access token
    access_token_expires = timedelta(minutes=config.settings.jwt_expire_minutes)
    access_token = auth.create_access_token(
        data={"sub": credentials.username},
        expires_delta=access_token_expires
    )
    
    # Prepare user data (exclude password)
    user_data = {
        "username": credentials.username,
        "r2_bucket": user_config.get("r2_bucket", ""),
        "sheet_id": user_config.get("sheet_id", ""),
        "dashboard_url": user_config.get("dashboard_url")
    }
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user_data
    }


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: Dict[str, Any] = Depends(auth.get_current_user)):
    """
    Get current authenticated user information
    """
    return {
        "username": current_user.get("username", ""),
        "r2_bucket": current_user.get("r2_bucket", ""),
        "sheet_id": current_user.get("sheet_id", ""),
        "dashboard_url": current_user.get("dashboard_url")
    }


@router.post("/logout")
async def logout():
    """
    Logout endpoint (client-side token removal)
    """
    return {"message": "Logged out successfully"}
