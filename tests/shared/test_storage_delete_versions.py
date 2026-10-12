"""Tests for StorageClient.delete_object_versions, the delete that really deletes."""
import pytest

from shared.storage import StorageClient


class FakePaginator:
    def __init__(self, pages):
        self.pages = pages
        self.kwargs = None

    def paginate(self, **kwargs):
        self.kwargs = kwargs
        return iter(self.pages)


class FakeClient:
    def __init__(self, pages, errors=None):
        self.paginator = FakePaginator(pages)
        self.deleted = []
        self.errors = errors or []

    def get_paginator(self, name):
        assert name == "list_object_versions"
        return self.paginator

    def delete_objects(self, Bucket, Delete):
        self.deleted.append((Bucket, Delete))
        return {"Errors": self.errors} if self.errors else {}


def _storage(pages, errors=None) -> StorageClient:
    storage = StorageClient.__new__(StorageClient)
    storage.client = FakeClient(pages, errors)
    return storage


KEY = "cam/2026/10/abc_photo.jpg"


class TestDeleteObjectVersions:
    def test_deletes_every_version_and_marker_of_the_exact_key_only(self):
        storage = _storage([{
            "Versions": [
                {"Key": KEY, "VersionId": "v1"},
                {"Key": KEY, "VersionId": "v2"},
                # Shares the prefix, must stay
                {"Key": KEY + ".bak", "VersionId": "v3"},
            ],
            "DeleteMarkers": [{"Key": KEY, "VersionId": "dm1"}],
        }])

        storage.delete_object_versions("raw-images", KEY)

        assert storage.client.paginator.kwargs == {"Bucket": "raw-images", "Prefix": KEY}
        assert storage.client.deleted == [(
            "raw-images",
            {
                "Objects": [
                    {"Key": KEY, "VersionId": "v1"},
                    {"Key": KEY, "VersionId": "v2"},
                    {"Key": KEY, "VersionId": "dm1"},
                ],
                "Quiet": True,
            },
        )]

    def test_empty_listing_deletes_nothing(self):
        storage = _storage([{}])
        storage.delete_object_versions("raw-images", KEY)
        assert storage.client.deleted == []

    def test_one_delete_call_per_page(self):
        storage = _storage([
            {"Versions": [{"Key": KEY, "VersionId": "v1"}]},
            {"Versions": [{"Key": KEY, "VersionId": "v2"}]},
        ])
        storage.delete_object_versions("raw-images", KEY)
        assert len(storage.client.deleted) == 2

    def test_errors_raise_instead_of_being_skipped(self):
        storage = _storage(
            [{"Versions": [{"Key": KEY, "VersionId": "v1"}]}],
            errors=[{"Key": KEY, "VersionId": "v1", "Code": "AccessDenied"}],
        )
        with pytest.raises(RuntimeError, match="raw-images/" + KEY.replace(".", r"\.")):
            storage.delete_object_versions("raw-images", KEY)
