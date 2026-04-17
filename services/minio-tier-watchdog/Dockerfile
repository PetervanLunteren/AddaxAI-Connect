FROM python:3.11-slim

RUN pip install --no-cache-dir boto3==1.34.0 redis==5.0.1

WORKDIR /app
COPY services/minio-tier-watchdog/watchdog.py /app/watchdog.py
COPY services/minio-tier-watchdog/healthcheck.py /app/healthcheck.py

CMD ["python", "-u", "/app/watchdog.py"]
