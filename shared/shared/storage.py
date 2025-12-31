"""
MinIO/S3 storage client wrapper

Provides simple interface for uploading/downloading objects from MinIO.
"""
import boto3
from botocore.client import Config
from typing import BinaryIO, Optional
from pathlib import Path

from .config import get_settings

settings = get_settings()


class StorageClient:
    """
    MinIO/S3 client wrapper.

    Provides methods for uploading, downloading, and managing objects.
    """

    def __init__(self):
        self.client = boto3.client(
            's3',
            endpoint_url=f"http://{settings.minio_endpoint}",
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
            config=Config(signature_version='s3v4', s3={'addressing_style': 'path'}),
            region_name='us-east-1'
        )

    def upload_file(self, file_path: str, bucket: str, object_name: Optional[str] = None) -> str:
        """
        Upload file to MinIO.

        Args:
            file_path: Local file path
            bucket: Bucket name
            object_name: Object name in bucket (defaults to filename)

        Returns:
            Object name in bucket
        """
        if object_name is None:
            object_name = Path(file_path).name

        self.client.upload_file(file_path, bucket, object_name)
        return object_name

    def upload_fileobj(self, file_obj: BinaryIO, bucket: str, object_name: str) -> str:
        """
        Upload file object to MinIO.

        Args:
            file_obj: File-like object
            bucket: Bucket name
            object_name: Object name in bucket

        Returns:
            Object name in bucket
        """
        self.client.upload_fileobj(file_obj, bucket, object_name)
        return object_name

    def download_file(self, bucket: str, object_name: str, file_path: str) -> None:
        """
        Download file from MinIO.

        Args:
            bucket: Bucket name
            object_name: Object name in bucket
            file_path: Local destination path
        """
        self.client.download_file(bucket, object_name, file_path)

    def download_fileobj(self, bucket: str, object_name: str) -> bytes:
        """
        Download file as bytes from MinIO.

        Args:
            bucket: Bucket name
            object_name: Object name in bucket

        Returns:
            File contents as bytes
        """
        response = self.client.get_object(Bucket=bucket, Key=object_name)
        return response['Body'].read()

    def delete_object(self, bucket: str, object_name: str) -> None:
        """
        Delete object from MinIO.

        Args:
            bucket: Bucket name
            object_name: Object name
        """
        self.client.delete_object(Bucket=bucket, Key=object_name)

    def list_objects(self, bucket: str, prefix: Optional[str] = None) -> list[str]:
        """
        List objects in bucket.

        Args:
            bucket: Bucket name
            prefix: Filter by prefix (optional)

        Returns:
            List of object names
        """
        kwargs = {'Bucket': bucket}
        if prefix:
            kwargs['Prefix'] = prefix

        response = self.client.list_objects_v2(**kwargs)
        if 'Contents' not in response:
            return []

        return [obj['Key'] for obj in response['Contents']]


# Bucket names (constants)
BUCKET_RAW_IMAGES = "raw-images"
BUCKET_CROPS = "crops"
BUCKET_THUMBNAILS = "thumbnails"
BUCKET_MODELS = "models"
BUCKET_PROJECT_IMAGES = "project-images"
