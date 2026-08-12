"""
Tests for the upload-directory event handler.

Files reach the handler two ways: written straight into the upload dir, or
renamed into it. Pure-FTPd renames its atomic upload into place, and the API
renames a file back when an admin reprocesses a rejection. Both must be
processed, and the reject path itself must never come back in.
"""
import pytest
from watchdog.events import FileCreatedEvent, FileMovedEvent

import main


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    """Upload root with a rejected/ subtree, wired into the handler's settings."""
    (tmp_path / "rejected" / "unknown_camera").mkdir(parents=True)
    monkeypatch.setattr(main.settings, "ftps_upload_dir", str(tmp_path))
    monkeypatch.setattr(main.time, "sleep", lambda _: None)
    return tmp_path


@pytest.fixture
def dispatched(monkeypatch):
    """Record what the handler routes, instead of running the real pipeline."""
    calls = []
    monkeypatch.setattr(main, "_dispatch_file", lambda path, ext: calls.append((path, ext)))
    return calls


def test_reprocessed_file_is_handled(uploads, dispatched):
    """A rejection moved back to the upload dir is picked up without a restart."""
    source = uploads / "rejected" / "unknown_camera" / "E1000381.JPG"
    source.touch()
    destination = uploads / "E1000381.JPG"
    source.rename(destination)

    main.IngestionEventHandler().on_moved(
        FileMovedEvent(src_path=str(source), dest_path=str(destination))
    )

    assert dispatched == [(str(destination), "jpg")]


def test_pureftpd_atomic_upload_is_handled(uploads, dispatched):
    """The camera upload path still works, including the AutoRename suffix."""
    source = uploads / ".pureftpd-upload.abc123"
    destination = uploads / "IMG001.JPG.1"
    destination.touch()

    main.IngestionEventHandler().on_moved(
        FileMovedEvent(src_path=str(source), dest_path=str(destination))
    )

    assert dispatched == [(str(destination), "jpg")]


def test_reject_move_is_ignored(uploads, dispatched):
    """Moving a file into rejected/ must not feed it back into the pipeline."""
    source = uploads / "E1000381.JPG"
    destination = uploads / "rejected" / "unknown_camera" / "E1000381.JPG"
    destination.touch()

    main.IngestionEventHandler().on_moved(
        FileMovedEvent(src_path=str(source), dest_path=str(destination))
    )

    assert dispatched == []


def test_hidden_upload_in_progress_is_ignored(uploads, dispatched):
    """The temp file of an upload is skipped; its visible rename follows."""
    temp = uploads / ".pureftpd-upload.abc123"
    temp.touch()

    main.IngestionEventHandler().on_created(FileCreatedEvent(src_path=str(temp)))

    assert dispatched == []


def test_created_file_with_autorename_suffix_is_handled(uploads, dispatched):
    """A collision name arriving as a new file routes on the real extension."""
    image = uploads / "IMG001.JPG.2"
    image.touch()

    main.IngestionEventHandler().on_created(FileCreatedEvent(src_path=str(image)))

    assert dispatched == [(str(image), "jpg")]


def test_directory_events_are_ignored(uploads, dispatched):
    """Nested camera trees create directories; those are not files to process."""
    folder = uploads / "INSTAR"
    folder.mkdir()

    event = FileCreatedEvent(src_path=str(folder))
    event.is_directory = True
    main.IngestionEventHandler().on_created(event)

    assert dispatched == []
