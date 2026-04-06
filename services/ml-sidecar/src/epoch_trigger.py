"""Epoch trigger service — creates decision epochs for invoices.

Runs after Stripe webhooks and on a daily schedule. For each open/overdue
invoice, checks whether a new decision epoch should be emitted based on
the invoice's current lifecycle stage.

Also resolves outcomes for epochs whose observation window has closed.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from .db import (
    get_event_counts_for_object,
    get_object_state_at,
    get_party_id_for_invoice,
    get_unresolved_epochs,
    resolve_epoch_outcome,
    upsert_decision_epoch,
)
from .features import build_full_feature_vector, compute_feature_hash
from .tenant_stats import load_tenant_stats_with_customer
from .trajectory import load_customer_trajectory

logger = logging.getLogger(__name__)

# Epoch triggers and their conditions (days overdue thresholds)
EPOCH_TRIGGERS = [
    {"trigger": "issued", "min_overdue": None, "max_overdue": None, "on_status": "sent"},
    {"trigger": "due", "min_overdue": 0, "max_overdue": 0},
    {"trigger": "3d_overdue", "min_overdue": 3, "max_overdue": 6},
    {"trigger": "7d_overdue", "min_overdue": 7, "max_overdue": 13},
    {"trigger": "14d_overdue", "min_overdue": 14, "max_overdue": 29},
    {"trigger": "30d_overdue", "min_overdue": 30, "max_overdue": None},
]

# Outcome observation windows (how long to wait for each label)
OUTCOME_WINDOWS = {
    "issued": timedelta(days=45),
    "due": timedelta(days=37),
    "3d_overdue": timedelta(days=34),
    "7d_overdue": timedelta(days=30),
    "14d_overdue": timedelta(days=23),
    "30d_overdue": timedelta(days=37),
    "partial_payment": timedelta(days=30),
    "dispute_opened": timedelta(days=60),
}

# Standard eligible actions for AR collection epochs
ELIGIBLE_ACTIONS = [
    "strategic.hold",
    "communicate.email",
    "task.create",
]


def _generate_epoch_id() -> str:
    import time
    import os
    ts = int(time.time() * 1000)
    rand = os.urandom(10).hex()
    return f"ep_{ts:013x}_{rand}"


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def determine_epoch_trigger(
    state: dict[str, Any],
    reference_time: datetime,
) -> str | None:
    """Determine which epoch trigger applies to an invoice at a given time."""
    status = str(state.get("status") or "").lower()
    due_at = _parse_datetime(state.get("dueAt"))

    # Special status-based triggers
    if status in ("disputed",):
        return "dispute_opened"
    if status in ("paid", "voided", "written_off"):
        return None  # No epoch for terminal states

    # Just issued, not yet due
    if status == "sent" and (due_at is None or reference_time < due_at):
        return "issued"

    # Overdue-based triggers
    if due_at is not None:
        days_overdue = (reference_time - due_at).total_seconds() / 86400.0
        if days_overdue < 0:
            return "issued"  # Not yet due

        # Find the matching trigger based on overdue days
        for trigger_def in reversed(EPOCH_TRIGGERS):
            min_d = trigger_def.get("min_overdue")
            if min_d is not None and days_overdue >= min_d:
                return trigger_def["trigger"]

        # Exactly at due date
        if days_overdue >= 0:
            return "due"

    return None


async def create_epoch_for_invoice(
    pool,
    tenant_id: str,
    object_id: str,
    *,
    reference_time: datetime | None = None,
    tenant_stats: dict[str, float] | None = None,
    trajectory: dict[str, float] | None = None,
) -> dict | None:
    """Create a decision epoch for an invoice if one is warranted.

    Returns the epoch dict if created, None if skipped.
    """
    now = reference_time or datetime.now(timezone.utc)
    as_of_str = now.isoformat()

    # Get point-in-time object state
    obj = await get_object_state_at(pool, tenant_id, object_id, as_of_str)
    if obj is None:
        return None

    state = obj["state"]
    estimated = obj["estimated"]

    # Determine which trigger applies
    trigger = determine_epoch_trigger(state, now)
    if trigger is None:
        return None

    # Get event counts for this invoice up to reference_time
    event_counts = await get_event_counts_for_object(pool, tenant_id, object_id, as_of_str)

    # Resolve party (customer) for this invoice
    party_id = await get_party_id_for_invoice(pool, tenant_id, object_id)

    # Load tenant stats with customer percentile if not provided
    if tenant_stats is None:
        tenant_stats = await load_tenant_stats_with_customer(pool, tenant_id, party_id)

    # Load customer trajectory if not provided
    if trajectory is None and party_id:
        trajectory = await load_customer_trajectory(
            pool, tenant_id, party_id, before=as_of_str, reference_time=now,
        )

    # Build point-in-time feature vector
    features = build_full_feature_vector(
        state,
        estimated,
        reference_time=now,
        tenant_stats=tenant_stats,
        event_counts=event_counts,
        trajectory=trajectory,
    )
    feature_hash = compute_feature_hash(features)

    # Compute outcome window
    window = OUTCOME_WINDOWS.get(trigger, timedelta(days=37))
    outcome_window_end = now + window

    epoch = {
        "id": _generate_epoch_id(),
        "tenant_id": tenant_id,
        "object_id": object_id,
        "object_type": "invoice",
        "epoch_trigger": trigger,
        "epoch_at": now,
        "feature_snapshot": features,
        "feature_hash": feature_hash,
        "eligible_actions": ELIGIBLE_ACTIONS,
        "chosen_action": None,
        "chosen_action_id": None,
        "propensity": None,
        "policy_version": None,
        "outcome_window_end": outcome_window_end,
        "outcome_label": None,
        "outcome_resolved": False,
    }

    await upsert_decision_epoch(pool, epoch)
    logger.info(
        "Created epoch %s for %s/%s trigger=%s",
        epoch["id"], tenant_id, object_id, trigger,
    )
    return epoch


async def sweep_invoices_for_epochs(
    pool,
    tenant_id: str,
    *,
    tenant_stats: dict[str, float] | None = None,
    limit: int = 200,
) -> int:
    """Sweep all open/overdue invoices for a tenant and create epochs where warranted.

    Returns the number of epochs created.
    """
    rows = await pool.fetch(
        """
        SELECT id, tenant_id
        FROM world_objects
        WHERE tenant_id = $1
          AND type = 'invoice'
          AND NOT tombstone
          AND valid_to IS NULL
          AND (
            state->>'status' IN ('sent', 'overdue', 'partial', 'disputed')
            OR (
              state->>'status' NOT IN ('paid', 'voided', 'written_off')
              AND (state->>'amountRemainingCents')::numeric > 0
            )
          )
        ORDER BY updated_at DESC
        LIMIT $2
        """,
        tenant_id,
        limit,
    )

    created = 0
    for row in rows:
        result = await create_epoch_for_invoice(
            pool,
            tenant_id,
            row["id"],
            tenant_stats=tenant_stats,
        )
        if result is not None:
            created += 1

    logger.info("Epoch sweep for tenant %s: %d/%d invoices got epochs", tenant_id, created, len(rows))
    return created


async def resolve_pending_outcomes(
    pool,
    tenant_id: str | None = None,
    limit: int = 500,
) -> int:
    """Resolve outcomes for epochs whose observation window has closed.

    Checks whether the invoice was paid (and when) by looking at the
    current object state and payment events.

    Returns the number of epochs resolved.
    """
    epochs = await get_unresolved_epochs(pool, tenant_id, limit)
    resolved = 0

    for epoch in epochs:
        eid = epoch["epoch_id"]
        oid = epoch["object_id"]
        tid = epoch["tenant_id"]
        epoch_at = epoch["epoch_at"]

        # Get current state to check terminal status
        current = await pool.fetchrow(
            """
            SELECT state, estimated
            FROM world_objects
            WHERE id = $1 AND tenant_id = $2
            """,
            oid, tid,
        )
        if current is None:
            # Object deleted — mark as censored
            await resolve_epoch_outcome(pool, eid, {
                "paid_7d": False,
                "paid_30d": False,
                "time_to_pay_days": None,
                "bad_debt": False,
                "censored": True,
            })
            resolved += 1
            continue

        state = current["state"] if isinstance(current["state"], dict) else {}
        status = str(state.get("status") or "").lower()
        epoch_at_dt = _parse_datetime(epoch_at)
        if epoch_at_dt is None:
            epoch_at_dt = datetime.now(timezone.utc)

        # Check for payment events after epoch_at
        payment_at = await pool.fetchval(
            """
            SELECT MIN(we.timestamp)
            FROM world_events we
            WHERE we.tenant_id = $1
              AND (
                we.payload->>'objectId' = $2
                OR we.payload->>'targetObjectId' = $2
              )
              AND we.type IN ('financial.payment.received', 'financial.invoice.paid')
              AND we.timestamp > $3
            """,
            tid, oid, epoch_at,
        )

        paid_at_dt = _parse_datetime(payment_at)
        if paid_at_dt:
            days_to_pay = (paid_at_dt - epoch_at_dt).total_seconds() / 86400.0
        elif status == "paid":
            # Invoice is paid but we don't have the exact payment event time
            updated_at = _parse_datetime(state.get("paidAt")) or _parse_datetime(current.get("updated_at"))
            if updated_at:
                days_to_pay = max(0, (updated_at - epoch_at_dt).total_seconds() / 86400.0)
            else:
                days_to_pay = 0.0
        else:
            days_to_pay = None

        is_paid = status == "paid" or paid_at_dt is not None
        is_bad_debt = status in ("written_off", "uncollectible")
        is_voided = status == "voided"
        is_censored = not is_paid and not is_bad_debt and not is_voided

        label = {
            "paid_7d": bool(is_paid and days_to_pay is not None and days_to_pay <= 7),
            "paid_30d": bool(is_paid and days_to_pay is not None and days_to_pay <= 30),
            "time_to_pay_days": round(days_to_pay, 2) if days_to_pay is not None else None,
            "bad_debt": bool(is_bad_debt),
            "censored": bool(is_censored),
        }

        await resolve_epoch_outcome(pool, eid, label)
        resolved += 1

    logger.info("Resolved %d/%d pending epoch outcomes", resolved, len(epochs))
    return resolved
