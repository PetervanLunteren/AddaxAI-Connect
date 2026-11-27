"""The plain steps of the rebuild, without a database. rebuild_camera itself
runs against PostGIS in tests/db_ingestion and tests/db_api."""
from datetime import datetime

from shared.deployment_build import BuiltDeployment, Statement
from shared.deployment_rebuild import (
    Photo, Planned, StoredRow, join_same_site, link_photos, match_rows, typed_last_days,
)


def at(day, hour=12):
    return datetime(2026, 3, day, hour)


def built(start, end, image_ids, site_id=None, lat=52.0):
    return BuiltDeployment(at(start), at(end) if end else None, lat, 5.0, len(image_ids), list(image_ids), site_id)


def stored(id, number, start, site_id=None):
    return StoredRow(id, number, site_id, at(start), None, 52.0, 5.0, 1)


def photo(id, day, deployment_id=None, lat=52.0):
    return Photo(id, at(day), lat, 5.0 if lat is not None else None, deployment_id)


# match_rows


def test_a_built_deployment_keeps_the_row_most_of_its_photos_are_on():
    rows = [stored(10, 1, 1), stored(11, 2, 5)]
    photos = [photo(1, 1, 10), photo(2, 2, 10), photo(3, 6, 11), photo(4, 7, 11)]
    result = match_rows([built(1, 5, [1, 2]), built(5, None, [3, 4])], rows, photos)
    assert result == [10, 11]


def test_a_row_goes_to_one_built_deployment_only():
    """A merge split back in two: the half with more photos keeps the row."""
    rows = [stored(10, 1, 1)]
    photos = [photo(1, 1, 10), photo(2, 2, 10), photo(3, 6, 10)]
    result = match_rows([built(1, 5, [1, 2]), built(5, None, [3])], rows, photos)
    assert result == [10, None]


def test_a_new_photo_matches_a_row_by_its_start_day():
    rows = [stored(10, 1, 1)]
    result = match_rows([built(1, None, [1])], rows, [photo(1, 1)])
    assert result == [10]


def test_nothing_shared_is_a_new_row():
    rows = [stored(10, 1, 1)]
    result = match_rows([built(9, None, [1])], rows, [photo(1, 9)])
    assert result == [None]


# join_same_site


def plan(b, row_id=None, site_id=None):
    return Planned(b, row_id, site_id)


def test_back_to_back_at_one_site_is_one_deployment():
    joined = join_same_site([
        plan(built(1, 5, [1], site_id=7), row_id=10, site_id=7),
        plan(built(5, None, [2], site_id=7), row_id=11, site_id=7),
    ])
    [one] = joined
    assert one.row_id == 10 and one.built.end_at is None
    assert one.built.start_at == at(1) and one.built.image_ids == [1, 2]


def test_the_next_day_still_joins_an_empty_day_between_does_not():
    """The rule of the old merge: the last day of the first is 4 March (it
    ends during the 5th), so a start on the 5th joins, a start on the 6th
    leaves the 5th empty and is a real removal and return."""
    next_day = join_same_site([
        plan(built(1, 5, [1]), site_id=7), plan(built(5, None, [2], lat=52.0), site_id=7),
    ])
    empty_day = join_same_site([
        plan(built(1, 5, [1]), site_id=7), plan(built(6, None, [2]), site_id=7),
    ])
    assert len(next_day) == 1 and len(empty_day) == 2


def test_different_sites_or_no_site_never_join():
    assert len(join_same_site([plan(built(1, 5, [1]), site_id=7), plan(built(5, None, [2]), site_id=8)])) == 2
    assert len(join_same_site([plan(built(1, 5, [1])), plan(built(5, None, [2]))])) == 2


def test_a_joined_pin_is_the_mean_of_all_readings():
    """lab: one stray photo 120 m off joined 1,460 photos at the site. The pin
    must stay with the many, not with the one."""
    one = BuiltDeployment(at(1), at(5), 52.0, 5.0, 1, [1], 7)
    many = BuiltDeployment(at(5), None, 53.0, 5.0, 9, [2], 7)
    [joined] = join_same_site([plan(one, 10, 7), plan(many, 11, 7)])
    assert joined.built.reading_count == 10
    assert abs(joined.built.lat - 52.9) < 1e-9


