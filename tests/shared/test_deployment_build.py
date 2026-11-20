"""The rule that turns a camera's GPS readings into deployments.

Plain Python, no database. Without statements it is the rule live ingestion
ran before phase 2, which step 1b proved on every production dataset.
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


# Statements (step 2a)

from shared.deployment_build import Statement  # noqa: E402

SITE_A, SITE_B = 101, 102


def test_a_closed_statement_is_one_deployment_whatever_the_gps_says():
    """The GPS saw a move on day 10. A person says the camera stood at site A
    from day 1 to day 20, so there is no move."""
    deps = build_deployments(
        readings((HOME, at(1)), (HOME, at(2)), (FAR, at(10)), (FAR, at(11))),
        [Statement(1, SITE_A, at(1, hour=0), at(20, hour=0))],
    )
    [dep] = deps
    assert dep.site_id == SITE_A and dep.statement_id == 1
    assert (dep.start_at, dep.end_at) == (at(1, hour=0), at(20, hour=0))
    assert dep.image_ids == [1, 2, 3, 4]
    assert dep.reading_count == 4  # every reading inside is averaged in


def test_after_a_closed_statement_the_walk_starts_again():
    deps = build_deployments(
        readings((HOME, at(2)), (FAR, at(12)), (FAR, at(13))),
        [Statement(1, SITE_A, at(1, hour=0), at(10, hour=0))],
    )
    stated, gps = deps
    assert stated.end_at == at(10, hour=0) and stated.image_ids == [1]
    # The first reading after the period opens a deployment without a site.
    assert gps.site_id is None and gps.start_at == at(12) and gps.image_ids == [2, 3]


def test_a_gps_deployment_ends_where_a_statement_starts():
    deps = build_deployments(
        readings((HOME, at(1)), (HOME, at(5))),
        [Statement(1, SITE_B, at(4, hour=0), at(9, hour=0))],
    )
    gps, stated = deps
    assert gps.end_at == at(4, hour=0) and gps.image_ids == [1]
    assert stated.image_ids == [2]


def test_a_statement_without_readings_is_still_a_deployment():
    """A camera without GPS: the statement alone places it."""
    [dep] = build_deployments([], [Statement(1, SITE_A, at(3, hour=0))])
    assert dep.site_id == SITE_A and dep.end_at is None
    assert dep.lat is None and dep.reading_count == 0


def test_an_open_statement_fixes_up_to_its_newest_photo_then_gps_carries_on():
    """'It did not move' on day 12 keeps days 1 to 12 at site A, far readings
    included. A real move after that is still seen."""
    statement = Statement(1, SITE_A, at(1, hour=0), fixed_until_at=at(12))
    elsewhere = offset(HOME, north_m=4000)
    deps = build_deployments(
        readings(
            (HOME, at(1)), (FAR, at(10)), (FAR, at(12)),  # fixed: stays at A
            (HOME, at(14)),  # near the pin of A: joins
            (elsewhere, at(20)), (elsewhere, at(21)),  # a real move
        ),
        [statement],
    )
    stated, moved = deps
    assert stated.site_id == SITE_A and stated.image_ids == [1, 2, 3, 4]
    assert stated.end_at == at(20)
    assert moved.site_id is None and moved.image_ids == [5, 6]


def test_an_open_statement_without_fixed_part_lets_gps_cut_at_once():
    deps = build_deployments(
        readings((HOME, at(2)), (FAR, at(5)), (FAR, at(6))),
        [Statement(1, SITE_A, at(1, hour=0))],
    )
    assert [d.site_id for d in deps] == [SITE_A, None]


def test_a_newer_statement_wins_where_they_overlap():
    deps = build_deployments(
        readings((HOME, at(2)), (HOME, at(6)), (HOME, at(12))),
        [
            Statement(1, SITE_A, at(1, hour=0), at(20, hour=0)),
            Statement(2, SITE_B, at(5, hour=0), at(10, hour=0)),
        ],
    )
    assert [(d.site_id, d.start_at.day, d.end_at.day) for d in deps] == [
        (SITE_A, 1, 5), (SITE_B, 5, 10), (SITE_A, 10, 20),
    ]
    assert [d.image_ids for d in deps] == [[1], [2], [3]]


def test_an_older_statement_under_a_newer_open_one_is_cut_short():
    deps = build_deployments(
        [],
        [Statement(1, SITE_A, at(1, hour=0)), Statement(2, SITE_B, at(10, hour=0))],
    )
    assert [(d.site_id, d.end_at) for d in deps] == [(SITE_A, at(10, hour=0)), (SITE_B, None)]


def test_a_newer_statement_fully_over_an_older_one_hides_it():
    deps = build_deployments(
        [],
        [Statement(1, SITE_A, at(5, hour=0), at(6, hour=0)), Statement(2, SITE_B, at(1, hour=0), at(10, hour=0))],
    )
    assert [d.site_id for d in deps] == [SITE_B]


def test_an_empty_statement_states_nothing():
    deps = build_deployments(readings((HOME, at(2))), [Statement(1, SITE_A, at(5, hour=0), at(5, hour=0))])
    assert [d.site_id for d in deps] == [None]


def test_a_reading_on_the_end_moment_belongs_to_what_comes_next():
    deps = build_deployments(
        readings((HOME, at(2)), (HOME, at(10, hour=0))),
        [Statement(1, SITE_A, at(1, hour=0), at(10, hour=0))],
    )
    assert [d.image_ids for d in deps] == [[1], [2]]


def test_closed_at_ends_a_retired_camera():
    [dep] = build_deployments(readings((HOME, at(1)), (HOME, at(3))), closed_at=at(4))
    assert dep.end_at == at(4) and dep.end_date == date(2026, 3, 3)


def test_closed_at_never_ends_before_the_start():
    [dep] = build_deployments(readings((HOME, at(5)),), closed_at=at(1))
    assert dep.end_at == dep.start_at


# Why the GPS rule cut, for the Deployments page.


def test_a_move_keeps_how_far_how_many_and_when():
    confirming = offset(FAR, north_m=20)
    first, second = build_deployments(readings(
        (HOME, at(1)), (FAR, at(10, hour=9)), (confirming, at(11)),
    ))
    assert first.move is None  # the first photos, no move
    assert second.move is not None
    assert second.move.readings == 2
    assert second.move.first_at == at(10, hour=9) == second.start_at
    # From the previous pin to the reading that confirmed the move.
    assert abs(second.move.distance_m - math.dist((0, 0), (1500, 20))) < 2


def test_no_move_inside_or_after_a_statement():
    deps = build_deployments(
        readings((HOME, at(2)), (FAR, at(5)), (FAR, at(6)), (FAR, at(12)), (FAR, at(13))),
        [Statement(1, SITE_A, at(1, hour=0), at(10, hour=0))],
    )
    stated, after = deps
    assert stated.move is None and stated.statement_id == 1
    # After a closed period the walk starts fresh: a first deployment, no move.
    assert after.move is None and after.statement_id is None
