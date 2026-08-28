FROM python:3.11-slim

WORKDIR /app

# Service dependencies first, on their own, then the shared library, then the
# code, so a code change never throws away the cached dependency layer.
COPY services/notifications-earthranger/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy and install the shared library
COPY shared/ /app/shared/
RUN pip install --no-cache-dir /app/shared/

# pip only checks each install on its own; pip check fails the build when a
# later install downgraded what an earlier one needs.
RUN pip check

# Copy service files
COPY services/notifications-earthranger/ /app/

# Run worker
CMD ["python", "worker.py"]
