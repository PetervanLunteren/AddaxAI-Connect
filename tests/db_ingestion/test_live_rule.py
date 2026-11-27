"""
How live ingestion turns GPS readings into deployments and sites.

Photos go through create_image_record, the same call ingestion makes, which
stores the photo and rebuilds the camera's deployments in one transaction.
"""
import uuid
from datetime import timedelta

import pytest

import db_operations as ingest
from deployment_db import (
    DAY, HOME, at, close, deployments, image_deployment,
    make_camera, make_project, offset, rows, sites,
)


def photo(camera_id: int, gps, captured_at) -> str:
    """One photo through the real ingestion call. Returns its uuid."""
    image_uuid = str(uuid.uuid4())
    ingest.create_image_record(
        image_uuid=image_uuid,
        camera_id=camera_id,
        filename=f"{image_uuid}.jpg",
        storage_path=f"test/{image_uuid}.jpg",
        thumbnail_path=f"test/{image_uuid}.jpg",
        captured_at=captured_at,
        gps_reading=gps,
        exif_metadata={"gps_decimal": list(gps) if gps else None},
    )
    return image_uuid


@pytest.fixture
def project():
    return make_project()


@pytest.fixture
def camera(project):
    return make_camera("CAM01", project)


def test_first_photo_opens_a_deployment_on_a_new_site(project, camera):
    image = photo(camera, HOME, at(1))

    [dep] = deployments(camera)
    assert dep["number"] == 1
    assert dep["start_date"] == DAY and dep["end_date"] is None
    assert dep["site_source"] == "auto" and dep["readings"] == 1
    [s] = sites(project)
    assert dep["site_id"] == s["id"]
    assert s["name"] == "Site at 53.2600, 5.1800"
    assert image_deployment(image) == dep["id"]
    assert rows("SELECT gps_lat, gps_lon FROM images WHERE uuid = :u", u=image)[0] == \
        {"gps_lat": HOME[0], "gps_lon": HOME[1]}


def test_readings_in_range_stay_on_one_deployment_and_the_pin_is_their_mean(project, camera):
    points = [HOME, offset(HOME, east_m=40), offset(HOME, north_m=80)]
    for day, point in enumerate(points, start=1):
        photo(camera, point, at(day))

    [dep] = deployments(camera)
    assert dep["readings"] == 3
    assert close(dep["lat"], sum(p[0] for p in points) / 3)
    assert close(dep["lon"], sum(p[1] for p in points) / 3)
    # The site pin is the centroid of its deployments, here the one pin.
    [s] = sites(project)
    assert close(s["lat"], dep["lat"]) and close(s["lon"], dep["lon"])


def test_an_older_photo_arriving_late_moves_the_start_back(camera):
    photo(camera, HOME, at(10))
    photo(camera, HOME, at(4))

    [dep] = deployments(camera)
    assert dep["start_date"] == DAY + timedelta(days=3)


def test_one_far_reading_is_held_and_dropped_when_the_camera_reads_home_again(camera):
    photo(camera, HOME, at(1))
    noise = photo(camera, offset(HOME, east_m=300), at(2))
    assert len(deployments(camera)) == 1
    photo(camera, HOME, at(3))

    [dep] = deployments(camera)
    # The held photo stays on the deployment, and its reading never entered the pin.
    assert image_deployment(noise) == dep["id"]
    assert dep["readings"] == 2
    assert close(dep["lat"], HOME[0]) and close(dep["lon"], HOME[1])


def test_two_far_readings_confirm_a_move_dated_back_to_the_first(project, camera):
    photo(camera, HOME, at(1))
    photo(camera, HOME, at(2))
    far = offset(HOME, east_m=1500)
    held = photo(camera, far, at(10))
    confirming = photo(camera, offset(far, north_m=20), at(11))

    first, second = deployments(camera)
    assert first["end_date"] == DAY + timedelta(days=8)  # the day before the first far reading
    assert second["number"] == 2
    assert second["start_date"] == DAY + timedelta(days=9) and second["end_date"] is None
    assert second["site_id"] != first["site_id"]
    # The new pin is the confirming reading only; the held reading is not averaged in.
    assert second["readings"] == 1
    assert close(second["lat"], offset(far, north_m=20)[0])
    assert image_deployment(held) == second["id"]
    assert image_deployment(confirming) == second["id"]
    # The new period starts at the first far photo, to the second.
    assert first["end_at"] == second["start_at"] == at(10)
    assert len(sites(project)) == 2



def test_two_far_readings_of_one_burst_also_confirm_a_move(camera):
    """Known weakness: the check counts photos, not events, so two photos of
    one trigger confirm a move. Phase 5 of the plan is meant to fix this."""
    photo(camera, HOME, at(1))
    far = offset(HOME, east_m=1500)
    photo(camera, far, at(5, second=0))
    photo(camera, far, at(5, second=1))

    assert len(deployments(camera)) == 2


