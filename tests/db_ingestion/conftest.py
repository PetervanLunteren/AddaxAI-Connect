import os
import sys

from deployment_db import empty_tables  # noqa: F401  (sets the database first)

# The ingestion service imports its siblings as top-level modules (`utils`,
# `db_operations`), as it does inside its own container.
SERVICE = os.path.join(os.path.dirname(__file__), "..", "..", "services", "ingestion")
if SERVICE not in sys.path:
    sys.path.insert(0, SERVICE)
