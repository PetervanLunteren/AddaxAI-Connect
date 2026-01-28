"""
AddaxAI Connect API

FastAPI backend providing REST API and WebSocket endpoints.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from shared import __version__
from shared.config import get_settings
from shared.database import get_async_session
from shared.logger import get_logger
from auth.routes import get_auth_router
from routers import admin, logs, cameras, images, statistics, projects, devtools, ingestion_monitoring, project_images, notifications, users
from routers import health as health_router
from middleware.logging import RequestLoggingMiddleware

# Enable PIL to load truncated images from camera traps
from PIL import ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True

settings = get_settings()
logger = get_logger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    logger.info("Starting AddaxAI Connect API", version=__version__, environment=settings.environment)

    yield

    # Shutdown
    logger.info("Shutting down AddaxAI Connect API")


app = FastAPI(
    title="AddaxAI Connect API",
    description="Camera trap image processing platform",
    version=__version__,
    lifespan=lifespan,
)


# Middleware to inject database session into request state
@app.middleware("http")
async def db_session_middleware(request: Request, call_next):
    """
    Inject database session into request state.

    Required for FastAPI-Users UserManager to access database.
    """
    async for session in get_async_session():
        request.state.db = session
        response = await call_next(request)
        return response


# Request logging middleware (must be added BEFORE CORS)
app.add_middleware(RequestLoggingMiddleware)

# CORS middleware
cors_origins = settings.cors_origins.split(",") if hasattr(settings, "cors_origins") and settings.cors_origins else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health check endpoints
@app.get("/")
def root():
    """Root endpoint with version info"""
    return {
        "message": "AddaxAI Connect API",
        "status": "running",
        "version": __version__
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


# Include routers
app.include_router(get_auth_router())
app.include_router(admin.router)
app.include_router(users.router)
app.include_router(notifications.router)
app.include_router(logs.router, prefix="/api", tags=["logs"])
app.include_router(cameras.router)
app.include_router(images.router)
app.include_router(statistics.router)
app.include_router(projects.router)
app.include_router(project_images.router)
app.include_router(devtools.router)
app.include_router(ingestion_monitoring.router)
app.include_router(health_router.router)
