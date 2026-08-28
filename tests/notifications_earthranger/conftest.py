"""Ensure the notifications-earthranger service directory is on sys.path."""
import sys, os

_svc = os.path.join(os.path.dirname(__file__), "..", "..", "services", "notifications-earthranger")
_svc = os.path.abspath(_svc)
if _svc not in sys.path:
    sys.path.insert(0, _svc)
