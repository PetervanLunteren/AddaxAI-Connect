FROM python:3.11-slim

WORKDIR /app

# Same system deps as ingestion: exiftool for EXIF, libmagic for MIME.
RUN apt-get update && apt-get install -y --no-install-recommends \
    exiftool \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir setuptools wheel

# Shared library used by every service.
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# Service deps.
COPY services/bulk-upload/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Vendor the live ingestion service so the bulk worker can call its
# validation, EXIF, MinIO write, and DB record helpers without
# duplicating them. Mounted under /ingestion_lib and added to the
# Python path inside worker.py.
COPY services/ingestion /ingestion_lib

COPY services/bulk-upload .

CMD ["python", "worker.py"]
