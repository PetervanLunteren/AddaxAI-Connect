"""
Measure the move rule on real data. Read only, prints text, writes nothing.

The move rule is one fixed distance (SITE_THRESHOLD_METERS, 250 m) and a
number of far readings in a row that must agree (RELOCATION_CONFIRMATIONS,
2). This script answers, for every camera on this server, what a change of
that rule would be judged by:

A. How noisy is the GPS? The distance of every reading to the middle
   (median) of its deployment.
B. How many moves does the rule miss? Deployments whose position shifts by
   30 to 250 m on some day and stays shifted.
C. What would other fixed rules do? The same build with other numbers: how
   many moves they make, and how many of those are short trips (out and
   back within a week), the usual shape of a false move.

D. What do the moves of today's rule look like? One line per move: how far,
   how long the camera stayed, how many photos, whether the photos that
   confirmed it were one burst, whether it came back. For judging which
   signs would mark a false move besides the short trip.

E. Which moves would a 100 m rule add? One line per move under 250 m, to
   see whether they are real moves or noise.

It builds from the GPS alone, without the corrections people made, because
it judges what the GPS rule does by itself. Choosing a site is not
simulated: a move here is a new deployment, whichever site it would get.

Run on a server that holds the data to judge (a dev server with a restored
production backup), in the ingestion container:

    docker compose exec -T ingestion python - < scripts/analyse_move_rule.py

Prints counts and camera ids only, no coordinates.
"""
import statistics
from collections import defaultdict
from datetime import timedelta

from sqlalchemy import text

from shared import deployment_build
from shared.database import get_db_session
from shared.deployment_build import BuiltDeployment, Reading, build_deployments
from shared.geo import RELOCATION_CONFIRMATIONS, SITE_THRESHOLD_METERS, calculate_gps_distance

# (distance in metres, far readings in a row). The first is today's rule.
RULES = [(250, 2), (200, 2), (175, 2), (150, 2), (100, 2), (100, 3), (50, 3)]
SHORT_TRIP = timedelta(days=7)
MIN_READINGS = 5  # a deployment needs this many to have a middle worth measuring from
MIN_DAYS_PER_SIDE = 3  # of a shift: days with photos before it and after it
MIN_SHIFT_M = 30.0
SHIFT_BINS = [(30, 50), (50, 100), (100, 150), (150, 250)]

Point = tuple[float, float]


def middle(points: list[Point]) -> Point:
    """The median position: one bad fix does not pull it, as it does a mean."""
    return statistics.median(p[0] for p in points), statistics.median(p[1] for p in points)


def metres(a: Point, b: Point) -> float:
    return calculate_gps_distance(a[0], a[1], b[0], b[1])


def percentile(ordered: list[float], p: float) -> float:
    return ordered[min(len(ordered) - 1, int(p / 100 * len(ordered)))]


def load() -> dict[int, list[Reading]]:
    """Every camera's readings, in capture order."""
    cameras: dict[int, list[Reading]] = defaultdict(list)
    with get_db_session() as session:
        for r in session.execute(text("""
            SELECT camera_id, id, captured_at, gps_lat, gps_lon FROM images
            WHERE gps_lat IS NOT NULL AND gps_lon IS NOT NULL
            ORDER BY camera_id, captured_at, id
        """)):
            cameras[r.camera_id].append(Reading(r.id, r.captured_at, r.gps_lat, r.gps_lon))
    return cameras


def build(readings: list[Reading], distance_m: float, confirmations: int) -> list[BuiltDeployment]:
    """The app's own build, with another distance and count. They are module
    constants, so they are set for the call and put back."""
    deployment_build.SITE_THRESHOLD_METERS = distance_m
    deployment_build.RELOCATION_CONFIRMATIONS = confirmations
    try:
        return build_deployments(readings)
    finally:
        deployment_build.SITE_THRESHOLD_METERS = SITE_THRESHOLD_METERS
        deployment_build.RELOCATION_CONFIRMATIONS = RELOCATION_CONFIRMATIONS


