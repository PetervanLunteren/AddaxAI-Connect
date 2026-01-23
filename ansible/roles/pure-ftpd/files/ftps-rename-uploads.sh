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
# Example: IMG_0001.JPG -> IMG_0001_a3f7.JPG

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

# Try up to 5 times to find a unique random ID
# This prevents overwrites in the extremely rare case of ID collision
for attempt in {1..5}; do
    # Generate 4-character random hex ID (2 bytes = 16 bits = 65,536 combinations)
    RANDOM_ID=$(head -c 2 /dev/urandom | xxd -p)

    # Build new filename preserving extension
    if [ "$FILENAME" = "$BASENAME" ]; then
        # No extension (e.g., "README")
        NEW_NAME="${FILENAME}_${RANDOM_ID}"
    else
        # Has extension (e.g., "IMG_0001.JPG")
        NEW_NAME="${FILENAME}_${RANDOM_ID}.${EXT}"
    fi

    NEW_PATH="${DIR}/${NEW_NAME}"

    # Try to rename (mv -n = no-clobber, won't overwrite existing files)
    if mv -n "$FILEPATH" "$NEW_PATH" 2>/dev/null; then
        logger -t ftps-rename "SUCCESS: $BASENAME -> $NEW_NAME (attempt $attempt)"
        exit 0
    fi

    # If we get here, the random ID collided with an existing file
    # Loop will retry with a new random ID
done

# If all 5 attempts failed (astronomically unlikely), leave original name
# This is safer than risking data loss
logger -t ftps-rename "ERROR: Failed to find unique name for $BASENAME after 5 attempts, kept original name"
exit 0
