FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    exiftool \
    && rm -rf /var/lib/apt/lists/*

# Install build tools for shared library
RUN pip install --no-cache-dir setuptools wheel

# Copy and install shared library first (from repo root context)
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# Install API dependencies
COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Force bcrypt 3.2.2 to override any newer version pulled by dependencies
RUN pip install --force-reinstall --no-cache-dir bcrypt==3.2.2

# Copy API code
COPY services/api .

# Copy scripts directory (for superuser creation, etc.)
COPY scripts /app/scripts

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
