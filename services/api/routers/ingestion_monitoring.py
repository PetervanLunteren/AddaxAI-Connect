"""
Ingestion monitoring endpoints for superusers.

Provides visibility into rejected files and ingestion issues.
"""
import os
from typing import List
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from shared.models import User
from shared.config import get_settings
from shared.logger import get_logger
from auth.users import current_superuser


router = APIRouter(prefix="/api/ingestion-monitoring", tags=["ingestion-monitoring"])
logger = get_logger("api.ingestion_monitoring")
settings = get_settings()


class RejectedFileResponse(BaseModel):
    """Response model for rejected file"""
    filename: str
    reason: str  # Rejection reason (folder name)
    filepath: str
    timestamp: float  # File modification time (Unix timestamp)
    size_bytes: int
    imei: str | None = None  # Extracted IMEI if available


class RejectedFilesResponse(BaseModel):
    """Response model for rejected files grouped by reason"""
    total_count: int
    by_reason: dict[str, List[RejectedFileResponse]]


def scan_rejected_files() -> List[RejectedFileResponse]:
    """
    Scan rejected/ directory and return file information.

    Returns:
        List of rejected files with metadata
    """
    ftps_dir = os.getenv("FTPS_UPLOAD_DIR", "/uploads")
    rejected_dir = Path(ftps_dir) / "rejected"

    if not rejected_dir.exists():
        logger.warning("Rejected directory does not exist", path=str(rejected_dir))
        return []

    rejected_files = []

    # Iterate through rejection reason directories
    for reason_dir in rejected_dir.iterdir():
        if not reason_dir.is_dir():
            continue

        reason = reason_dir.name

        # Iterate through files in each reason directory
        for file_path in reason_dir.iterdir():
            if file_path.is_file():
                try:
                    stat = file_path.stat()

                    # Try to extract IMEI from filename if it matches pattern
                    # E.g., "0000000WUH09-SYPR1125.JPG" or "19122025162142-0000000WUH04-dailyreport.txt"
                    imei = None
                    filename = file_path.name

                    rejected_files.append(RejectedFileResponse(
                        filename=filename,
                        reason=reason,
                        filepath=str(file_path),
                        timestamp=stat.st_mtime,
                        size_bytes=stat.st_size,
                        imei=imei
                    ))
                except Exception as e:
                    logger.error(
                        "Failed to process rejected file",
                        file_path=str(file_path),
                        error=str(e)
                    )

    return rejected_files


@router.get(
    "/rejected-files",
    response_model=RejectedFilesResponse,
)
async def get_rejected_files(
    current_user: User = Depends(current_superuser),
):
    """
    Get all rejected files grouped by rejection reason (superuser only).

    Args:
        current_user: Current authenticated superuser

    Returns:
        Rejected files grouped by reason with metadata
    """
    rejected_files = scan_rejected_files()

    # Group by reason
    by_reason = {}
    for file in rejected_files:
        if file.reason not in by_reason:
            by_reason[file.reason] = []
        by_reason[file.reason].append(file)

    # Sort each reason's files by timestamp (newest first)
    for reason in by_reason:
        by_reason[reason].sort(key=lambda f: f.timestamp, reverse=True)

    return RejectedFilesResponse(
        total_count=len(rejected_files),
        by_reason=by_reason
    )
