"""
Scheduled species report emails.

Evaluates the users' scheduled report rules (see ScheduledReportRule) and
emails each creator one analytical summary per rule and period: total
count with the change since the previous period, at how many active sites
the species appeared, and a per-site table with count, trap-days, and the
rate per 100 trap-days.

Counting follows the insights map. When the project has an independence
interval, counts are independent events from the shared independence CTE;
otherwise they are raw counts with the verified-preferred convention
(human observation counts for verified images, AI classifications and
person/vehicle detections for unverified ones). Both periods of a report
always use the same counting path so the comparison is like with like.

Trap-days are clipped to the report period, unlike the map, which counts
whole deployment lengths. A site is active in a period when it has at
least one trap-day in it; sites without effort are excluded from the
table and the presence numbers so a missing camera is never read as an
absent species.

The daily cron at 07:30 UTC sends rules due on the server-local date:
weekly on Monday, monthly on the 1st, quarterly on 1 Jan/Apr/Jul/Oct. No
delivery state is kept; the in-memory scheduler cannot re-fire a crashed
run, so a missed period is possible but a duplicate email is not, and
NotificationLog records what was sent. A last_sent_period_end column is
the upgrade path if manual re-runs ever become a tool.
"""
from typing import Any, Dict, List, Optional, Tuple
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, text

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.models import Project, ProjectMembership, ScheduledReportRule, User
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL
from shared.config import get_settings
from shared.email_renderer import render_email
from shared.classification_threshold import CLASSIFICATION_THRESHOLD_FILTER_SQL
from shared.independence_filter import get_independent_site_species_counts_sync

from db_operations import (
    create_notification_log,
    get_server_timezone,
    project_wide_email_skip_reason,
)

logger = get_logger("notifications.scheduled_species_reports")
settings = get_settings()

FREQUENCY_LABELS = {
    "weekly": "Weekly",
    "monthly": "Monthly",
    "quarterly": "Quarterly",
}

# Effort changes beyond this fraction between the two periods make the
# rate comparison misleading, so the email warns about it
EFFORT_WARNING_FRACTION = 0.25


# ---------------------------------------------------------------------------
# Pure date logic


def due_frequencies(today: date) -> set:
    """Frequencies whose rules send on this server-local date."""
    due = set()
    if today.weekday() == 0:
        due.add("weekly")
    if today.day == 1:
        due.add("monthly")
        if today.month in (1, 4, 7, 10):
            due.add("quarterly")
    return due


