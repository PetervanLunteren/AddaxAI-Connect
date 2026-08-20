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
COPY services/notifications-email/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy and install the shared library
COPY shared/ /app/shared/
RUN pip install --no-cache-dir /app/shared/

# The installs above are separate pip commands, so pip only checks each one on
# its own: a later install can downgrade what an earlier one needs, print an
# ERROR line, and still exit 0. pip check turns that into a failed build.
RUN pip check

# Copy service files
COPY services/notifications-email/ /app/

# Run worker
CMD ["python", "worker.py"]
