"""
Daily reports and bulk uploads.

- Daily reports never make or touch deployments. Only photos do.
- An upload to a chosen site is a statement for its days, so it never widens
  an older deployment at that site across a time the camera stood elsewhere.
- An upload without a chosen site rebuilds once at the end, in the order the
  photos were taken, so an old SD card is read as history and never moves
  where the camera stands now.
"""
import uuid
from datetime import timedelta

import db_operations as ingest
from deployment_db import (
    DAY, HOME, at, camera_config, close, deployments, image_deployment,
    make_camera, make_project, make_site, offset, rows, sites,
)


def report(device_id: str, gps, reported_at) -> None:
    ingest.update_camera_health(device_id, {
        "gps_location": gps,
        "report_datetime": reported_at,
        "battery_percentage": 80,
    })


def photo(camera_id: int, gps, captured_at, job_id=None) -> str:
    """One photo. Live photos rebuild at once, bulk photos (job_id) wait for
    the end of their job, as the worker does it."""
    image_uuid = str(uuid.uuid4())
    ingest.create_image_record(
        image_uuid=image_uuid, camera_id=camera_id, filename="x.jpg",
        storage_path="x", thumbnail_path="x", captured_at=captured_at,
        gps_reading=gps, exif_metadata={},
        origin="bulk" if job_id else "live", bulk_upload_job_id=job_id,
        rebuild=job_id is None,
    )
    return image_uuid


def make_job(camera_id: int, project_id: int) -> int:
    from deployment_db import execute, make_user, scalar
    user = scalar("SELECT id FROM users LIMIT 1") or make_user()
    return execute(
        """INSERT INTO bulk_upload_jobs
             (uuid, project_id, created_by_user_id, camera_id, original_filename,
              staged_object_key, status, manifest)
           VALUES (:u, :p, :usr, :c, 'card', 'x', 'processing', '{}') RETURNING id""",
        u=str(uuid.uuid4()), p=project_id, usr=user, c=camera_id,
    )


def finish_job(camera_id: int, job_id: int, site_id=None, start=None, end=None) -> None:
    """What the bulk worker does when a job ends."""
    if site_id is not None:
        ingest.state_upload_to_site(camera_id, site_id, job_id, start, end)
    ingest.rebuild_deployments(camera_id)


# Daily reports


def test_a_report_keeps_its_health_data_and_reading_but_makes_no_deployment():
    project = make_project()
    cam = make_camera("REP01", project)
    report("REP01", HOME, at(1))

    assert deployments(cam) == []
    assert camera_config(cam)["gps_from_report"] == {"lat": HOME[0], "lon": HOME[1]}
    [health] = rows("SELECT * FROM camera_health_reports WHERE camera_id = :c", c=cam)
    assert health["reported_at"] == at(1)
    assert (health["gps_lat"], health["gps_lon"]) == HOME


def test_a_report_changes_nothing_about_a_deployment():
    project = make_project()
    cam = make_camera("REP01", project)
    photo(cam, HOME, at(1))
    before = deployments(cam)
    report("REP01", offset(HOME, east_m=2000), at(2))
    report("REP01", offset(HOME, east_m=2000), at(3))
    assert deployments(cam) == before


def test_a_second_report_on_one_day_overwrites_the_reading():
    project = make_project()
    make_camera("REP01", project)
    report("REP01", HOME, at(1, hour=6))
    report("REP01", (0.0, 0.0), at(1, hour=18))

    [health] = rows("SELECT gps_lat, gps_lon FROM camera_health_reports")
    assert (health["gps_lat"], health["gps_lon"]) == (None, None)


# Uploads to a chosen site


def test_an_upload_without_gps_to_a_site_is_a_deployment_at_that_site():
    project = make_project()
    cam = make_camera("BULK01", project)
    live = [photo(cam, HOME, at(20)), photo(cam, HOME, at(21))]
    dune = make_site(project, "Dune", offset(HOME, east_m=3000))
    job = make_job(cam, project)
    old = [photo(cam, None, at(2), job), photo(cam, None, at(4), job)]

    finish_job(cam, job, dune, DAY, DAY + timedelta(days=4))

    upload, current = deployments(cam)
    assert upload["site_id"] == dune and upload["site_source"] == "manual"
    assert (upload["start_date"], upload["end_date"]) == (DAY, DAY + timedelta(days=4))
    assert close(upload["lon"], offset(HOME, east_m=3000)[1])  # no readings: the site pin
    assert [image_deployment(u) for u in old] == [upload["id"], upload["id"]]
    # The live deployment is untouched and still open.
    assert current["end_date"] is None and current["start_date"] == DAY + timedelta(days=19)
    assert [image_deployment(u) for u in live] == [current["id"], current["id"]]
    # An upload is a person's word, so only the live deployment is to check.
    [statement] = rows("SELECT * FROM deployment_statements WHERE camera_id = :c", c=cam)
    assert statement["source"] == "upload"
    assert (statement["from_at"], statement["until_at"]) == (at(1, hour=0), at(6, hour=0))


