FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for image processing
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install build tools for shared library
RUN pip install --no-cache-dir setuptools wheel

# Service dependencies first, then the shared library. That order matters:
# `COPY shared` used to sit above this, so any change under shared/ threw away
# the cached dependency layer and reinstalled everything from the network. On
# 17 Aug 2026 that made an update impossible for 26 minutes, because
# megadetector pulls ultralytics-yolov5, whose setup.py downloads its README
# from raw.githubusercontent.com, and GitHub was rate-limiting. Shared changes
# on nearly every release; requirements.txt almost never does.
COPY services/detection/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy and install the shared library
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# Copy service code
COPY services/detection .

CMD ["python", "worker.py"]
