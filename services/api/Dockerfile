FROM python:3.11-slim

WORKDIR /app

# Install setuptools for editable installs
RUN pip install --no-cache-dir setuptools

# Copy and install shared library first (from repo root context)
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# Install API dependencies
COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy API code
COPY services/api .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
