"""The rule that turns a camera's GPS readings into deployments.

Plain Python, no database. The same rule runs inside live ingestion today
(update_or_create_site_and_deployment); the local PostGIS tests prove the two
agree, these pin the rule itself.
"""
import math
from datetime import date, datetime

from shared.deployment_build import Reading, build_deployments

HOME = (53.2600, 5.1800)


def offset(point, east_m=0.0, north_m=0.0):
    lat, lon = point
    return (
        lat + north_m / 111_320.0,
        lon + east_m / (111_320.0 * math.cos(math.radians(lat))),
    )


def at(day, hour=12, second=0):
    return datetime(2026, 3, day, hour, 0, second)


def readings(*points_and_times):
    """Reading per (point, time), image ids 1, 2, 3 in the order given."""
    return [
        Reading(image_id=i, taken_at=t, lat=p[0], lon=p[1])
        for i, (p, t) in enumerate(points_and_times, start=1)
    ]


FAR = offset(HOME, east_m=1500)


def test_no_readings_no_deployments():
    assert build_deployments([]) == []


def test_first_reading_opens_an_open_deployment():
    [dep] = build_deployments(readings((HOME, at(1))))
    assert dep.start_at == at(1) and dep.end_at is None
    assert dep.end_date is None
    assert (dep.lat, dep.lon) == HOME
    assert dep.reading_count == 1 and dep.image_ids == [1]


def test_readings_in_range_join_and_the_pin_is_their_mean():
    points = [HOME, offset(HOME, east_m=40), offset(HOME, north_m=80)]
    [dep] = build_deployments(readings(*[(p, at(d)) for d, p in enumerate(points, 1)]))
    assert dep.reading_count == 3
    assert math.isclose(dep.lat, sum(p[0] for p in points) / 3, abs_tol=1e-9)
    assert math.isclose(dep.lon, sum(p[1] for p in points) / 3, abs_tol=1e-9)
    assert dep.image_ids == [1, 2, 3]


def test_an_earlier_photo_in_range_moves_the_start_back():
    [dep] = build_deployments(readings((HOME, at(10)), (HOME, at(4))))
    assert dep.start_date == date(2026, 3, 4)


def test_one_far_reading_is_held_and_dropped_when_back_in_range():
    [dep] = build_deployments(readings(
        (HOME, at(1)), (offset(HOME, east_m=300), at(2)), (HOME, at(3)),
    ))
    assert dep.image_ids == [1, 2, 3]
    assert dep.reading_count == 2  # the far reading never entered the pin
    assert (dep.lat, dep.lon) == HOME


def test_two_far_readings_confirm_a_move_from_the_first():
    confirming = offset(FAR, north_m=20)
    first, second = build_deployments(readings(
        (HOME, at(1)), (HOME, at(2)), (FAR, at(10, hour=9)), (confirming, at(11)),
    ))
    assert first.end_at == at(10, hour=9) == second.start_at
    assert first.end_date == date(2026, 3, 9)  # the day of the move is the new one's
    assert second.start_date == date(2026, 3, 10) and second.end_date is None
    assert first.image_ids == [1, 2]
    assert second.image_ids == [3, 4]
    # The new pin is the confirming reading alone, the held one is not averaged in.
    assert (second.lat, second.lon) == confirming and second.reading_count == 1


def test_two_photos_of_one_burst_confirm_a_move():
    """Known weakness: the check counts photos, not events. Phase 5."""
    deps = build_deployments(readings((HOME, at(1)), (FAR, at(5, second=0)), (FAR, at(5, second=1))))
    assert len(deps) == 2


def test_a_far_reading_not_near_the_held_one_replaces_it():
    west = offset(HOME, east_m=-1500)
    deps = build_deployments(readings(
        (HOME, at(1)), (FAR, at(2)), (west, at(3)), (west, at(4)),
    ))
    first, second = deps
    assert second.start_at == at(3)
    assert first.image_ids == [1, 2]  # the replaced held photo stays behind
    assert second.image_ids == [3, 4]


def test_a_move_on_the_start_day_shares_that_day():
    first, second = build_deployments(readings(
        (HOME, at(5, hour=8)), (FAR, at(5, hour=13)), (FAR, at(5, hour=14)),
    ))
    assert first.start_date == first.end_date == second.start_date == date(2026, 3, 5)


def test_moves_chain_and_each_ends_where_the_next_starts():
    third_place = offset(FAR, north_m=3000)
    deps = build_deployments(readings(
        (HOME, at(1)), (FAR, at(5)), (FAR, at(6)), (third_place, at(9)), (third_place, at(10)),
    ))
    assert [d.start_at for d in deps] == [at(1), at(5), at(9)]
    assert [d.end_at for d in deps] == [at(5), at(9), None]


def test_capture_order_and_arrival_order_agree_when_photos_arrive_in_order():
    rs = readings((HOME, at(1)), (HOME, at(2)), (FAR, at(5)), (FAR, at(6)), (HOME, at(9)), (HOME, at(10)))
    by_capture = sorted(rs, key=lambda r: (r.taken_at, r.image_id))
    assert build_deployments(rs) == build_deployments(by_capture)


def test_arrival_order_can_differ_from_capture_order():
    """An old card with photos from elsewhere, arriving after newer photos:
    in arrival order it reads as a move, in capture order as the history."""
    elsewhere = offset(HOME, east_m=5000)
    rs = readings((HOME, at(20)), (HOME, at(21)), (elsewhere, at(2)), (elsewhere, at(3)))
    by_arrival = build_deployments(rs)
    by_capture = build_deployments(sorted(rs, key=lambda r: (r.taken_at, r.image_id)))

    assert by_arrival[-1].end_at is None and by_arrival[-1].image_ids == [3, 4]
    assert by_capture[-1].image_ids == [1, 2]


def test_the_pin_averages_across_the_antimeridian():
    [dep] = build_deployments([
        Reading(1, at(1), 0.0, 179.9995),
        Reading(2, at(2), 0.0, -179.9995),
    ])
    assert abs(abs(dep.lon) - 180.0) < 1e-6
