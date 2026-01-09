FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy shared library
COPY shared/ /app/shared/
RUN pip install --no-cache-dir /app/shared/

# Copy service files
COPY services/notifications-telegram/ /app/

# Install service dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Run worker
CMD ["python", "worker.py"]
