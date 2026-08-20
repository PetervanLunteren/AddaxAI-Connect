FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (including Chromium dependencies for Playwright)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    exiftool \
    # Chromium/Playwright dependencies
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libexpat1 \
    libxcb1 \
    && rm -rf /var/lib/apt/lists/*

# Install build tools for shared library
RUN pip install --no-cache-dir setuptools wheel

# Service dependencies first, then the shared library. `COPY shared` used to
# sit above this, so any change under shared/ threw away the cached dependency
# layer and reinstalled everything from the network. Shared changes on nearly
# every release; requirements.txt almost never does.
COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy and install the shared library
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# The installs above are separate pip commands, so pip only checks each one on
# its own: a later install can downgrade what an earlier one needs, print an
# ERROR line, and still exit 0. pip check turns that into a failed build.
RUN pip check

# Install Playwright browsers (Chromium only for annotated image generation)
# Note: Using standalone install without --with-deps to avoid Debian Trixie font package conflicts
RUN playwright install chromium

# Copy API code
COPY services/api .

# Copy scripts directory (for superuser creation, etc.)
COPY scripts /app/scripts

# Copy version file (maintained by GitHub Actions)
COPY VERSION /app/VERSION

# Bake in the commit hash the image was built from, shown on the About page
# next to the version tag. BuildKit bind-mounts .git from the build context
# during this step only, so the 22 MB .git directory never lands in a layer.
RUN --mount=type=bind,source=.git,target=/app/.git \
    git -C /app rev-parse --short HEAD > /app/COMMIT

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