def test_a_join_takes_the_later_row_when_the_earlier_is_new():
    [one] = join_same_site([plan(built(1, 5, [1]), None, 7), plan(built(5, None, [2]), 11, 7)])
    assert one.row_id == 11


def test_a_stated_deployment_without_readings_takes_the_pin_of_the_one_it_joins():
    [one] = join_same_site([
        plan(BuiltDeployment(at(1), at(5), None, None, 0, [], 7), None, 7),
        plan(built(5, None, [2], lat=53.0), 11, 7),
    ])
    assert one.built.lat == 53.0 and one.built.reading_count == 1


def test_an_end_a_person_moved_stays_an_end_after_an_earlier_join():
    """An upload to the site (statement 1), then the next deployment there
    shortened by a person (statement 2, in kept_ends), then the rest the GPS
    made. The first two join, and the end of statement 2 must still hold.
    Before, the joined part carried statement 1 and the rest joined too."""
    upload = BuiltDeployment(at(1), at(5), 52.0, 5.0, 1, [1], 7, statement_id=1)
    shortened = BuiltDeployment(at(5), at(11), 52.0, 5.0, 1, [2], 7, statement_id=2)
    rest = built(11, None, [3])
    first, second = join_same_site(
        [plan(upload, 10, 7), plan(shortened, 11, 7), plan(rest, 12, 7)], kept_ends=frozenset({2}),
    )
    assert (first.built.start_at, first.built.end_at) == (at(1), at(11))
    assert (second.built.start_at, second.built.end_at) == (at(11), None)


def test_a_joined_deployment_has_the_typed_last_day_of_its_later_part():
    """An upload to the site, then a deployment whose last day a person
    typed: they join, and the joined one ends where the person said."""
    upload = Planned(BuiltDeployment(at(1), at(5), 52.0, 5.0, 1, [1], 7, statement_id=1), 10, 7)
    typed = Planned(BuiltDeployment(at(5), at(11), 52.0, 5.0, 1, [2], 7, statement_id=2), 11, 7, last_day_set=True)
    [joined] = join_same_site([upload, typed])
    assert joined.last_day_set and joined.built.end_at == at(11)


# typed_last_days


def test_a_last_day_counts_as_typed_only_where_the_deployment_ends_there():
    typed = Statement(1, 7, at(1), at(11), keeps_end=True)
    not_typed = Statement(2, 8, at(11), at(20))
    ends_there = BuiltDeployment(at(1), at(11), 52.0, 5.0, 1, [1], 7, statement_id=1)
    cut_short = BuiltDeployment(at(1), at(8), 52.0, 5.0, 1, [1], 7, statement_id=1)
    stated = BuiltDeployment(at(11), at(20), 52.0, 5.0, 1, [2], 8, statement_id=2)
    gps = built(20, None, [3])
    assert typed_last_days([ends_there, cut_short, stated, gps], [typed, not_typed]) == [True, False, False, False]


# link_photos


def test_a_photo_with_a_reading_follows_the_build():
    deps = [built(1, 5, [1]), built(5, None, [2])]
    # Photo 1 was taken after the cut but held there by the rule.
    links = link_photos(deps, [photo(1, 6), photo(2, 7)])
    assert links == {1: 0, 2: 1}


def test_a_photo_without_reading_belongs_to_the_period_that_covers_it():
    deps = [built(1, 5, [1]), built(5, None, [2])]
    links = link_photos(deps, [photo(3, 2, lat=None), photo(4, 5, lat=None)])
    assert links == {3: 0, 4: 1}  # the end moment belongs to the next one


def test_a_photo_without_reading_outside_every_period_has_none():
    deps = [built(5, 9, [1])]
    links = link_photos(deps, [photo(3, 2, lat=None), photo(4, 12, lat=None)])
    assert links == {3: None, 4: None}
