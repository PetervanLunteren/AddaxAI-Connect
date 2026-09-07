"""Ensure the notifications-sensingclues service directory is on sys.path."""
import os
import sys

_svc = os.path.join(os.path.dirname(__file__), "..", "..", "services", "notifications-sensingclues")
_svc = os.path.abspath(_svc)
if _svc not in sys.path:
    sys.path.insert(0, _svc)
