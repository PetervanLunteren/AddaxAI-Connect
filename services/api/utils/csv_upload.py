"""
Read an uploaded CSV file into rows, for the imports of cameras and sites.

One place for the checks every CSV import needs: the file name, the
encoding (a BOM from Excel is dropped), comma or semicolon as delimiter, and
the headers that must be there. What a row means is up to the caller.
"""
import csv
import io
from typing import Dict, List, Set

from fastapi import HTTPException, UploadFile, status


def parse_csv_rows(csv_text: str, required_headers: Set[str]) -> List[Dict[str, str]]:
    """The rows of a CSV text as dicts by header. Raises 400 when the text
    is not a CSV, is empty or misses a required header."""
    try:
        delimiter = csv.Sniffer().sniff(csv_text[:1024]).delimiter
    except Exception:
        delimiter = ','
    try:
        rows = list(csv.DictReader(io.StringIO(csv_text), delimiter=delimiter))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to parse CSV: {str(e)}")
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file is empty")
    missing = required_headers - set(rows[0].keys())
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required CSV headers: {', '.join(sorted(missing))}",
        )
    return rows


async def read_csv_upload(file: UploadFile, required_headers: Set[str]) -> List[Dict[str, str]]:
    """The rows of an uploaded CSV file, see parse_csv_rows."""
    if not (file.filename or '').endswith('.csv'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be a CSV file")
    try:
        csv_text = (await file.read()).decode('utf-8-sig')  # utf-8-sig drops a BOM
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to read CSV file: {str(e)}")
    return parse_csv_rows(csv_text, required_headers)
