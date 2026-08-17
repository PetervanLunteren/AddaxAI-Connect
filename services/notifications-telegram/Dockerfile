FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Service dependencies first, on their own, then the shared library, then the
# code. Requirements used to arrive with the service files and be installed
# after shared/, so both a code change and a shared change threw away the
# cached dependency layer and reinstalled everything from the network. Only
# requirements.txt should do that, and it almost never changes.
COPY services/notifications-telegram/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy and install the shared library
COPY shared/ /app/shared/
RUN pip install --no-cache-dir /app/shared/

# Copy service files
COPY services/notifications-telegram/ /app/

# Run worker
CMD ["python", "worker.py"]
