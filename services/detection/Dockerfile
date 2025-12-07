FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for image processing
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install build tools for shared library
RUN pip install --no-cache-dir setuptools wheel

# Copy and install shared library
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# Install service dependencies
COPY services/detection/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code
COPY services/detection .

CMD ["python", "worker.py"]
