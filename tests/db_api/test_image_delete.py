"""
Deployments after photos are deleted or hidden in curation.

A delete rebuilds the camera's deployments, which drops a deployment that
lost all its photos. Hiding does not: hidden photos stay part of their
deployment, so an unhide finds everything as it was.
"""
import pytest

import routers.image_admin as image_admin
from deployment_db import HOME, at, deployments, execute, history, make_camera, make_project, offset, rebuild, rows

pytestmark = pytest.mark.asyncio

FAR = offset(HOME, east_m=2000)


class NoStorage:
    """The stored files are not what is tested here."""
    def delete_object_versions(self, *args): ...
    def delete_object(self, *args): ...
    def list_objects(self, *args, **kwargs): return []


@pytest.fixture
def moved():
    """A camera at Home, then two photos 2 km away: two deployments."""
    project = make_project()
    cam = make_camera("MOVER", project)
    far_photos = history(cam, [(HOME, at(1)), (HOME, at(2)), (FAR, at(10)), (FAR, at(11))])[2:]
    assert len(deployments(cam)) == 2
    return cam, far_photos


async def test_a_delete_drops_the_deployment_it_emptied(session, monkeypatch, moved):
    cam, far_photos = moved
    monkeypatch.setattr(image_admin, "StorageClient", NoStorage)
    ids = [r["id"] for r in rows("SELECT id FROM images WHERE uuid = ANY(:u)", u=far_photos)]

    deleted, errors, _ = await image_admin.delete_images_by_ids(session, ids)

    assert (deleted, errors) == (2, [])
    [left] = deployments(cam)
    assert left["end_date"] is None  # the camera stands at Home again, still there


async def test_hidden_photos_keep_their_deployment(moved):
    cam, far_photos = moved
    execute("UPDATE images SET is_hidden = true WHERE uuid = ANY(:u)", u=far_photos)
    rebuild(cam)
    assert len(deployments(cam)) == 2
