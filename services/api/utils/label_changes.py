"""
What happens to rules and thresholds when a label leaves a project.

A project loses a label when an admin uploads a SpeciesNet label CSV without
it, or narrows the species list of a fixed-class project. One rule covers
both: the label is removed everywhere it is used. A detection rule or
species report that has no label left is deleted, and a confidence threshold
on the label is deleted. Everything else stays as it is.

The admin sees the counts first (the endpoints answer 409 with the impact
until the request confirms), and every other affected user gets one email
after the save. clean_gone_labels gives the window its numbers and does the
work, so the two cannot disagree.
"""
from dataclasses import dataclass, field
from typing import Iterable, List, Optional

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.classification_models import SPECIESNET, class_labels, get_model
from shared.logger import get_logger
from shared.models import DetectionAlertRule, Project, ScheduledReportRule, TaxonomyMapping, User
from shared.project_channels import project_channel_of
from shared.taxonomy import stale_labels
from auth.permissions import can_access_project
from mailer.sender import get_email_sender

logger = get_logger("api.label_changes")

RULE_MODELS = (DetectionAlertRule, ScheduledReportRule)
NEEDS_CONFIRMATION = "label_changes_need_confirmation"


class LabelChangeImpact(BaseModel):
    """What a label change removes. Counts only: rules are private to the
    user who made them, so the admin never sees whose they are."""
    labels: List[str]  # the labels that disappear and are in use, sorted
    rules_updated: int  # rules that lose a label and keep others
    rules_deleted: int  # rules that have no label left
    thresholds_removed: int
    users_emailed: int

    @property
    def is_empty(self) -> bool:
        return not (self.rules_updated or self.rules_deleted or self.thresholds_removed)


@dataclass
class Recipient:
    """One user whose own rules changed, and what changed for them."""
    email: str
    labels: set[str] = field(default_factory=set)
    rules_updated: int = 0
    rules_deleted: int = 0


def fixed_model_labels(model_id: str, included_species: Optional[List[str]]) -> List[str]:
    """The labels a fixed-class project can produce: its species list, or
    every class of the model when the list is empty (which means all)."""
    return list(included_species) if included_species else class_labels(model_id)


async def project_labels(db: AsyncSession, project: Project) -> List[str]:
    """The labels a project can produce right now."""
    if get_model(project.classification_model).kind == SPECIESNET:
        result = await db.execute(
            select(TaxonomyMapping.common).where(TaxonomyMapping.project_id == project.id).distinct()
        )
        return [row[0] for row in result.all()]
    return fixed_model_labels(project.classification_model, project.included_species)


def threshold_overrides(project: Project) -> dict:
    return (project.classification_thresholds or {}).get("overrides") or {}


async def _rules(db: AsyncSession, project_id: int) -> list:
    """Every detection rule and species report of the project, of every user."""
    rules: list = []
    for model in RULE_MODELS:
        result = await db.execute(select(model).where(model.project_id == project_id))
        rules.extend(result.scalars().all())
    return rules


async def _reachable_owners(db: AsyncSession, project_id: int, owner_ids: Iterable[int]) -> dict[int, str]:
    """Email per owner who can still get and use the message: active,
    verified, and with access to the project."""
    owner_ids = set(owner_ids)
    if not owner_ids:
        return {}
    result = await db.execute(
        select(User).where(
            User.id.in_(owner_ids),
            User.is_active == True,  # noqa: E712
            User.is_verified == True,  # noqa: E712
        )
    )
    return {
        user.id: user.email
        for user in result.scalars().all()
        if await can_access_project(user, project_id, db)
    }


async def clean_gone_labels(
    db: AsyncSession,
    project: Project,
    labels: Iterable[str],
    current_user: User,
    apply: bool,
) -> tuple[LabelChangeImpact, List[Recipient]]:
    """
    Remove labels that are not in `labels` from the project's rules and
    thresholds, or only count what that would remove.

    Args:
        labels: the labels the project can produce after the change
        current_user: the admin who makes the change, who gets no email
        apply: False counts and writes nothing. True also writes; the caller
            commits.

    Returns:
        The impact, and the users to email: the owners of changed personal
        rules, without the admin, and without rules on a project channel,
        which belong to the project and not to a person.
    """
    labels = list(labels)
    gone_labels: set[str] = set()
    rules_updated = rules_deleted = 0
    changed_by_owner: dict[int, Recipient] = {}

    for rule in await _rules(db, project.id):
        if not rule.species:  # a detection rule for all labels
            continue
        gone = stale_labels(rule.species, labels)
        if not gone:
            continue
        kept = [label for label in rule.species if label not in gone]
        gone_labels.update(gone)
        rules_updated += bool(kept)
        rules_deleted += not kept

        personal = project_channel_of(getattr(rule, "channels", None)) is None
        if personal and rule.created_by_user_id != current_user.id:
            owner = changed_by_owner.setdefault(rule.created_by_user_id, Recipient(email=""))
            owner.labels.update(gone)
            owner.rules_updated += bool(kept)
            owner.rules_deleted += not kept

        if apply and kept:
            rule.species = kept
        elif apply:
            await db.delete(rule)

    overrides = threshold_overrides(project)
    gone_thresholds = stale_labels(overrides, labels)
    gone_labels.update(gone_thresholds)
    if apply and gone_thresholds:
        project.classification_thresholds = {
            **project.classification_thresholds,
            "overrides": {label: value for label, value in overrides.items() if label not in gone_thresholds},
        }

    emails = await _reachable_owners(db, project.id, changed_by_owner)
    recipients = []
    for owner_id, email in emails.items():
        changed_by_owner[owner_id].email = email
        recipients.append(changed_by_owner[owner_id])

    impact = LabelChangeImpact(
        labels=sorted(gone_labels),
        rules_updated=rules_updated,
        rules_deleted=rules_deleted,
        thresholds_removed=len(gone_thresholds),
        users_emailed=len(recipients),
    )
    return impact, recipients


async def confirm_or_refuse(
    db: AsyncSession,
    project: Project,
    labels: Iterable[str],
    current_user: User,
    confirmed: bool,
) -> None:
    """Answer 409 with the impact when the change removes something and the
    request did not confirm it. Writes nothing."""
    impact, _ = await clean_gone_labels(db, project, labels, current_user, apply=False)
    if not impact.is_empty and not confirmed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": NEEDS_CONFIRMATION, "impact": impact.model_dump()},
        )


async def send_label_change_emails(project_id: int, project_name: str, recipients: List[Recipient]) -> None:
    """One email per affected user. Best effort, after the commit: a failed
    send is logged and never fails the request, like the other emails the
    API sends."""
    for recipient in recipients:
        try:
            await get_email_sender().send_labels_removed_email(
                email=recipient.email,
                project_id=project_id,
                project_name=project_name,
                labels=sorted(recipient.labels),
                rules_updated=recipient.rules_updated,
                rules_deleted=recipient.rules_deleted,
            )
        except Exception as e:
            logger.error("Labels removed email failed", project_id=project_id, error=str(e), exc_info=True)
