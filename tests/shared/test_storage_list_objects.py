"""StorageClient.list_objects returns every key, not just the first 1000."""
from shared.storage import StorageClient


class _Paginator:
    def __init__(self, pages):
        self.pages = pages
        self.kwargs = None

    def paginate(self, **kwargs):
        self.kwargs = kwargs
        return iter(self.pages)


class _Client:
    def __init__(self, pages):
        self.paginator = _Paginator(pages)

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        return self.paginator


def _storage(pages) -> StorageClient:
    storage = StorageClient.__new__(StorageClient)
    storage.client = _Client(pages)
    return storage


def _page(start, count):
    return {"Contents": [{"Key": f"1/job/{i:06d}_IMG.JPG"} for i in range(start, start + count)]}


class TestListObjects:
    def test_joins_every_page(self):
        # A resume after 2500 uploaded files used to see only the first 1000.
        storage = _storage([_page(0, 1000), _page(1000, 1000), _page(2000, 500)])
        keys = storage.list_objects("bulk-upload-staging", "1/job/")
        assert len(keys) == 2500
        assert keys[-1] == "1/job/002499_IMG.JPG"

    def test_passes_bucket_and_prefix(self):
        storage = _storage([_page(0, 1)])
        storage.list_objects("bulk-upload-staging", "1/job/")
        assert storage.client.paginator.kwargs == {"Bucket": "bulk-upload-staging", "Prefix": "1/job/"}

    def test_no_prefix_lists_the_bucket(self):
        storage = _storage([_page(0, 1)])
        storage.list_objects("crops")
        assert storage.client.paginator.kwargs == {"Bucket": "crops"}

    def test_empty_prefix_gives_no_keys(self):
        # An empty result page has no Contents at all.
        assert _storage([{}]).list_objects("bulk-upload-staging", "1/none/") == []
