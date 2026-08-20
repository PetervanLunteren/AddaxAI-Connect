FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for image processing
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install build tools for shared library
RUN pip install --no-cache-dir setuptools wheel

# Service dependencies first, then the shared library. `COPY shared` used to
# sit above this, so any change under shared/ threw away the cached dependency
# layer and reinstalled everything from the network. Shared changes on nearly
# every release; requirements.txt almost never does.
COPY services/classification-speciesnet/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy and install the shared library
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# The installs above are separate pip commands, so pip only checks each one on
# its own: a later install can downgrade what an earlier one needs, print an
# ERROR line, and still exit 0. pip check turns that into a failed build.
RUN pip check

# Copy service code
COPY services/classification-speciesnet .

CMD ["python", "worker.py"]
