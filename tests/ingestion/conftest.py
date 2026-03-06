"""Ensure ingestion service directory is on sys.path for local imports."""
import sys, os

_svc = os.path.join(os.path.dirname(__file__), "..", "..", "services", "ingestion")
_svc = os.path.abspath(_svc)
if _svc not in sys.path:
    sys.path.insert(0, _svc)