def shift_of(readings: list[Reading]) -> tuple[float, str, int, int] | None:
    """The clearest lasting shift inside one deployment: metres, the day it
    happened, and the days with photos before and after. None when the
    position never shifts by MIN_SHIFT_M and three times its own scatter.
    Works on one middle per day, so a burst of photos counts once."""
    by_day: dict[str, list[Point]] = defaultdict(list)
    for r in readings:
        by_day[r.taken_at.date().isoformat()].append((r.lat, r.lon))
    days = sorted(by_day)
    daily = [middle(by_day[d]) for d in days]
    best = None
    for k in range(MIN_DAYS_PER_SIDE, len(days) - MIN_DAYS_PER_SIDE + 1):
        before, after = daily[:k], daily[k:]
        a, b = middle(before), middle(after)
        shift = metres(a, b)
        if shift < MIN_SHIFT_M or (best and shift <= best[0]):
            continue
        scatter = max(
            statistics.median(metres(p, a) for p in before),
            statistics.median(metres(p, b) for p in after),
            5.0,
        )
        if shift >= 3 * scatter:
            best = (shift, days[k], k, len(days) - k)
    return best


def short_trips(deployments: list[BuiltDeployment], distance_m: float) -> int:
    """Out and back within a week: a move, then a move back to where the
    camera was."""
    trips = 0
    for a, b, c in zip(deployments, deployments[1:], deployments[2:]):
        if (b.move and c.move and b.end_at is not None and b.end_at - b.start_at <= SHORT_TRIP
                and metres((a.lat, a.lon), (c.lat, c.lon)) <= distance_m):
            trips += 1
    return trips


