"""
Who may mark a service task done. An admin any task; anyone else only a
task assigned to them, logged as their own work. A viewer in the field is
shown their tasks in Needs attention and must be able to close them.
"""
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from deployment_db import (
    make_camera, make_member, make_project, make_task, make_user, rows,
)
from routers.service import CompleteTasksRequest, complete_tasks

pytestmark = pytest.mark.asyncio

TODAY = date.today()


def person(project, role="project-viewer", email="viewer@example.org"):
    return SimpleNamespace(id=make_member(project, role, None, email), is_superuser=False)


async def done(session, user, project, task, performed_by=None):
    request = CompleteTasksRequest(task_ids=[task], event_date=TODAY, performed_by_user_id=performed_by)
    await complete_tasks(project, request, user, session)


async def test_a_viewer_marks_their_own_task_done(session):
    project = make_project()
    viewer = person(project)
    task = make_task(make_camera("CAM", project), assigned_to=viewer.id)
    await done(session, viewer, project, task)
    assert rows("SELECT 1 FROM camera_service_tasks") == []
    [visit] = rows("SELECT performed_by_user_id, created_by_user_id FROM camera_maintenance_events")
    assert (visit["performed_by_user_id"], visit["created_by_user_id"]) == (viewer.id, viewer.id)


async def test_a_viewer_cannot_close_someone_elses_task(session):
    project = make_project()
    viewer = person(project)
    other = person(project, email="other@example.org")
    unassigned = make_task(make_camera("CAM", project))
    theirs = make_task(make_camera("CAM2", project), assigned_to=other.id)
    for task in (unassigned, theirs):
        with pytest.raises(HTTPException) as e:
            await done(session, viewer, project, task)
        assert e.value.status_code == 403
    assert len(rows("SELECT 1 FROM camera_service_tasks")) == 2


async def test_a_viewer_logs_only_their_own_work(session):
    project = make_project()
    viewer = person(project)
    other = person(project, email="other@example.org")
    task = make_task(make_camera("CAM", project), assigned_to=viewer.id)
    with pytest.raises(HTTPException) as e:
        await done(session, viewer, project, task, performed_by=other.id)
    assert e.value.status_code == 403


async def test_an_admin_closes_any_task_for_anyone(session):
    project = make_project()
    admin = person(project, "project-admin", email="admin2@example.org")
    viewer = person(project)
    task = make_task(make_camera("CAM", project), assigned_to=viewer.id)
    await done(session, admin, project, task, performed_by=viewer.id)
    [visit] = rows("SELECT performed_by_user_id FROM camera_maintenance_events")
    assert visit["performed_by_user_id"] == viewer.id


async def test_a_server_admin_closes_any_task(session):
    project = make_project()
    server_admin = SimpleNamespace(id=make_user(), is_superuser=True)
    task = make_task(make_camera("CAM", project))
    await done(session, server_admin, project, task)
    assert rows("SELECT 1 FROM camera_service_tasks") == []
