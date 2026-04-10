"""
Ingestion monitoring endpoints for server admins.

Provides visibility into rejected files and ingestion issues.
"""
import os
import json
import shutil
import subprocess
from typing import List
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from shared.models import User
from shared.config import get_settings
from shared.logger import get_logger
from auth.permissions import require_server_admin


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
    device_id: str | None = None  # Extracted device ID if available
    error_details: str | None = None  # Details from .error.json if available
    rejected_at: str | None = None  # ISO timestamp from .error.json
    exif_metadata: dict | None = None  # EXIF metadata from .error.json if available


class RejectedFilesResponse(BaseModel):
    """Response model for rejected files grouped by reason"""
    total_count: int
    by_reason: dict[str, List[RejectedFileResponse]]


class BulkActionRequest(BaseModel):
    """Request model for bulk actions on rejected files"""
    filepaths: List[str]


class BulkActionResponse(BaseModel):
    """Response model for bulk action results"""
    success_count: int
    failed_count: int
    errors: List[str] = []


class UploadFileResponse(BaseModel):
    """A file currently in the uploads folder awaiting processing"""
    filename: str
    filepath: str
    size_bytes: int
    timestamp: float  # File modification time (Unix timestamp)


class UploadFilesResponse(BaseModel):
    """Response for uploads folder contents"""
    total_count: int
    files: List[UploadFileResponse]


class TreeNodeResponse(BaseModel):
    """A single node (file or directory) in the uploads directory tree"""
    name: str
    type: str  # "file" or "directory"
    path: str  # Relative POSIX path from the upload root
    size_bytes: int | None = None  # Files only
    modified_at: float | None = None  # Unix timestamp, files only
    children: List["TreeNodeResponse"] | None = None  # Directories only


class UploadsTreeResponse(BaseModel):
    """Recursive tree of the uploads directory (excluding rejected/)"""
    tree: List[TreeNodeResponse]
    total_files: int
    total_dirs: int
    total_size_bytes: int


class DeleteUploadFileRequest(BaseModel):
    """Request to delete a single file from the uploads tree"""
    filepath: str  # Relative POSIX path from the upload root


