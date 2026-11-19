FROM python:3.11-slim

WORKDIR /app

# boto3, redis and the database driver all come pinned with the shared
# library, which also holds the Image model and the cold tag.
COPY shared/ /app/shared/
RUN pip install --no-cache-dir /app/shared/

# pip can print a dependency ERROR line and still exit 0. pip check turns
# that into a failed build.
RUN pip check

COPY services/minio-tier-watchdog/watchdog.py /app/watchdog.py
COPY services/minio-tier-watchdog/healthcheck.py /app/healthcheck.py

CMD ["python", "-u", "/app/watchdog.py"]
