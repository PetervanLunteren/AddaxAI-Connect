#!/bin/bash
#
# FTPS Upload Rename Script
#
# Automatically renames all uploaded files with a random suffix to ensure uniqueness.
# This prevents file overwrites even when multiple cameras upload files with identical names.
#
# Called by pure-uploadscript after each successful upload.
# Receives the uploaded file path as the first argument.
#
# Filename format: ORIGINALNAME_RANDOMID.EXT
# Example: IMG_0001.JPG -> IMG_0001_a3f7b2c1.JPG

set -euo pipefail

FILEPATH="$1"

# Validate input
if [ -z "$FILEPATH" ] || [ ! -f "$FILEPATH" ]; then
    logger -t ftps-rename "ERROR: Invalid file path: $FILEPATH"
    exit 0  # Don't crash, just skip
fi

# Extract directory, filename, and extension
DIR=$(dirname "$FILEPATH")
BASENAME=$(basename "$FILEPATH")
FILENAME="${BASENAME%.*}"
EXT="${BASENAME##*.}"

# Generate 8-character random hex ID (4 bytes = 32 bits = ~4 billion combinations)
RANDOM_ID=$(head -c 4 /dev/urandom | xxd -p)

# Build new filename preserving extension
if [ "$FILENAME" = "$BASENAME" ]; then
    # No extension (e.g., "README")
    NEW_NAME="${FILENAME}_${RANDOM_ID}"
else
    # Has extension (e.g., "IMG_0001.JPG")
    NEW_NAME="${FILENAME}_${RANDOM_ID}.${EXT}"
fi

NEW_PATH="${DIR}/${NEW_NAME}"

# Rename file
if mv "$FILEPATH" "$NEW_PATH" 2>/dev/null; then
    logger -t ftps-rename "SUCCESS: $BASENAME -> $NEW_NAME"
    exit 0
else
    # If rename fails, leave original name (safe fallback)
    # Ingestion service will handle it
    logger -t ftps-rename "ERROR: Failed to rename $BASENAME, kept original name"
    exit 0
fi
