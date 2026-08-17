"""A missing object must be distinguishable from a broken one.

Found 17 Aug 2026 by the update-test harness: an image row pointing at an
object that is not in the bucket answered 500 with the raw storage message in
the body, and nothing at ERROR level in the logs. The harness could not tell
that apart from a real server fault, so a known-missing file failed a whole
dataset.
"""
import pytest
from botocore.exceptions import ClientError

from shared.storage import StorageClient, StorageObjectNotFound, _raise_if_missing


def _client_error(code):
    return ClientError({"Error": {"Code": code, "Message": "x"}}, "GetObject")


@pytest.mark.parametrize("code", ["NoSuchKey", "404", "NotFound"])
def test_missing_codes_become_storage_object_not_found(code):
    """boto3 uses more than one code for this depending on the operation."""
    with pytest.raises(StorageObjectNotFound):
        _raise_if_missing(_client_error(code), "raw-images", "a/b.jpg")


@pytest.mark.parametrize("code", [
    "AccessDenied",       # permissions, a real problem
    "SlowDown",           # throttling, retryable
    "InternalError",      # the storage backend is unwell
    "InvalidAccessKeyId", # misconfiguration
    "",
])
def test_other_codes_are_left_alone(code):
    """Anything that is not 'the object is absent' must stay a 500.

    Turning a permissions failure into a 404 would hide a real outage behind a
    message saying the picture does not exist.
    """
    _raise_if_missing(_client_error(code), "raw-images", "a/b.jpg")  # must not raise


def test_the_exception_names_the_object_but_not_the_error():
    """The message identifies which object, for the log line.

    The client-facing detail is set in the app-level handler and deliberately
    does not include this, since it carries the bucket name and key.
    """
    try:
        _raise_if_missing(_client_error("NoSuchKey"), "raw-images", "cam/2026/x.jpg")
    except StorageObjectNotFound as e:
        assert "raw-images/cam/2026/x.jpg" in str(e)
    else:
        pytest.fail("expected StorageObjectNotFound")


def test_download_fileobj_translates(monkeypatch):
    """The translation happens in download_fileobj, not only in the helper."""
    class _Boto:
        def get_object(self, Bucket, Key):
            raise _client_error("NoSuchKey")

    sc = StorageClient.__new__(StorageClient)   # skip __init__, no MinIO here
    sc.client = _Boto()

    with pytest.raises(StorageObjectNotFound):
        sc.download_fileobj("raw-images", "gone.jpg")


def test_download_fileobj_lets_real_failures_through(monkeypatch):
    class _Boto:
        def get_object(self, Bucket, Key):
            raise _client_error("AccessDenied")

    sc = StorageClient.__new__(StorageClient)
    sc.client = _Boto()

    with pytest.raises(ClientError):
        sc.download_fileobj("raw-images", "denied.jpg")