def compute_period(frequency: str, today: date) -> Tuple[date, date]:
    """Report period for a rule sending on ``today``.

    The period always ends yesterday: the previous Mon-Sun week, the
    previous calendar month, or the previous quarter. Leap years and year
    rollovers fall out of the date arithmetic without special cases.
    """
    end = today - timedelta(days=1)
    if frequency == "weekly":
        return end - timedelta(days=6), end
    if frequency == "monthly":
        return end.replace(day=1), end
    if frequency == "quarterly":
        quarter_month = ((end.month - 1) // 3) * 3 + 1
        return date(end.year, quarter_month, 1), end
    raise ValueError(f"unknown frequency {frequency}")


def previous_period(frequency: str, start: date) -> Tuple[date, date]:
    """The period directly before one starting at ``start``.

    ``start`` is itself a valid send date for the frequency (a Monday or
    a period's first day), so the previous period is simply the period of
    a report sent on ``start``.
    """
    return compute_period(frequency, start)


def period_label(frequency: str, start: date, end: date) -> str:
    """Human-readable period, same style as the project report emails."""
    if frequency == "monthly":
        return start.strftime("%B %Y")
    if frequency == "quarterly":
        return f"{start.strftime('%B')} - {end.strftime('%B %Y')}"
    return f"{start.strftime('%B %d')} - {end.strftime('%B %d, %Y')}"


# ---------------------------------------------------------------------------
# Pure report assembly


def rate_per_100(count: int, trap_days: int) -> Optional[float]:
    """Detections per 100 trap-days, or None when there is no effort.

    A count without effort (camera clock drift can put images outside
    every deployment window) must never render as a real 0.0 rate.
    """
    if trap_days <= 0:
        return None
    return round(count / trap_days * 100, 1)


def delta_label(delta: Optional[int]) -> str:
    """Signed change for display, n/a when no comparison exists."""
    if delta is None:
        return "n/a"
    return f"+{delta}" if delta > 0 else str(delta)


def build_species_block(
    label: str,
    cur_by_site: Dict[Optional[int], int],
    prev_total: int,
    effort_rows: List[Dict[str, Any]],
    no_prior_effort: bool,
) -> Dict[str, Any]:
    """Assemble one species section of the report.

    cur_by_site maps site_id (None for images without a resolved site) to
    the period count. effort_rows carry every site of the project with
    its trap-days in the period; sites without effort are excluded from
    the table and the presence numbers.
    """
    active = [row for row in effort_rows if row["trap_days"] > 0]
    active_site_ids = {row["site_id"] for row in active}

    rows = []
    for row in active:
        count = cur_by_site.get(row["site_id"], 0)
        rows.append({
            "site_name": row["site_name"],
            "count": count,
            "trap_days": row["trap_days"],
            "rate_per_100": rate_per_100(count, row["trap_days"]),
        })

    # Freak case, counts at a site with zero effort in the period. Shown
    # with an n/a rate so the header total still equals the table sum.
    names_by_id = {row["site_id"]: row["site_name"] for row in effort_rows}
    for site_id, count in cur_by_site.items():
        if site_id is None or site_id in active_site_ids or count <= 0:
            continue
        rows.append({
            "site_name": names_by_id.get(site_id, f"Site {site_id}"),
            "count": count,
            "trap_days": 0,
            "rate_per_100": None,
        })

    rows.sort(key=lambda r: (-r["count"], r["site_name"]))

    total = sum(count for count in cur_by_site.values())
    sites_detected = sum(
        1 for row in active if cur_by_site.get(row["site_id"], 0) > 0
    )
    delta = None if no_prior_effort else total - prev_total

    return {
        "label": label,
        "total": total,
        "prev_total": prev_total,
        "delta": delta,
        "delta_label": delta_label(delta),
        "sites_detected": sites_detected,
        "active_sites": len(active),
        "presence_line": f"detected at {sites_detected} of {len(active)} active sites",
        "rows": rows,
        "unassigned_count": cur_by_site.get(None, 0),
    }


def build_report_data(
    rule_species: List[str],
    cur_counts: List[Dict[str, Any]],
    prev_counts: List[Dict[str, Any]],
    effort_rows: List[Dict[str, Any]],
    prev_effort_rows: List[Dict[str, Any]],
    interval_minutes: int,
) -> Dict[str, Any]:
    """Assemble the analytical core of one report.

    cur_counts and prev_counts are {site_id, species, count} rows with
    lowercased species. Species blocks keep the rule's own label spelling
    and order; matching is case-insensitive.
    """
    trap_days_total = sum(row["trap_days"] for row in effort_rows)
    prev_trap_days_total = sum(row["trap_days"] for row in prev_effort_rows)
    no_prior_effort = prev_trap_days_total == 0

    def by_species(rows: List[Dict[str, Any]]) -> Dict[str, Dict[Optional[int], int]]:
        result: Dict[str, Dict[Optional[int], int]] = {}
        for row in rows:
            result.setdefault(row["species"], {})[row["site_id"]] = row["count"]
        return result

    cur_map = by_species(cur_counts)
    prev_map = by_species(prev_counts)

    blocks = []
    for label in rule_species:
        key = label.lower()
        blocks.append(build_species_block(
            label=label,
            cur_by_site=cur_map.get(key, {}),
            prev_total=sum(prev_map.get(key, {}).values()),
            effort_rows=effort_rows,
            no_prior_effort=no_prior_effort,
        ))

    total = sum(block["total"] for block in blocks)
    prev_total = sum(block["prev_total"] for block in blocks)
    combined_delta = None if no_prior_effort else total - prev_total

    if prev_trap_days_total > 0:
        effort_change = (trap_days_total - prev_trap_days_total) / prev_trap_days_total
        effort_change_pct: Optional[float] = round(effort_change * 100, 1)
        effort_warning = abs(effort_change) > EFFORT_WARNING_FRACTION
    else:
        effort_change_pct = None
        effort_warning = False

    if interval_minutes > 0:
        counting_label = (
            f"independent events with a {interval_minutes} minute interval"
        )
    else:
        counting_label = "raw detections without an independence interval"

    active_sites = sum(1 for row in effort_rows if row["trap_days"] > 0)

    return {
        "active_sites": active_sites,
        "combined": {
            "total": total,
            "prev_total": prev_total,
            "delta": combined_delta,
            "delta_label": delta_label(combined_delta),
        },
        "species_blocks": blocks,
        "methods": {
            "counting_label": counting_label,
            "trap_days_total": trap_days_total,
            "prev_trap_days_total": prev_trap_days_total,
            "effort_change_pct": effort_change_pct,
            "effort_warning": effort_warning,
            "no_prior_effort": no_prior_effort,
            "inactive_sites": len(effort_rows) - active_sites,
        },
    }


def eligibility_skip_reason(user, membership_role, membership_site_ids) -> Optional[str]:
    """Why a rule must not send to its creator, or None.

    The report aggregates over the whole project, so the standard
    project-wide email guard applies (stale membership, site-restricted
    viewer), plus a creator without an email address.
    """
    skip = project_wide_email_skip_reason(
        user.is_superuser, membership_role, membership_site_ids,
    )
    if skip:
        return skip
    if not user.email:
        return "no_email_address"
    return None


# ---------------------------------------------------------------------------
# Queries (sync session)


def get_site_effort(db, project_id: int, start: date, end: date) -> List[Dict[str, Any]]:
    """Every site of the project with its trap-days clipped to the period.

    Open-ended deployments are clipped to the period end, which always
    lies in the past, so nothing here depends on the database server's
    own date or timezone. The inverted-date guard mirrors the map
    endpoint's defense against zombie rows.
    """
    query = text("""
        SELECT s.id AS site_id, s.name AS site_name,
               COALESCE(SUM(GREATEST(0,
                   LEAST(COALESCE(dep.end_date, :period_end), :period_end)
                   - GREATEST(dep.start_date, :period_start) + 1)), 0)::int AS trap_days
        FROM sites s
        LEFT JOIN deployments dep ON dep.site_id = s.id
            AND dep.start_date <= :period_end
            AND COALESCE(dep.end_date, :period_end) >= :period_start
            AND (dep.end_date IS NULL OR dep.end_date >= dep.start_date)
        WHERE s.project_id = :project_id
        GROUP BY s.id, s.name
        ORDER BY s.name
    """)
    rows = db.execute(query, {
        "project_id": project_id,
        "period_start": start,
        "period_end": end,
    }).all()
    return [
        {"site_id": row.site_id, "site_name": row.site_name, "trap_days": row.trap_days}
        for row in rows
    ]


def get_raw_site_species_counts(
    db, project_id: int, species: List[str], start_dt: datetime, end_dt: datetime,
) -> List[Dict[str, Any]]:
    """Per-site raw counts, the no-independence-interval path.

    Same verified-preferred union as the rest of the app: verified images
    contribute the human-entered count, unverified ones one per detection
    box over the project's detection threshold and the per-species
    classification threshold, person and vehicle from the detector
    category. Species are matched and returned lowercased on both sides;
    sites resolve through the image's own deployment, which is
    time-correct for cameras that moved.
    """
    query = text(f"""
        WITH obs AS (
            SELECT dep.site_id, LOWER(ho.species) AS species, ho.count AS cnt
            FROM human_observations ho
            JOIN images i ON ho.image_id = i.id
            JOIN cameras c ON i.camera_id = c.id
            LEFT JOIN deployments dep ON i.deployment_id = dep.id
            WHERE c.project_id = :project_id
              AND i.is_verified = true
              AND LOWER(ho.species) = ANY(CAST(:species_list AS text[]))
              AND i.captured_at >= :start_dt AND i.captured_at <= :end_dt
          UNION ALL
            SELECT dep.site_id, LOWER(cl.species), 1
            FROM classifications cl
            JOIN detections d ON cl.detection_id = d.id
            JOIN images i ON d.image_id = i.id
            JOIN cameras c ON i.camera_id = c.id
            JOIN projects p ON c.project_id = p.id
            LEFT JOIN deployments dep ON i.deployment_id = dep.id
            WHERE c.project_id = :project_id
              AND i.is_verified = false
              AND d.confidence >= p.detection_threshold
              AND {CLASSIFICATION_THRESHOLD_FILTER_SQL.strip()}
              AND LOWER(cl.species) = ANY(CAST(:species_list AS text[]))
              AND i.captured_at >= :start_dt AND i.captured_at <= :end_dt
          UNION ALL
            SELECT dep.site_id, d.category, 1
            FROM detections d
            JOIN images i ON d.image_id = i.id
            JOIN cameras c ON i.camera_id = c.id
            JOIN projects p ON c.project_id = p.id
            LEFT JOIN deployments dep ON i.deployment_id = dep.id
            WHERE c.project_id = :project_id
              AND i.is_verified = false
              AND d.category IN ('person', 'vehicle')
              AND d.confidence >= p.detection_threshold
              AND LOWER(d.category) = ANY(CAST(:species_list AS text[]))
              AND i.captured_at >= :start_dt AND i.captured_at <= :end_dt
        )
        SELECT site_id, species, SUM(cnt)::int AS count
        FROM obs
        GROUP BY site_id, species
    """)
    rows = db.execute(query, {
        "project_id": project_id,
        "species_list": [s.lower() for s in species],
        "start_dt": start_dt,
        "end_dt": end_dt,
    }).all()
    return [
        {"site_id": row.site_id, "species": row.species, "count": row.count}
        for row in rows
    ]


def get_site_species_counts(
    db, project_id: int, interval_minutes: int, species: List[str],
    start: date, end: date,
) -> List[Dict[str, Any]]:
    """Per-site counts for the period, on the project's counting path.

    captured_at is naive camera-clock interpreted under the server
    timezone, so the period bounds are naive datetimes.
    """
    start_dt = datetime.combine(start, datetime.min.time())
    end_dt = datetime.combine(end, datetime.max.time())
    if interval_minutes > 0:
        return get_independent_site_species_counts_sync(
            db, project_id, interval_minutes, species, start_dt, end_dt,
        )
    return get_raw_site_species_counts(db, project_id, species, start_dt, end_dt)


# ---------------------------------------------------------------------------
# Rendering


def generate_text_report(data: Dict[str, Any]) -> str:
    """Plain text version of the report."""
    combined = data["combined"]
    methods = data["methods"]
    lines = [
        f"{data['project_name']} - {data['frequency']} species report",
        f"Period {data['period_label']}",
        "=" * 50,
        "",
        f"Total {combined['total']} (previous period {combined['prev_total']}, "
        f"change {combined['delta_label']})",
        "",
    ]

    for block in data["species_blocks"]:
        lines.extend([
            block["label"].replace("_", " ").title(),
            "-" * 20,
            f"Total {block['total']} ({block['delta_label']} compared with the previous period)",
            block["presence_line"].capitalize(),
        ])
        if block["rows"]:
            lines.append("Site, count, trap-days, per 100 trap-days")
            for row in block["rows"]:
                rate = "n/a" if row["rate_per_100"] is None else row["rate_per_100"]
                lines.append(
                    f"  {row['site_name']}, {row['count']}, {row['trap_days']}, {rate}"
                )
        else:
            lines.append("No camera effort was recorded in this period.")
        if block["unassigned_count"] > 0:
            lines.append(f"  No site assigned, {block['unassigned_count']}")
        lines.append("")

    lines.extend([
        "About these numbers",
        "-" * 20,
        f"Counted as {methods['counting_label']}.",
        "Counts include unverified AI identifications.",
        "Camera effort is counted within the report period only.",
        f"Total effort {methods['trap_days_total']} trap-days "
        f"(previous period {methods['prev_trap_days_total']}).",
    ])
    if methods["effort_warning"]:
        lines.append(
            f"Camera effort changed by {methods['effort_change_pct']}% compared "
            "with the previous period, so rates are not directly comparable."
        )
    if methods["no_prior_effort"]:
        lines.append(
            "No camera effort was recorded in the previous period, "
            "so no comparison is shown."
        )
    if methods["inactive_sites"] > 0:
        lines.append(
            f"{methods['inactive_sites']} sites had no camera effort in this period."
        )
    lines.extend([
        "",
        "-" * 50,
        f"View the project dashboard {data['project_url']}",
        f"Manage notifications {data['settings_url']}",
    ])
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Scheduled job


def send_scheduled_species_reports() -> None:
    """Scheduled job. Send every active rule due on the server-local date."""
    logger.info("Starting scheduled species reports")

    with get_sync_session() as db:
        tz = get_server_timezone(db)
    today = datetime.now(tz).date()

    due = due_frequencies(today)
    if not due:
        logger.info("No report frequencies due today", run_date=today.isoformat())
        return

    periods = {}
    for frequency in due:
        start, end = compute_period(frequency, today)
        periods[frequency] = (start, end, previous_period(frequency, start))

    domain = settings.domain_name or "localhost:3000"

    with get_sync_session() as db:
        rows = list(db.execute(
            select(
                ScheduledReportRule, User, Project,
                ProjectMembership.role, ProjectMembership.site_ids,
            )
            .join(User, ScheduledReportRule.created_by_user_id == User.id)
            .join(Project, ScheduledReportRule.project_id == Project.id)
            .outerjoin(
                ProjectMembership,
                (ProjectMembership.user_id == User.id)
                & (ProjectMembership.project_id == ScheduledReportRule.project_id),
            )
            .where(
                ScheduledReportRule.is_active == True,
                ScheduledReportRule.frequency.in_(due),
                User.is_active == True,
                User.is_verified == True,
            )
            .order_by(ScheduledReportRule.project_id.asc(), ScheduledReportRule.id.asc())
        ).all())

        if not rows:
            logger.info("No active rules due", frequencies=sorted(due))
            return

        logger.info(
            "Sending scheduled species reports",
            rule_count=len(rows), frequencies=sorted(due),
        )

        email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
        # (project_id, frequency) -> (effort_rows, prev_effort_rows); the
        # effort is species-independent so rules can share it
        effort_cache: Dict[Tuple[int, str], Tuple[list, list]] = {}
        sent = skipped = failed = 0

        for rule, user, project, membership_role, membership_site_ids in rows:
            try:
                skip = eligibility_skip_reason(user, membership_role, membership_site_ids)
                if skip:
                    logger.info(
                        "Skipping species report",
                        rule_id=rule.id, user_id=user.id,
                        project_id=project.id, reason=skip,
                    )
                    skipped += 1
                    continue

                start, end, (prev_start, prev_end) = periods[rule.frequency]

                cache_key = (project.id, rule.frequency)
                if cache_key not in effort_cache:
                    effort_cache[cache_key] = (
                        get_site_effort(db, project.id, start, end),
                        get_site_effort(db, project.id, prev_start, prev_end),
                    )
                effort_rows, prev_effort_rows = effort_cache[cache_key]

                interval = project.independence_interval_minutes or 0
                cur_counts = get_site_species_counts(
                    db, project.id, interval, rule.species, start, end,
                )
                prev_counts = get_site_species_counts(
                    db, project.id, interval, rule.species, prev_start, prev_end,
                )

                report = build_report_data(
                    rule.species, cur_counts, prev_counts,
                    effort_rows, prev_effort_rows, interval,
                )

                frequency_label = FREQUENCY_LABELS[rule.frequency]
                label = period_label(rule.frequency, start, end)
                template_data = {
                    "project_name": project.name,
                    "project_url": f"https://{domain}/projects/{project.id}/dashboard",
                    "settings_url": f"https://{domain}/projects/{project.id}/notifications",
                    "domain": domain,
                    "frequency": frequency_label,
                    "period_label": label,
                    "prev_period_label": period_label(rule.frequency, prev_start, prev_end),
                    **report,
                }

                try:
                    html_content, _ = render_email(
                        "scheduled_species_report.html", **template_data,
                    )
                except Exception as e:
                    logger.warning(
                        "Failed to render HTML template, using text only",
                        rule_id=rule.id, error=str(e),
                    )
                    html_content = None
                text_content = generate_text_report(template_data)

                subject = f"{project.name} - {frequency_label} species report ({label})"

                log_id = create_notification_log(
                    user_id=user.id,
                    notification_type="scheduled_species_report",
                    channel="email",
                    trigger_data={
                        "rule_id": rule.id,
                        "project_id": project.id,
                        "project_name": project.name,
                        "species": rule.species,
                        "frequency": rule.frequency,
                        "start_date": start.isoformat(),
                        "end_date": end.isoformat(),
                        "period_label": label,
                        "generated_at": datetime.now(timezone.utc).isoformat(),
                    },
                    message_content=text_content[:1000],
                )

                email_queue.publish({
                    "notification_log_id": log_id,
                    "to_email": user.email,
                    "subject": subject,
                    "body_text": text_content,
                    "body_html": html_content,
                })
                sent += 1

                logger.info(
                    "Queued species report",
                    rule_id=rule.id, user_id=user.id, project_id=project.id,
                    frequency=rule.frequency, log_id=log_id,
                )

            except Exception as e:
                # A SQL error poisons the shared session; roll back so the
                # remaining rules still run
                db.rollback()
                logger.error(
                    "Failed to send species report",
                    rule_id=rule.id, user_id=user.id, project_id=project.id,
                    error=str(e), exc_info=True,
                )
                failed += 1
                continue

        logger.info(
            "Scheduled species reports completed",
            total=len(rows), sent=sent, skipped=skipped, failed=failed,
        )
