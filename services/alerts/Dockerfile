FROM python:3.11-slim

WORKDIR /app

# Copy and install shared library
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# Install service dependencies
COPY services/alerts/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code
COPY services/alerts .

CMD ["python", "worker.py"]