def test_without_dates_the_upload_spans_its_photos():
    project = make_project()
    cam = make_camera("BULK01", project)
    dune = make_site(project, "Dune", HOME)
    job = make_job(cam, project)
    photo(cam, None, at(3, hour=9), job)
    photo(cam, None, at(7, hour=17), job)

    finish_job(cam, job, dune)

    [dep] = deployments(cam)
    assert (dep["start_date"], dep["end_date"]) == (DAY + timedelta(days=2), DAY + timedelta(days=6))


def test_two_uploads_to_one_site_with_time_elsewhere_between_stay_apart():
    """Changed on purpose: the old code widened the camera's first deployment
    at the site over both uploads, straight through its time at site B."""
    project = make_project()
    cam = make_camera("BULK01", project)
    site_a = make_site(project, "A", HOME)
    site_b = make_site(project, "B", offset(HOME, east_m=4000))
    for start, site in [(1, site_a), (10, site_b), (20, site_a)]:
        job = make_job(cam, project)
        photo(cam, None, at(start + 1), job)
        finish_job(cam, job, site, DAY + timedelta(days=start - 1), DAY + timedelta(days=start + 3))

    assert [d["site_id"] for d in deployments(cam)] == [site_a, site_b, site_a]


def test_uploads_back_to_back_at_one_site_join():
    project = make_project()
    cam = make_camera("BULK01", project)
    site_a = make_site(project, "A", HOME)
    for start in (1, 6):
        job = make_job(cam, project)
        photo(cam, None, at(start + 1), job)
        finish_job(cam, job, site_a, DAY + timedelta(days=start - 1), DAY + timedelta(days=start + 3))

    [dep] = deployments(cam)
    assert (dep["start_date"], dep["end_date"]) == (DAY, DAY + timedelta(days=9))


def test_a_bulk_photo_keeps_its_own_reading_not_the_site_pin():
    project = make_project()
    cam = make_camera("BULK01", project)
    target = make_site(project, "Dune", HOME)
    job = make_job(cam, project)
    own = offset(HOME, east_m=900)
    image = photo(cam, own, at(1), job)
    finish_job(cam, job, target, DAY, DAY)

    [img] = rows("SELECT gps_lat, gps_lon FROM images WHERE uuid = :u", u=image)
    assert (img["gps_lat"], img["gps_lon"]) == own
    [dep] = deployments(cam)
    assert dep["site_id"] == target  # the statement wins over the reading


# Uploads without a chosen site


def test_an_old_sd_card_from_elsewhere_is_read_as_history():
    """Changed on purpose. Before 2a, old photos from another place, imported
    after newer live photos, became the camera's current deployment. Now they
    are an earlier deployment, and the camera still stands where it stands."""
    project = make_project()
    cam = make_camera("SD01", project)
    photo(cam, HOME, at(20))
    photo(cam, HOME, at(21))

    elsewhere = offset(HOME, east_m=5000)
    job = make_job(cam, project)
    old = [photo(cam, elsewhere, at(2), job), photo(cam, elsewhere, at(3), job)]
    finish_job(cam, job)

    earlier, current = deployments(cam)
    assert earlier["start_date"] == DAY + timedelta(days=1)
    assert earlier["end_at"] == current["start_at"] == at(20)
    assert current["end_date"] is None and close(current["lon"], HOME[1])
    assert (earlier["number"], current["number"]) == (2, 1)  # numbers never reshuffle
    assert [image_deployment(u) for u in old] == [earlier["id"], earlier["id"]]
    assert len(sites(project)) == 2


def test_an_sd_card_photo_without_gps_follows_the_cameras_deployments():
    """An upload of a recognised camera, no site chosen. The worker used to
    skip a photo without GPS, or with 0, 0 for one. Now it is stored as a
    live one is: between photos with GPS it lands on their deployment."""
    project = make_project()
    cam = make_camera("BULK05", project)
    job = make_job(cam, project)
    with_gps = [photo(cam, HOME, at(2), job), photo(cam, HOME, at(6), job)]
    without = [photo(cam, None, at(4), job), photo(cam, (0.0, 0.0), at(5), job)]
    finish_job(cam, job)

    [one] = deployments(cam)
    assert {image_deployment(u) for u in with_gps + without} == {one["id"]}


def test_an_sd_card_without_any_gps_waits_for_set_site():
    """Nothing places these photos: they are stored without a deployment,
    which the camera shows as photos without a site."""
    project = make_project()
    cam = make_camera("BULK06", project)
    job = make_job(cam, project)
    cards = [photo(cam, None, at(2), job), photo(cam, None, at(4), job)]
    finish_job(cam, job)

    assert deployments(cam) == []
    assert {image_deployment(u) for u in cards} == {None}
