"""
Main FastAPI application.
Handles routing, middleware, and application lifecycle.
"""
print("DigiEntry Backend is starting....")
# Final check done
# Initial deployment trigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

import config

# Configure logging
import sys

# Create console handler with explicit flushing
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)

# Set format
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
console_handler.setFormatter(formatter)

# Configure root logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[console_handler],
    force=True  # Force reconfiguration even if logging was already configured
)

# Force flush after each log
class FlushingHandler(logging.StreamHandler):
    def emit(self, record):
        super().emit(record)
        self.flush()

# Replace with flushing handler
root_logger = logging.getLogger()
root_logger.handlers.clear()
flushing_handler = FlushingHandler(sys.stdout)
flushing_handler.setFormatter(formatter)
flushing_handler.setLevel(logging.INFO)
root_logger.addHandler(flushing_handler)
root_logger.setLevel(logging.INFO)

# Suppress httpx INFO logs (too verbose - thousands of Supabase API calls)
logging.getLogger('httpx').setLevel(logging.WARNING)


logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="DigiEntry API",
    description="Backend API for Invoice Processing and Management",
    version="2.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],  # Allow browser to read this header for file downloads
)

# Startup Error Handling
try:
    # Import routers
    from routes import auth, upload, invoices, review, verified, config_api, inventory, inventory_mapping, vendor_mapping_routes, stock_routes, stock_mapping_upload_routes, dashboard_routes, purchase_order_routes
except Exception as e:
    import traceback
    print("CRITICAL STARTUP ERROR: Failed to import routers", flush=True)
    traceback.print_exc()
    raise e

# Register routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(config_api.router, prefix="/api", tags=["Configuration"])
app.include_router(dashboard_routes.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(upload.router, prefix="/api/upload", tags=["Upload & Processing"])
app.include_router(inventory.router, prefix="/api/inventory", tags=["Inventory"])
app.include_router(inventory_mapping.router, prefix="/api/inventory-mapping", tags=["Inventory Mapping"])
app.include_router(vendor_mapping_routes.router, prefix="/api/vendor-mapping", tags=[" Vendor Mapping"])
app.include_router(stock_routes.router, prefix="/api/stock", tags=["Stock Levels"])
app.include_router(stock_mapping_upload_routes.router, prefix="/api/stock/mapping-sheets", tags=["Stock Mapping Upload"])
app.include_router(purchase_order_routes.router, prefix="/api/purchase-orders", tags=["Purchase Orders"])
app.include_router(invoices.router, prefix="/api/invoices", tags=["Invoices"])
app.include_router(review.router, prefix="/api/review", tags=["Review"])
app.include_router(verified.router, prefix="/api/verified", tags=["Verified Invoices"])


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "DigiEntry API",
        "version": "2.0.0",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.on_event("startup")
async def startup_event():
    """Application startup"""
    logger.info("DigiEntry API starting up...")
    logger.info(f"CORS origins: {config.settings.cors_origins}")


@app.on_event("shutdown")
async def shutdown_event():
    """Application shutdown"""
    logger.info("DigiEntry API shutting down...")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=8000, 
        reload=True,
        log_level="info",
        access_log=True  # Enable access logging
    )