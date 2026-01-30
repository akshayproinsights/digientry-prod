"""
Cloudflare R2 storage service.
Handles file upload, download, and management in R2 buckets.
"""
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from typing import Optional, BinaryIO
import logging
import io

from config import get_r2_config

logger = logging.getLogger(__name__)


class R2StorageClient:
    """Cloudflare R2 storage client wrapper"""
    
    def __init__(self):
        self._client = None
        self._public_base_url = None
    
    def get_client(self):
        """Get or create boto3 S3 client for R2"""
        if self._client is None:
            r2_config = get_r2_config()
            
            if not r2_config:
                raise ValueError("R2 configuration not found in secrets")
            
            endpoint_url = r2_config.get("endpoint_url")
            access_key_id = r2_config.get("access_key_id")
            secret_access_key = r2_config.get("secret_access_key")
            self._public_base_url = r2_config.get("public_base_url")
            
            if not all([endpoint_url, access_key_id, secret_access_key]):
                raise ValueError("Incomplete R2 configuration")
            
            self._client = boto3.client(
                's3',
                endpoint_url=endpoint_url,
                aws_access_key_id=access_key_id,
                aws_secret_access_key=secret_access_key,
                region_name='auto',
                config=Config(
                    connect_timeout=60,
                    read_timeout=60,
                    retries={'max_attempts': 3}
                )
            )
            logger.info("R2 storage client initialized")
        
        return self._client
    
    def upload_file(self, file_data: BinaryIO, bucket: str, key: str, content_type: str = None) -> bool:
        """
        Upload a file to R2
        
        Args:
            file_data: File-like object or bytes
            bucket: R2 bucket name
            key: Object key (path) in R2
            content_type: MIME type of the file
        
        Returns:
            True if successful, False otherwise
        """
        try:
            client = self.get_client()
            
            # Note: R2 doesn't support S3 ACLs. Public access is controlled
            # at the bucket level via R2 dashboard settings.
            extra_args = {}
            if content_type:
                extra_args['ContentType'] = content_type
            
            # Read file data
            if isinstance(file_data, bytes):
                file_obj = io.BytesIO(file_data)
            else:
                file_obj = file_data
            
            client.upload_fileobj(file_obj, bucket, key, ExtraArgs=extra_args)
            logger.info(f"Uploaded to R2: {bucket}/{key}")
            return True
        
        except ClientError as e:
            logger.error(f"Failed to upload to R2: {e}")
            return False
    
    def download_file(self, bucket: str, key: str, max_retries: int = 5, retry_delay: float = 1.0) -> Optional[bytes]:
        """
        Download a file from R2 with retry logic for async upload race conditions
        
        Args:
            bucket: R2 bucket name
            key: Object key (path) in R2
            max_retries: Maximum number of retry attempts (default: 5)
            retry_delay: Delay in seconds between retries (default: 1.0)
        
        Returns:
            File contents as bytes, or None if failed after all retries
        """
        import time
        
        client = self.get_client()
        
        for attempt in range(max_retries):
            try:
                response = client.get_object(Bucket=bucket, Key=key)
                file_data = response['Body'].read()
                
                if attempt > 0:
                    logger.info(f"Downloaded from R2 on attempt {attempt + 1}: {bucket}/{key}")
                else:
                    logger.info(f"Downloaded from R2: {bucket}/{key}")
                return file_data
            
            except ClientError as e:
                error_code = e.response.get('Error', {}).get('Code', '')
                
                # If file not found and we have retries left, wait and retry
                if error_code == 'NoSuchKey' and attempt < max_retries - 1:
                    logger.warning(f"File not found (attempt {attempt + 1}/{max_retries}), retrying in {retry_delay}s: {bucket}/{key}")
                    time.sleep(retry_delay)
                    continue
                
                # For other errors or final attempt, log and return None
                if attempt == max_retries - 1:
                    logger.error(f"Failed to download from R2 after {max_retries} attempts: {e}")
                else:
                    logger.error(f"Failed to download from R2: {e}")
                return None
        
        return None
    
    def delete_file(self, bucket: str, key: str) -> bool:
        """
        Delete a file from R2
        
        Args:
            bucket: R2 bucket name
            key: Object key (path) in R2
        
        Returns:
            True if successful, False otherwise
        """
        try:
            client = self.get_client()
            client.delete_object(Bucket=bucket, Key=key)
            logger.info(f"Deleted from R2: {bucket}/{key}")
            return True
        
        except ClientError as e:
            logger.error(f"Failed to delete from R2: {e}")
            return False
    
    def list_files(self, bucket: str, prefix: str = None) -> list:
        """
        List files in R2 bucket
        
        Args:
            bucket: R2 bucket name
            prefix: Optional prefix to filter objects
        
        Returns:
            List of object keys
        """
        try:
            client = self.get_client()
            
            kwargs = {'Bucket': bucket}
            if prefix:
                kwargs['Prefix'] = prefix
            
            response = client.list_objects_v2(**kwargs)
            
            if 'Contents' not in response:
                return []
            
            return [obj['Key'] for obj in response['Contents']]
        
        except ClientError as e:
            logger.error(f"Failed to list R2 objects: {e}")
            return []
    
    def get_public_url(self, bucket: str, key: str) -> Optional[str]:
        """
        Get public URL for an R2 object (if public access is enabled)
        
        Args:
            bucket: R2 bucket name
            key: Object key (path) in R2
        
        Returns:
            Public URL string, or None if public base URL not configured
        """
        # Ensure configuration is loaded
        if self._public_base_url is None:
            r2_config = get_r2_config()
            if r2_config:
                self._public_base_url = r2_config.get("public_base_url")
        
        if self._public_base_url:
            # Remove trailing slash if present
            base_url = self._public_base_url.rstrip('/')
            # For R2 public URLs, the bucket name is NOT included in the path
            # Format: https://pub-xxx.r2.dev/{key}
            final_url = f"{base_url}/{key}"
            return final_url
        else:
            logger.warning(f"No public_base_url configured for {bucket}/{key}")
        
        return None
    
    def file_exists(self, bucket: str, key: str) -> bool:
        """
        Check if a file exists in R2
        
        Args:
            bucket: R2 bucket name
            key: Object key (path) in R2
        
        Returns:
            True if file exists, False otherwise
        """
        try:
            client = self.get_client()
            client.head_object(Bucket=bucket, Key=key)
            return True
        
        except ClientError:
            return False


# Global storage client instance
_storage_client: Optional[R2StorageClient] = None


def get_storage_client() -> R2StorageClient:
    """Get the global R2 storage client instance"""
    global _storage_client
    if _storage_client is None:
        _storage_client = R2StorageClient()
    return _storage_client
