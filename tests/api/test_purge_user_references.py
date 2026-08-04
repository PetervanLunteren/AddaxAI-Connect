"""
The dev-server purge must know about every foreign key that points at users.

The purge hard-deletes non-admin users. Any column referencing users.id has to
be dealt with first, or postgres refuses the delete and the endpoint returns a
500 with a foreign key violation. That is exactly what happened when the bulk
upload feature added bulk_upload_jobs.created_by_user_id and nobody updated the
purge.

A column is safe when one of these is true:
  - it is nullable and the purge nulls it, or the FK is ON DELETE SET NULL
  - the FK is ON DELETE CASCADE, so the row goes with the user
  - the purge reassigns it to the admin running the purge

This test reads the models rather than a hand-written list, so adding a new
column to any model is enough to trip it. Model-only, no database needed,
matching the rest of tests/api.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared"))

from shared.models import Base  # noqa: E402


# Columns the purge explicitly reassigns to the caller, because they are
# NOT NULL and the history is worth keeping. Keep in sync with
# purge_non_admin_users in services/api/routers/admin.py.
REASSIGNED = {
    ("human_observations", "created_by_user_id"),
    ("project_documents", "uploaded_by_user_id"),
    ("project_reminders", "created_by_user_id"),
    ("user_invitations", "invited_by_user_id"),
    ("bulk_upload_jobs", "created_by_user_id"),
}

# Nullable columns the purge sets to NULL. Not strictly required, since a
# nullable FK could also be left to the database, but the purge is explicit
# about these and the list documents that intent.
NULLED = {
    ("images", "verified_by_user_id"),
    ("images", "liked_by_user_id"),
    ("images", "needs_review_by_user_id"),
    ("human_observations", "updated_by_user_id"),
    ("project_memberships", "added_by_user_id"),
    ("project_reminders", "cancelled_by_user_id"),
}


def _user_foreign_keys():
    """Every (table, column, nullable, ondelete) that references users.id."""
    found = []
    for table in Base.metadata.tables.values():
        for column in table.columns:
            for fk in column.foreign_keys:
                if fk.column.table.name == "users" and fk.column.name == "id":
                    ondelete = (fk.ondelete or "").upper()
                    found.append((table.name, column.name, column.nullable, ondelete))
    return found


class TestPurgeCoversEveryUserReference:
    def test_the_schema_actually_has_user_references(self):
        # Guards against the introspection silently finding nothing, which
        # would make every other test in this file pass for the wrong reason.
        assert len(_user_foreign_keys()) >= 10

    def test_every_not_null_reference_is_reassigned(self):
        unhandled = [
            (table, column)
            for table, column, nullable, ondelete in _user_foreign_keys()
            if not nullable and ondelete != "CASCADE" and (table, column) not in REASSIGNED
        ]
        assert unhandled == [], (
            "These NOT NULL columns point at users.id and the dev purge does not "
            f"handle them, so deleting a user will fail: {unhandled}. Add an "
            "update(...) to purge_non_admin_users in services/api/routers/admin.py "
            "and list the column in REASSIGNED here."
        )

    def test_every_nullable_reference_is_nulled_or_handled_by_the_database(self):
        unhandled = [
            (table, column)
            for table, column, nullable, ondelete in _user_foreign_keys()
            if nullable
            and ondelete not in {"CASCADE", "SET NULL"}
            and (table, column) not in NULLED
        ]
        assert unhandled == [], (
            "These nullable columns point at users.id with no ON DELETE rule and "
            f"the purge does not null them: {unhandled}."
        )

    def test_bulk_upload_jobs_is_covered(self):
        # The specific regression: a 500 on the dev reset, caused by
        # bulk_upload_jobs.created_by_user_id being NOT NULL and unhandled.
        rows = [
            (table, column, nullable, ondelete)
            for table, column, nullable, ondelete in _user_foreign_keys()
            if table == "bulk_upload_jobs"
        ]
        assert rows, "bulk_upload_jobs no longer references users, update this test"
        for table, column, nullable, ondelete in rows:
            assert nullable or ondelete == "CASCADE" or (table, column) in REASSIGNED
