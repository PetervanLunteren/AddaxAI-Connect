FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (including Chromium dependencies for Playwright)
RUN apt-get update && apt-get install -y --no-install-recommends \
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

# Copy and install shared library first (from repo root context)
COPY shared /shared
RUN pip install --no-cache-dir -e /shared

# Install API dependencies
COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Force bcrypt 3.2.2 to override any newer version pulled by dependencies
RUN pip install --force-reinstall --no-cache-dir bcrypt==3.2.2

# Install Playwright browsers (Chromium only for annotated image generation)
# Note: Using standalone install without --with-deps to avoid Debian Trixie font package conflicts
RUN playwright install chromium

# Copy API code
COPY services/api .

# Copy scripts directory (for superuser creation, etc.)
COPY scripts /app/scripts

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
