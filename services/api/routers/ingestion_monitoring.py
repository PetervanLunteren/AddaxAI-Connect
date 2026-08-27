"""
Ingestion monitoring endpoints for server admins.

Provides visibility into rejected files and ingestion issues.

Rejected files are read from the rejections table, the same rows the Live
feed and the per-camera count use. The bytes sit under
<upload_root>/rejected/<reason>/ and both the api and ingestion containers
mount that volume, so delete and reprocess act on the file the row points at.
"""
import os
import shutil
from typing import List, Optional
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User, Rejection
from shared.config import get_settings
from shared.database import get_async_session
from shared.logger import get_logger
from auth.permissions import require_server_admin


router = APIRouter(prefix="/api/ingestion-monitoring", tags=["ingestion-monitoring"])
logger = get_logger("api.ingestion_monitoring")
settings = get_settings()


class RejectedFileResponse(BaseModel):
    """One rejected file, straight from its Rejection row"""
    id: int
    filename: str  # original camera filename
    reason: str
    details: str | None = None
    device_id: str | None = None
    project_id: int | None = None
    filepath: str  # where the bytes sit now, under rejected/
    size_bytes: int | None = None
    rejected_at: str  # server wall-clock, ISO 8601
    captured_at: str | None = None  # camera clock, naive ISO
    exif_metadata: dict | None = None


class RejectedFilesResponse(BaseModel):
    """Response model for rejected files grouped by reason"""
    total_count: int
    by_reason: dict[str, List[RejectedFileResponse]]


class BulkActionRequest(BaseModel):
    """Rejection row ids to act on"""
    ids: List[int]


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


def _upload_root() -> Path:
    return Path(os.getenv("FTPS_UPLOAD_DIR", "/uploads"))


def _rejection_to_response(row: Rejection) -> RejectedFileResponse:
    return RejectedFileResponse(
        id=row.id,
        filename=row.filename,
        reason=row.reason,
        details=row.details,
        device_id=row.device_id,
        project_id=row.project_id,
        filepath=row.disk_path,
        size_bytes=row.file_size_bytes,
        rejected_at=row.rejected_at.isoformat(),
        captured_at=row.captured_at.isoformat() if row.captured_at else None,
        exif_metadata=row.exif_metadata,
    )


def reprocess_destination(upload_root: Path, source_path: Optional[str], disk_path: str) -> Path:
    """Where a rejected file goes back to for reprocessing.

    The original relative path when the row has one, so a path-based camera
    profile (INSTAR reads lat/lon from the directory name) identifies the
    file again. Rows from before source_path existed fall back to the upload
    root under the file's current name, which is what reprocess always did.

    Pure so it is unit-testable; the path-escape guard lives here too.
    """
    root = upload_root.resolve()
    if source_path:
        target = (root / source_path).resolve()
        if root in target.parents:
            return target
        # A row with a broken source_path must not become a write outside
        # the upload tree. Fall through to the safe default.
        logger.warning("Ignoring source_path outside the upload root", source_path=source_path)
    return root / Path(disk_path).name


def _remove_legacy_sidecar(disk_path: Path) -> None:
    """Rows written before 2026-08-27 had a .error.json next to the file.
    Ingestion no longer writes it; remove it with the file so nothing is
    left behind. Can go once every server has passed one retention window."""
    Path(f"{disk_path}.error.json").unlink(missing_ok=True)


def _in_rejected_tree(path: Path) -> bool:
    """Security check: the file a row points at must sit under rejected/."""
    return (_upload_root() / "rejected").resolve() in path.resolve().parents


async def _load_rows(db: AsyncSession, ids: List[int]) -> List[Rejection]:
    if not ids:
        return []
    return list(
        (await db.execute(select(Rejection).where(Rejection.id.in_(ids)))).scalars().all()
    )


@router.get(
    "/rejected-files",
    response_model=RejectedFilesResponse,
)
async def get_rejected_files(
    current_user: User = Depends(require_server_admin),
    db: AsyncSession = Depends(get_async_session),
):
    """
    All rejected files grouped by rejection reason, newest first (server admin only).

    Every row still within the 30-day retention, whether or not it resolved
    to a project. Server admins see the unresolved ones here and nowhere else.
    """
    rows = (
        await db.execute(select(Rejection).order_by(Rejection.rejected_at.desc()))
    ).scalars().all()

    by_reason: dict[str, List[RejectedFileResponse]] = {}
    for row in rows:
        by_reason.setdefault(row.reason, []).append(_rejection_to_response(row))

    return RejectedFilesResponse(total_count=len(rows), by_reason=by_reason)


@router.post(
    "/rejected-files/delete",
    response_model=BulkActionResponse,
)
async def delete_rejected_files(
    request: BulkActionRequest,
    current_user: User = Depends(require_server_admin),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Delete rejected files and their rows (server admin only).

    The row goes even when the bytes are already gone (retention ran, or
    a manual cleanup), so the page never shows a phantom.
    """
    rows = await _load_rows(db, request.ids)
    found = {row.id for row in rows}
    errors = [f"Rejection {rid} not found" for rid in request.ids if rid not in found]
    success_count = 0

    for row in rows:
        filepath = Path(row.disk_path)
        try:
            if not _in_rejected_tree(filepath):
                errors.append(f"File not in rejected directory: {filepath.name}")
                continue

            if filepath.exists():
                filepath.unlink()
                logger.info("Deleted rejected file", filepath=str(filepath))
            _remove_legacy_sidecar(filepath)

            await db.delete(row)
            success_count += 1

        except Exception as e:
            logger.error(
                "Failed to delete rejected file",
                filepath=str(filepath),
                error=str(e)
            )
            errors.append(f"{filepath.name}: {str(e)}")

    await db.commit()

    return BulkActionResponse(
        success_count=success_count,
        failed_count=len(errors),
        errors=errors
    )


@router.post(
    "/rejected-files/reprocess",
    response_model=BulkActionResponse,
)
async def reprocess_rejected_files(
    request: BulkActionRequest,
    current_user: User = Depends(require_server_admin),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Move rejected files back into the upload tree for reprocessing (server admin only).

    The file returns to the path the camera uploaded it on (see
    reprocess_destination), ingestion picks up the move event and writes a
    fresh row if it rejects again. The old row is dropped with the move.
    """
    rows = await _load_rows(db, request.ids)
    found = {row.id for row in rows}
    errors = [f"Rejection {rid} not found" for rid in request.ids if rid not in found]
    success_count = 0
    upload_root = _upload_root()

    for row in rows:
        filepath = Path(row.disk_path)
        try:
            if not _in_rejected_tree(filepath):
                errors.append(f"File not in rejected directory: {filepath.name}")
                continue

            if not filepath.exists():
                errors.append(f"File not found: {row.filename}")
                continue

            destination = reprocess_destination(upload_root, row.source_path, row.disk_path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(filepath), str(destination))
            _remove_legacy_sidecar(filepath)
            logger.info(
                "Moved file for reprocessing",
                from_path=str(filepath),
                to_path=str(destination)
            )

            await db.delete(row)
            success_count += 1

        except Exception as e:
            logger.error(
                "Failed to reprocess rejected file",
                filepath=str(filepath),
                error=str(e)
            )
            errors.append(f"{filepath.name}: {str(e)}")

    await db.commit()

    return BulkActionResponse(
        success_count=success_count,
        failed_count=len(errors),
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
    upload_dir = _upload_root()

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
    upload_root = _upload_root()

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
    upload_root = _upload_root().resolve()

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
