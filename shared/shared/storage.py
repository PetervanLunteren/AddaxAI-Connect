"""
MinIO/S3 storage client wrapper

Provides simple interface for uploading/downloading objects from MinIO.
"""
import asyncio

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from typing import BinaryIO, Optional
from pathlib import Path

from .config import get_settings

settings = get_settings()


class StorageObjectNotFound(Exception):
    """The object is not in the bucket.

    Separate from every other storage failure on purpose. A row pointing at an
    object that is gone is a 404 for the caller, while a broken connection or a
    permission problem is a 500, and the two used to be indistinguishable
    because every call site caught bare Exception and answered 500. That turned
    a missing picture into a server error, leaked the raw storage message to
    the client, and hid genuine outages among the noise.
    """


def _raise_if_missing(err: ClientError, bucket: str, object_name: str) -> None:
    """Translate the boto3 not-found codes, leave anything else alone."""
    code = err.response.get("Error", {}).get("Code", "")
    if code in ("NoSuchKey", "404", "NotFound"):
        raise StorageObjectNotFound(f"{bucket}/{object_name}") from err


_shared_client = None


def _get_boto_client():
    """One boto3 client per process, built on first use.

    Building a client is expensive: measured at 47 ms cold and about 13 ms
    warm inside the API container, against a 4.7 ms fetch of the object it
    was built to get. The API constructs a StorageClient in eighteen places,
    most of them per request, so a grid of thumbnails paid that cost once per
    picture.

    Sharing one is safe. AWS documents that "unlike Resources and Sessions,
    clients are generally thread-safe", which covers both the threadpool
    FastAPI uses for sync endpoints and download_fileobj_async below. The
    documented caveat is processes, not threads: a client must not be shared
    across a fork. It is not, because this is built lazily on first use, so
    each uvicorn worker and each service process makes its own.
    """
    global _shared_client
    if _shared_client is None:
        _shared_client = boto3.client(
            's3',
            endpoint_url=f"http://{settings.minio_endpoint}",
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
            config=Config(signature_version='s3v4', s3={'addressing_style': 'path'}),
            region_name='us-east-1'
        )
    return _shared_client


class StorageClient:
    """
    MinIO/S3 client wrapper.

    Provides methods for uploading, downloading, and managing objects.

    Cheap to construct: every instance shares the one boto3 client for this
    process, so the existing call sites did not have to change.
    """

    def __init__(self):
        self.client = _get_boto_client()

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

        Raises:
            StorageObjectNotFound: the object is not in the bucket
        """
        try:
            response = self.client.get_object(Bucket=bucket, Key=object_name)
        except ClientError as e:
            _raise_if_missing(e, bucket, object_name)
            raise
        return response['Body'].read()

    async def download_fileobj_async(self, bucket: str, object_name: str) -> bytes:
        """
        download_fileobj for an async caller, off the event loop.

        boto3 is synchronous, so calling download_fileobj straight from an
        `async def` handler stops the whole loop until MinIO answers. That is
        what made a grid of thumbnails serialise: with more browser
        connections the page got slower, not faster (24 thumbnails took 2.92 s
        at one at a time, 1.59 s at six, and 2.44 s at twelve).

        Raises StorageObjectNotFound exactly as the sync version does.
        """
        return await asyncio.to_thread(self.download_fileobj, bucket, object_name)

    def tag_object_cold(self, bucket: str, object_name: str) -> None:
        """
        Tag an object tier=cold so the cold-tier ILM rule transitions it to
        remote storage. When the cold tier is disabled there is no rule to
        act on the tag, so this is harmless (the tag just sits there).

        Args:
            bucket: Bucket name
            object_name: Object name in bucket
        """
        self.client.put_object_tagging(
            Bucket=bucket,
            Key=object_name,
            Tagging={"TagSet": [{"Key": "tier", "Value": "cold"}]},
        )

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
BUCKET_PROJECT_DOCUMENTS = "project-documents"
# Bulk-upload ZIPs are streamed to this bucket from the API and consumed
# by the bulk-upload worker, which deletes the object once the job
# finishes. Not part of cold-tier ILM, no versioning.
BUCKET_BULK_UPLOAD_STAGING = "bulk-upload-staging"