def extract_device_id_from_file(file_path: Path) -> str | None:
    """
    Extract device ID from a file using exiftool.

    Args:
        file_path: Path to the file

    Returns:
        Device ID string if found, None otherwise
    """
    try:
        # Use exiftool to extract SerialNumber (device ID) from image files
        result = subprocess.run(
            ["exiftool", "-SerialNumber", "-s3", str(file_path)],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception as e:
        logger.debug(
            "Failed to extract device ID from file",
            file_path=str(file_path),
            error=str(e)
        )

    return None


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
                    # Skip .error.json files - we'll read them for the corresponding file
                    if file_path.suffix == '.json' and file_path.stem.endswith('.error'):
                        continue

                    stat = file_path.stat()
                    filename = file_path.name

                    # Extract device ID from file EXIF data
                    # Only attempt for image files to avoid processing daily reports unnecessarily
                    device_id = None
                    if file_path.suffix.lower() in ['.jpg', '.jpeg']:
                        device_id = extract_device_id_from_file(file_path)

                    # Try to read error details from corresponding .error.json file
                    error_details = None
                    rejected_at = None
                    exif_metadata = None
                    error_json_path = file_path.parent / f"{filename}.error.json"
                    if error_json_path.exists():
                        try:
                            with open(error_json_path, 'r') as f:
                                error_data = json.load(f)
                                error_details = error_data.get('details')
                                rejected_at = error_data.get('rejected_at')
                                exif_metadata = error_data.get('exif_metadata')
                                # If device ID wasn't extracted from EXIF, try to get it from error details
                                if not device_id and error_details:
                                    # Match both old "IMEI:" and new "Device ID:" formats
                                    import re
                                    match = re.search(r'(?:IMEI|Device ID):\s*(\S+)', error_details)
                                    if match:
                                        device_id = match.group(1)
                        except Exception as e:
                            logger.debug(
                                "Failed to read error JSON",
                                error_json=str(error_json_path),
                                error=str(e)
                            )

                    rejected_files.append(RejectedFileResponse(
                        filename=filename,
                        reason=reason,
                        filepath=str(file_path),
                        timestamp=stat.st_mtime,
                        size_bytes=stat.st_size,
                        device_id=device_id,
                        error_details=error_details,
                        rejected_at=rejected_at,
                        exif_metadata=exif_metadata
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
    current_user: User = Depends(require_server_admin),
):
    """
    Get all rejected files grouped by rejection reason (server admin only)

    Args:
        current_user: Current authenticated server admin

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


@router.post(
    "/rejected-files/delete",
    response_model=BulkActionResponse,
)
async def delete_rejected_files(
    request: BulkActionRequest,
    current_user: User = Depends(require_server_admin),
):
    """
    Delete rejected files and their error logs (server admin only)

    Args:
        request: List of file paths to delete
        current_user: Current authenticated server admin

    Returns:
        Count of successfully deleted files and any errors
    """
    success_count = 0
    failed_count = 0
    errors = []

    for filepath_str in request.filepaths:
        try:
            filepath = Path(filepath_str)

            # Verify file is in rejected directory (security check)
            if "rejected" not in filepath.parts:
                errors.append(f"File not in rejected directory: {filepath.name}")
                failed_count += 1
                continue

            # Delete the main file
            if filepath.exists():
                filepath.unlink()
                logger.info("Deleted rejected file", filepath=str(filepath))

            # Delete corresponding .error.json file
            error_json_path = filepath.parent / f"{filepath.name}.error.json"
            if error_json_path.exists():
                error_json_path.unlink()

            success_count += 1

        except Exception as e:
            logger.error(
                "Failed to delete rejected file",
                filepath=filepath_str,
                error=str(e)
            )
            errors.append(f"{Path(filepath_str).name}: {str(e)}")
            failed_count += 1

    return BulkActionResponse(
        success_count=success_count,
        failed_count=failed_count,
        errors=errors
    )


@router.post(
    "/rejected-files/reprocess",
    response_model=BulkActionResponse,
)
async def reprocess_rejected_files(
    request: BulkActionRequest,
    current_user: User = Depends(require_server_admin),
):
    """
    Move rejected files back to uploads directory for reprocessing (server admin only)

    Args:
        request: List of file paths to reprocess
        current_user: Current authenticated server admin

    Returns:
        Count of successfully moved files and any errors
    """
    ftps_dir = os.getenv("FTPS_UPLOAD_DIR", "/uploads")
    uploads_dir = Path(ftps_dir)

    success_count = 0
    failed_count = 0
    errors = []

    for filepath_str in request.filepaths:
        try:
            filepath = Path(filepath_str)

            # Verify file is in rejected directory (security check)
            if "rejected" not in filepath.parts:
                errors.append(f"File not in rejected directory: {filepath.name}")
                failed_count += 1
                continue

            if not filepath.exists():
                errors.append(f"File not found: {filepath.name}")
                failed_count += 1
                continue

            # Move file to uploads directory
            destination = uploads_dir / filepath.name
            shutil.move(str(filepath), str(destination))
            logger.info(
                "Moved file for reprocessing",
                from_path=str(filepath),
                to_path=str(destination)
            )

            # Delete corresponding .error.json file
            error_json_path = filepath.parent / f"{filepath.name}.error.json"
            if error_json_path.exists():
                error_json_path.unlink()

            success_count += 1

        except Exception as e:
            logger.error(
                "Failed to reprocess rejected file",
                filepath=filepath_str,
                error=str(e)
            )
            errors.append(f"{Path(filepath_str).name}: {str(e)}")
            failed_count += 1

    return BulkActionResponse(
        success_count=success_count,
        failed_count=failed_count,
        errors=errors
    )


def scan_upload_files() -> List[UploadFileResponse]:
    """
    Scan uploads root directory for files awaiting processing.

    Only includes regular files with expected extensions (.jpg, .jpeg, .txt).
    Skips hidden files (e.g. .pureftpd-upload.*) and directories.

    Returns:
        List of files in the uploads root directory
    """
    ftps_dir = os.getenv("FTPS_UPLOAD_DIR", "/uploads")
    upload_dir = Path(ftps_dir)

    if not upload_dir.exists():
        logger.warning("Upload directory does not exist", path=str(upload_dir))
        return []

    upload_files = []
    allowed_extensions = {'jpg', 'jpeg', 'txt'}

    for file_path in upload_dir.iterdir():
        if not file_path.is_file():
            continue

        # Skip hidden files (Pure-FTPd temp uploads, etc.)
        if file_path.name.startswith('.'):
            continue

        # Check file extension, handling AutoRename suffixes (.jpg.1, .txt.3)
        # Uses same logic as ingestion service (services/ingestion/main.py lines 120-125)
        parts = file_path.name.lower().split('.')
        ext = parts[-1] if len(parts) > 1 else ''

        # If extension is numeric (AutoRename suffix), use second-to-last part
        if ext.isdigit() and len(parts) > 2:
            ext = parts[-2]

        if ext not in allowed_extensions:
            continue

        try:
            stat = file_path.stat()
            upload_files.append(UploadFileResponse(
                filename=file_path.name,
                filepath=str(file_path),
                size_bytes=stat.st_size,
                timestamp=stat.st_mtime,
            ))
        except Exception as e:
            logger.error(
                "Failed to stat upload file",
                file_path=str(file_path),
                error=str(e),
            )

    return upload_files


@router.get(
    "/upload-files",
    response_model=UploadFilesResponse,
)
async def get_upload_files(
    current_user: User = Depends(require_server_admin),
):
    """
    Get files currently in the uploads folder awaiting processing (server admin only).

    The uploads folder should normally be empty. Files lingering here
    may indicate the ingestion service has crashed or stalled.

    Args:
        current_user: Current authenticated server admin

    Returns:
        List of files in uploads folder sorted by timestamp (oldest first)
    """
    upload_files = scan_upload_files()

    # Sort by timestamp, oldest first (stuck files are most interesting)
    upload_files.sort(key=lambda f: f.timestamp)

    return UploadFilesResponse(
        total_count=len(upload_files),
        files=upload_files,
    )


# ---------------------------------------------------------------------------
# Uploads directory tree
# ---------------------------------------------------------------------------

def build_uploads_tree(
    directory: Path,
    upload_root: Path,
) -> tuple[List[TreeNodeResponse], int, int, int]:
    """
    Recursively build a nested tree of the given directory.

    Skips hidden files (dot-prefixed) and the ``rejected/`` subtree (that
    has its own card on the page). Directories are sorted before files;
    both are alphabetical.

    Returns:
        (tree_nodes, total_files, total_dirs, total_size_bytes)
    """
    dirs: list[TreeNodeResponse] = []
    files: list[TreeNodeResponse] = []
    total_files = 0
    total_dirs = 0
    total_size = 0

    try:
        entries = sorted(directory.iterdir(), key=lambda p: p.name)
    except PermissionError:
        return [], 0, 0, 0

    for entry in entries:
        if entry.name.startswith("."):
            continue

        rel_path = entry.relative_to(upload_root).as_posix()

        if entry.is_dir():
            # Skip the rejected/ subtree entirely
            if entry.name == "rejected" and entry.parent == upload_root:
                continue

            children, child_files, child_dirs, child_size = build_uploads_tree(
                entry, upload_root
            )
            total_files += child_files
            total_dirs += child_dirs + 1
            total_size += child_size

            dirs.append(TreeNodeResponse(
                name=entry.name,
                type="directory",
                path=rel_path,
                children=children,
            ))
        elif entry.is_file():
            try:
                stat = entry.stat()
            except OSError:
                continue
            total_files += 1
            total_size += stat.st_size

            files.append(TreeNodeResponse(
                name=entry.name,
                type="file",
                path=rel_path,
                size_bytes=stat.st_size,
                modified_at=stat.st_mtime,
            ))

    return dirs + files, total_files, total_dirs, total_size


@router.get(
    "/uploads-tree",
    response_model=UploadsTreeResponse,
)
async def get_uploads_tree(
    current_user: User = Depends(require_server_admin),
):
    """
    Get the recursive directory tree of the uploads folder (server admin only).

    Excludes the ``rejected/`` subtree (shown in the Rejected files card)
    and hidden files (Pure-FTPd temp uploads, etc.).
    """
    ftps_dir = os.getenv("FTPS_UPLOAD_DIR", "/uploads")
    upload_root = Path(ftps_dir)

    if not upload_root.exists():
        return UploadsTreeResponse(tree=[], total_files=0, total_dirs=0, total_size_bytes=0)

    tree, total_files, total_dirs, total_size = build_uploads_tree(upload_root, upload_root)

    return UploadsTreeResponse(
        tree=tree,
        total_files=total_files,
        total_dirs=total_dirs,
        total_size_bytes=total_size,
    )


@router.post("/uploads-tree/delete")
async def delete_upload_file(
    request: DeleteUploadFileRequest,
    current_user: User = Depends(require_server_admin),
):
    """
    Delete a single file from the uploads directory (server admin only).

    Security: rejects paths that escape the upload root, target the
    rejected/ subtree, or point to a directory.
    """
    ftps_dir = os.getenv("FTPS_UPLOAD_DIR", "/uploads")
    upload_root = Path(ftps_dir).resolve()

    # Resolve the requested path against the upload root
    target = (upload_root / request.filepath).resolve()

    # Path traversal guard
    if not str(target).startswith(str(upload_root)):
        raise HTTPException(status_code=400, detail="Path escapes the upload directory")

    # Reject deletions inside the rejected/ subtree
    try:
        rel = target.relative_to(upload_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path escapes the upload directory")

    if rel.parts and rel.parts[0] == "rejected":
        raise HTTPException(status_code=400, detail="Use the Rejected files card to manage rejected files")

    # Only delete files, not directories
    if target.is_dir():
        raise HTTPException(status_code=400, detail="Cannot delete directories, only individual files")

    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found (may have been processed already)")

    # Delete the file
    try:
        target.unlink()
        logger.info("Deleted upload file via admin", filepath=str(target), user=current_user.email)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {e}")

    # Prune empty parent directories up to (but not including) the upload root
    current = target.parent
    while current != upload_root:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent

    return {"success": True}
