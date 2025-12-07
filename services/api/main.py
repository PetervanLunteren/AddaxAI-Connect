"""
AddaxAI Connect API

FastAPI backend providing REST API and WebSocket endpoints.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="AddaxAI Connect API",
    description="Camera trap image processing platform",
    version="0.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: Configure from environment
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "AddaxAI Connect API", "status": "running"}


@app.get("/health")
def health():
    return {"status": "healthy"}


# TODO: Add routers
# from routers import images, cameras, stats, auth
# app.include_router(auth.router, prefix="/auth", tags=["auth"])
# app.include_router(images.router, prefix="/api/images", tags=["images"])
# app.include_router(cameras.router, prefix="/api/cameras", tags=["cameras"])
# app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
