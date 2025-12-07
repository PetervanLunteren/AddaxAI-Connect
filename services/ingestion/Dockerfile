FROM python:3.11-slim

WORKDIR /app

# Install build tools for shared library
RUN pip install --no-cache-dir setuptools wheel

# Copy and install shared library
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# Install service dependencies
COPY services/ingestion/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code
COPY services/ingestion .

CMD ["python", "main.py"]
