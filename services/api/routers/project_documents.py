"""
Project document upload/download/delete endpoints

Per-project file storage for permits, field notes, config files, etc.
Admins can upload and delete; all project members can list and download.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
import io

from shared.models import User, ProjectDocument
from shared.database import get_async_session
from shared.storage import StorageClient, BUCKET_PROJECT_DOCUMENTS
from shared.logger import get_logger
from auth.permissions import require_project_access, require_project_admin_access

router = APIRouter(prefix="/api/projects/{project_id}/documents", tags=["project-documents"])
logger = get_logger("api.project_documents")

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.get("/")
async def list_documents(
    project_id: int,
    user: User = Depends(require_project_access),
    db: AsyncSession = Depends(get_async_session),
):
    """List all documents for a project, ordered by upload date descending."""
    query = (
        select(ProjectDocument)
        .where(ProjectDocument.project_id == project_id)
        .order_by(ProjectDocument.uploaded_at.desc())
    )
    result = await db.execute(query)
    documents = result.scalars().all()

    items = []
    for doc in documents:
        # Eagerly load the uploaded_by relationship
        await db.refresh(doc, ["uploaded_by"])
        items.append({
            "id": doc.id,
            "original_filename": doc.original_filename,
            "file_size": doc.file_size,
            "content_type": doc.content_type,
            "description": doc.description,
            "uploaded_by_email": doc.uploaded_by.email if doc.uploaded_by else None,
            "uploaded_at": doc.uploaded_at.isoformat(),
        })

    return items


@router.post("/", status_code=status.HTTP_201_CREATED)
async def upload_document(
    project_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Upload a document to the project (admin only). Max 10 MB."""
    # Read file content and check size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB.",
        )

    original_filename = file.filename or "unnamed"
    file_uuid = str(uuid.uuid4())
    storage_path = f"{project_id}/{file_uuid}_{original_filename}"

    # Upload to MinIO
    storage = StorageClient()
    storage.upload_fileobj(io.BytesIO(content), BUCKET_PROJECT_DOCUMENTS, storage_path)

    # Create database record
    doc = ProjectDocument(
        project_id=project_id,
        original_filename=original_filename,
        storage_path=storage_path,
        file_size=len(content),
        content_type=file.content_type,
        description=description,
        uploaded_by_user_id=user.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    logger.info(
        "Document uploaded",
        project_id=project_id,
        document_id=doc.id,
        filename=original_filename,
        size=len(content),
        user_id=user.id,
    )

    return {
        "id": doc.id,
        "original_filename": doc.original_filename,
        "file_size": doc.file_size,
        "content_type": doc.content_type,
        "description": doc.description,
        "uploaded_by_email": user.email,
        "uploaded_at": doc.uploaded_at.isoformat(),
    }


@router.get("/{document_id}/download")
async def download_document(
    project_id: int,
    document_id: int,
    user: User = Depends(require_project_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Download a project document."""
    query = select(ProjectDocument).where(
        ProjectDocument.id == document_id,
        ProjectDocument.project_id == project_id,
    )
    result = await db.execute(query)
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    # Download from MinIO
    storage = StorageClient()
    try:
        file_bytes = storage.download_fileobj(BUCKET_PROJECT_DOCUMENTS, doc.storage_path)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found in storage",
        )

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type=doc.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{doc.original_filename}"',
            "Content-Length": str(doc.file_size),
        },
    )


@router.delete("/{document_id}", status_code=status.HTTP_200_OK)
async def delete_document(
    project_id: int,
    document_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete a project document (admin only)."""
    query = select(ProjectDocument).where(
        ProjectDocument.id == document_id,
        ProjectDocument.project_id == project_id,
    )
    result = await db.execute(query)
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    # Delete from MinIO
    storage = StorageClient()
    try:
        storage.delete_object(BUCKET_PROJECT_DOCUMENTS, doc.storage_path)
    except Exception as e:
        logger.error("Failed to delete document from MinIO", error=str(e), storage_path=doc.storage_path)

    # Delete from database
    await db.delete(doc)
    await db.commit()

    logger.info(
        "Document deleted",
        project_id=project_id,
        document_id=document_id,
        filename=doc.original_filename,
        user_id=user.id,
    )

    return {"message": "Document deleted"}
