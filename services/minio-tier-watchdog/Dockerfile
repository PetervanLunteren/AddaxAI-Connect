FROM python:3.11-slim

RUN pip install --no-cache-dir boto3==1.34.0 redis==5.0.1

# The installs above are separate pip commands, so pip only checks each one on
# its own: a later install can downgrade what an earlier one needs, print an
# ERROR line, and still exit 0. pip check turns that into a failed build.
RUN pip check

WORKDIR /app
COPY services/minio-tier-watchdog/watchdog.py /app/watchdog.py
COPY services/minio-tier-watchdog/healthcheck.py /app/healthcheck.py

CMD ["python", "-u", "/app/watchdog.py"]
