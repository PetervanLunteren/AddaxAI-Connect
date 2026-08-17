FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    exiftool \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Install build tools for shared library
RUN pip install --no-cache-dir setuptools wheel

# Service dependencies first, then the shared library. `COPY shared` used to
# sit above this, so any change under shared/ threw away the cached dependency
# layer and reinstalled everything from the network. Shared changes on nearly
# every release; requirements.txt almost never does.
COPY services/ingestion/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy and install the shared library
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# Copy service code
COPY services/ingestion .

# Repo scripts that run against the ingestion code (dev simulator), mirroring
# how the api image carries /app/scripts.
COPY scripts /app/scripts

CMD ["python", "main.py"]
