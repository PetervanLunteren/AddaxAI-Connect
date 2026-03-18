"""
Dev tools endpoints for development and testing.

Provides tools for server admins to upload files to FTPS server.

Only accessible by server admins.
"""
import os
import io
import socket
import ftplib
from pathlib import Path
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from pydantic import BaseModel

from shared.models import User
from shared.config import get_settings
from shared.logger import get_logger
from auth.permissions import require_server_admin


router = APIRouter(prefix="/api/devtools", tags=["devtools"])
logger = get_logger("api.devtools")
settings = get_settings()


class UploadResponse(BaseModel):
    """Response for file upload"""
    success: bool
    filename: str
    message: str


def _upload_via_ftps(
    file_content: bytes,
    filename: str,
    host: str,
    port: int,
    username: str,
    password: str,
    use_tls: bool
) -> None:
    """
    Upload file via FTPS protocol.

    Args:
        file_content: File content as bytes
        filename: Target filename on server
        host: FTPS server hostname or IP
        port: FTPS server port (typically 21)
        username: FTP username
        password: FTP password
        use_tls: Whether to use TLS encryption

    Raises:
        socket.gaierror: Cannot resolve hostname
        socket.timeout: Connection timeout
        ConnectionRefusedError: FTPS server not running
        ftplib.error_perm: Authentication or permission failure
        Exception: Other FTP errors
    """
    ftp = None
    try:
        # Create FTP_TLS connection
        ftp = ftplib.FTP_TLS()

        # Set timeout to 30 seconds
        ftp.connect(host, port, timeout=30)

        # Login with credentials
        ftp.login(username, password)

        # Enable data channel encryption if TLS is enabled
        if use_tls:
            ftp.prot_p()

        # Switch to passive mode (required for firewalled servers)
        ftp.set_pasv(True)

        # Upload file using binary mode
        ftp.storbinary(f'STOR {filename}', io.BytesIO(file_content))

        logger.info(
            "FTPS upload successful",
            file_name=filename,
            host=host,
            size_bytes=len(file_content)
        )

    finally:
        # Clean up connection
        if ftp:
            try:
                ftp.quit()
            except Exception:
                # Ignore errors during cleanup
                pass


@router.post("/upload", response_model=UploadResponse)
async def upload_file_to_ftps(
    file: UploadFile = File(...),
    current_user: User = Depends(require_server_admin),
):
    """
    Upload file to FTPS server via actual FTPS protocol (server admin only)

    Tests the complete FTPS upload path that camera traps use.
    Connects to Pure-FTPd server on host machine and uploads via FTP over TLS.

    Args:
        file: File to upload (.jpg, .jpeg, .txt)
        current_user: Current authenticated server admin

    Returns:
        Upload result with detailed error messages

    Raises:
        HTTPException: If file type not allowed, FTPS connection fails, or upload fails
    """
    # Validate file extension
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()

    allowed_extensions = {'.jpg', '.jpeg', '.txt'}
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type {ext} not allowed. Allowed: {', '.join(allowed_extensions)}"
        )

    # Read FTPS connection configuration from environment
    ftps_host = os.getenv("FTPS_HOST", "host.docker.internal")
    ftps_port = int(os.getenv("FTPS_PORT", "21"))
    ftps_username = os.getenv("FTPS_USERNAME", "camera")
    ftps_password = os.getenv("FTPS_PASSWORD", "")
    ftps_use_tls = os.getenv("FTPS_USE_TLS", "true").lower() == "true"

    # Read file content
    content = await file.read()

    logger.info(
        "FTPS upload started",
        file_name=filename,
        user_id=current_user.id,
        user_email=current_user.email,
        ftps_host=ftps_host,
        ftps_port=ftps_port,
        ftps_username=ftps_username,
        size_bytes=len(content)
    )

    try:
        # Upload via FTPS protocol
        _upload_via_ftps(
            file_content=content,
            filename=filename,
            host=ftps_host,
            port=ftps_port,
            username=ftps_username,
            password=ftps_password,
            use_tls=ftps_use_tls
        )

        logger.info(
            "FTPS upload completed successfully",
            file_name=filename,
            user_email=current_user.email,
            size_bytes=len(content)
        )

        return UploadResponse(
            success=True,
            filename=filename,
            message=f"File uploaded successfully via FTPS to {ftps_host}:{ftps_port}"
        )

    except socket.gaierror as e:
        error_msg = f"Cannot resolve FTPS host '{ftps_host}': {str(e)}"
        logger.error(
            "FTPS upload failed - hostname resolution error",
            file_name=filename,
            ftps_host=ftps_host,
            error=error_msg,
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_msg
        )

    except socket.timeout as e:
        error_msg = f"Connection timeout to FTPS server {ftps_host}:{ftps_port}"
        logger.error(
            "FTPS upload failed - timeout",
            file_name=filename,
            ftps_host=ftps_host,
            ftps_port=ftps_port,
            error=error_msg,
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=error_msg
        )

    except ConnectionRefusedError as e:
        error_msg = f"FTPS server not running or refusing connections at {ftps_host}:{ftps_port}"
        logger.error(
            "FTPS upload failed - connection refused",
            file_name=filename,
            ftps_host=ftps_host,
            ftps_port=ftps_port,
            error=error_msg,
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error_msg
        )

    except ftplib.error_perm as e:
        error_code = str(e).split()[0] if str(e) else "unknown"
        if error_code == "530":
            error_msg = f"Authentication failed - check FTPS username/password (user: {ftps_username})"
        elif error_code == "550":
            error_msg = f"Permission denied - cannot write to upload directory"
        else:
            error_msg = f"FTPS permission error: {str(e)}"

        logger.error(
            "FTPS upload failed - permission error",
            file_name=filename,
            ftps_username=ftps_username,
            error=error_msg,
            error_code=error_code,
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=error_msg
        )

    except Exception as e:
        error_msg = f"FTPS upload failed: {str(e)}"
        logger.error(
            "FTPS upload failed - unexpected error",
            file_name=filename,
            error=error_msg,
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_msg
        )