def main() -> None:
    cameras = load()
    total = sum(len(r) for r in cameras.values())
    print(f"{len(cameras)} cameras with GPS, {total} readings\n")

    # A and B, on today's rule.
    distances: list[float] = []
    per_camera_p95: list[float] = []
    shifts: list[tuple[int, float, str, int, int]] = []
    for camera_id, readings in cameras.items():
        by_id = {r.image_id: r for r in readings}
        own: list[float] = []
        for d in build(readings, SITE_THRESHOLD_METERS, RELOCATION_CONFIRMATIONS):
            inside = [by_id[i] for i in d.image_ids]
            if len(inside) < MIN_READINGS:
                continue
            centre = middle([(r.lat, r.lon) for r in inside])
            own += [metres((r.lat, r.lon), centre) for r in inside]
            found = shift_of(inside)
            if found and found[0] < SITE_THRESHOLD_METERS:
                shifts.append((camera_id, *found))
        if own:
            distances += own
            per_camera_p95.append(percentile(sorted(own), 95))

    distances.sort()
    print("A. GPS noise: metres from a reading to the middle of its deployment")
    if distances:
        for p in (50, 90, 95, 99, 99.9):
            print(f"   {p:>5}% of readings within {percentile(distances, p):8.1f} m")
        print(f"   furthest reading           {distances[-1]:8.1f} m")
        for limit in (50, 100, 150, 250):
            beyond = sum(1 for d in distances if d > limit)
            print(f"   beyond {limit:>3} m: {beyond:>6} readings ({100 * beyond / len(distances):.3f}%)")
        per_camera_p95.sort()
        print(f"   per camera, 95% within: best {per_camera_p95[0]:.1f} m, "
              f"typical {statistics.median(per_camera_p95):.1f} m, worst {per_camera_p95[-1]:.1f} m")

    print("\nB. Lasting shifts under 250 m inside one deployment (moves the rule did not see)")
    for low, high in SHIFT_BINS:
        print(f"   {low:>3} to {high:>3} m: {sum(1 for s in shifts if low <= s[1] < high)}")
    for camera_id, shift, day, before, after in sorted(shifts, key=lambda s: -s[1]):
        print(f"   camera {camera_id}: {shift:.0f} m on {day}, {before} days before, {after} days after")

    print("\nD. Every move of today's rule")
    print("   camera  day         metres  stayed     photos  confirmed in  came back")
    counts: dict[str, int] = defaultdict(int)
    for camera_id, readings in cameras.items():
        by_id = {r.image_id: r for r in readings}
        built = build(readings, SITE_THRESHOLD_METERS, RELOCATION_CONFIRMATIONS)
        for a, b, c in zip(built, built[1:], built[2:] + [None]):
            if not b.move:
                continue
            inside = [by_id[i] for i in b.image_ids]
            # The photos that confirmed it: the first RELOCATION_CONFIRMATIONS.
            confirmed_in = inside[RELOCATION_CONFIRMATIONS - 1].taken_at - inside[0].taken_at
            stayed = b.end_at - b.start_at if b.end_at else None
            back = c is not None and bool(c.move) and metres((a.lat, a.lon), (c.lat, c.lon)) <= SITE_THRESHOLD_METERS
            burst = confirmed_in <= timedelta(minutes=1)
            counts["moves"] += 1
            counts["one burst"] += burst
            counts["came back"] += back
            counts["came back within a week"] += back and stayed <= SHORT_TRIP
            counts["came back within a day"] += back and stayed <= timedelta(days=1)
            counts["one burst, did not come back within a week"] += burst and not (back and stayed <= SHORT_TRIP)
            counts["5 photos or fewer"] += len(inside) <= 5
            counts["5 photos or fewer, did not come back within a week"] += (
                len(inside) <= 5 and not (back and stayed <= SHORT_TRIP))
            counts["over 20 km"] += b.move.distance_m > 20_000
            counts["250 to 400 m"] += b.move.distance_m < 400
            print(f"   {camera_id:>6}  {b.start_at.date()}  {b.move.distance_m:>6.0f}  "
                  f"{(f'{stayed.total_seconds() / 86400:.1f} d' if stayed else 'still there'):>9}  {len(inside):>6}  "
                  f"{(f'{confirmed_in.total_seconds():.0f} s' if burst else f'{confirmed_in.total_seconds() / 3600:.1f} h'):>12}  "
                  f"{'yes' if back else ''}")
        # A camera whose first photos are far from everything after them.
        if len(built) > 1 and built[1].move and len(built[0].image_ids) <= 3 and built[1].move.distance_m > 1000:
            counts["first photos far from the rest"] += 1
    for name, n in counts.items():
        print(f"   {name}: {n}")

    print("\nC. Other fixed rules (distance, far readings in a row)")
    print("   rule        deployments  moves  short trips  moves that stayed  of those under 250 m")
    for distance_m, confirmations in RULES:
        deployments = moves = trips = stayed_small = 0
        for readings in cameras.values():
            built = build(readings, distance_m, confirmations)
            deployments += len(built)
            moves += sum(1 for d in built if d.move)
            trips += short_trips(built, distance_m)
            # Of the moves that are no part of a short trip: the small ones.
            for a, b, c in zip([None] + built, built, built[1:] + [None]):
                if not b.move or b.move.distance_m >= SITE_THRESHOLD_METERS:
                    continue
                out = c is not None and c.move and b.end_at - b.start_at <= SHORT_TRIP
                back = a is not None and a.move and a.end_at - a.start_at <= SHORT_TRIP
                stayed_small += 0 if out or back else 1
        mark = "  (today)" if (distance_m, confirmations) == (SITE_THRESHOLD_METERS, RELOCATION_CONFIRMATIONS) else ""
        print(f"   {distance_m:>3} m, {confirmations}  {deployments:>11}  {moves:>5}  {trips:>11}  "
              f"{moves - 2 * trips:>17}  {stayed_small:>20}{mark}")

    print("\nE. Moves under 250 m that a 100 m rule (2 readings) would add")
    print("   camera  day         metres  stayed     photos  came back")
    for camera_id, readings in cameras.items():
        built = build(readings, 100, 2)
        for a, b, c in zip(built, built[1:], built[2:] + [None]):
            if not b.move or b.move.distance_m >= SITE_THRESHOLD_METERS:
                continue
            stayed = b.end_at - b.start_at if b.end_at else None
            back = c is not None and bool(c.move) and metres((a.lat, a.lon), (c.lat, c.lon)) <= 100
            print(f"   {camera_id:>6}  {b.start_at.date()}  {b.move.distance_m:>6.0f}  "
                  f"{(f'{stayed.total_seconds() / 86400:.1f} d' if stayed else 'still there'):>9}  "
                  f"{len(b.image_ids):>6}  {'yes' if back else ''}")


if __name__ == "__main__":
    main()