def test_two_far_readings_far_apart_from_each_other_do_not_confirm(camera):
    photo(camera, HOME, at(1))
    photo(camera, offset(HOME, east_m=1500), at(2))
    photo(camera, offset(HOME, east_m=-1500), at(3))

    assert len(deployments(camera)) == 1


def test_a_move_right_after_the_start_clamps_the_old_end_to_its_start(camera):
    photo(camera, HOME, at(5))
    far = offset(HOME, east_m=1500)
    photo(camera, far, at(5, hour=13))
    photo(camera, far, at(5, hour=14))

    first, second = deployments(camera)
    assert first["start_date"] == first["end_date"] == DAY + timedelta(days=4)
    assert second["start_date"] == DAY + timedelta(days=4)


def test_cameras_close_together_share_one_site(project):
    cameras = [make_camera(f"BRIDGE{i}", project) for i in range(4)]
    for i, cam in enumerate(cameras):
        photo(cam, offset(HOME, east_m=10 * i), at(1))

    [s] = sites(project)
    for i, cam in enumerate(cameras):
        [dep] = deployments(cam)
        assert dep["site_id"] == s["id"]


def test_rotating_cameras_land_on_the_existing_sites(project):
    """Three cameras on stations 1 km apart, all moved east, then each put back
    on another camera's old station. The way back reuses the old sites."""
    stations = [offset(HOME, north_m=1000 * i) for i in range(3)]
    east = [offset(s, east_m=1000) for s in stations]
    cameras = [make_camera(f"ROT{i}", project) for i in range(3)]

    def two_photos(cam, point, day):
        photo(cam, point, at(day))
        photo(cam, point, at(day + 1))

    for cam, point in zip(cameras, stations):
        two_photos(cam, point, 1)
    station_sites = [deployments(cam)[0]["site_id"] for cam in cameras]
    for cam, point in zip(cameras, east):
        two_photos(cam, point, 10)
    for cam, point in zip(cameras, [stations[1], stations[2], stations[0]]):
        two_photos(cam, point, 20)

    assert len(sites(project)) == 6
    back = [deployments(cam)[-1] for cam in cameras]
    assert [d["number"] for d in back] == [3, 3, 3]
    assert [d["site_id"] for d in back] == [station_sites[1], station_sites[2], station_sites[0]]


def test_a_camera_without_project_gets_a_deployment_without_site():
    cam = make_camera("LOOSE", None)
    photo(cam, HOME, at(1))

    [dep] = deployments(cam)
    assert dep["site_id"] is None


def test_a_camera_that_joins_a_project_gets_a_site_on_its_next_photo(project):
    """A camera without project has deployments without site. Once it is in a
    project, the next photo gives the same deployment a site."""
    from deployment_db import execute
    cam = make_camera("LATE", None)
    photo(cam, HOME, at(1))
    [before] = deployments(cam)
    execute("UPDATE cameras SET project_id = :p WHERE id = :c", p=project, c=cam)
    photo(cam, offset(HOME, east_m=20), at(2))

    [dep] = deployments(cam)
    [s] = sites(project)
    assert dep["id"] == before["id"] and dep["site_id"] == s["id"]


@pytest.mark.parametrize("gps", [(0.0, 0.0), (91.0, 5.0), (53.0, 181.0)])
def test_a_photo_with_invalid_gps_has_no_reading_and_follows_the_time(camera, gps):
    """Changed in 2a: an invalid reading used to raise inside the resolver.
    Now it is stored as no reading, and the photo joins the deployment that
    covers its capture time."""
    photo(camera, HOME, at(1))
    bad = photo(camera, gps, at(2))

    [dep] = deployments(camera)
    assert dep["readings"] == 1
    assert image_deployment(bad) == dep["id"]


def test_a_photo_without_gps_before_any_deployment_has_none(camera):
    lone = photo(camera, None, at(1))
    assert deployments(camera) == []
    assert image_deployment(lone) is None


def test_rebuilding_an_unknown_camera_raises():
    from shared.database import get_db_session
    from shared.deployment_rebuild import rebuild_camera
    with pytest.raises(ValueError), get_db_session() as session:
        rebuild_camera(session, 999)


def test_a_rebuild_without_news_changes_nothing(project, camera):
    """Running the rebuild again on the same photos writes nothing."""
    from shared.database import get_db_session
    from shared.deployment_rebuild import rebuild_camera
    photo(camera, HOME, at(1))
    photo(camera, FAR_FOR_TESTS, at(5))
    photo(camera, FAR_FOR_TESTS, at(6))
    before = (deployments(camera), sites(project))
    with get_db_session() as session:
        result = rebuild_camera(session, camera)
    assert (result.created, result.deleted) == ((), 0)
    assert (deployments(camera), sites(project)) == before


FAR_FOR_TESTS = offset(HOME, east_m=1500)
