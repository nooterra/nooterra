"""Customer payment trajectory analysis.

Computes time-series features from a customer's invoice payment history:
- days_to_pay_slope: is the customer paying faster or slower over time?
- avg_days_to_pay: baseline payment speed
- payment_frequency_score: regularity of payments (0=erratic, 1=clockwork)
- invoices_paid_count / invoices_overdue_count: volume signals
- silence_after_outreach_days: responsiveness to collection actions
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from .db import get_customer_payment_history

logger = logging.getLogger(__name__)


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _compute_slope(values: list[float]) -> float:
    """Simple linear regression slope over an ordered series."""
    n = len(values)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(values) / n
    num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    den = sum((i - x_mean) ** 2 for i in range(n))
    if den == 0:
        return 0.0
    return num / den


def _compute_frequency_score(intervals: list[float]) -> float:
    """Score payment regularity from inter-payment intervals.

    1.0 = perfectly regular (all intervals equal)
    0.0 = extremely erratic
    """
    if len(intervals) < 2:
        return 0.0
    mean = sum(intervals) / len(intervals)
    if mean <= 0:
        return 0.0
    variance = sum((x - mean) ** 2 for x in intervals) / len(intervals)
    cv = (variance ** 0.5) / mean  # coefficient of variation
    # Map CV to 0-1 score: CV=0 -> 1.0, CV>=2 -> 0.0
    return max(0.0, min(1.0, 1.0 - cv / 2.0))


def compute_trajectory_from_history(
    invoices: list[dict[str, Any]],
    reference_time: datetime | None = None,
) -> dict[str, float]:
    """Compute trajectory features from a list of invoice records.

    Args:
        invoices: rows from get_customer_payment_history, each with
            status, issued_at, due_at, paid_at, amount_cents, etc.
        reference_time: point-in-time for computing relative features
    """
    now = reference_time or datetime.now(timezone.utc)

    days_to_pay_values: list[float] = []
    payment_timestamps: list[datetime] = []
    paid_count = 0
    overdue_count = 0

    for inv in invoices:
        status = str(inv.get("status") or "").lower()
        issued_at = _parse_dt(inv.get("issued_at"))
        due_at = _parse_dt(inv.get("due_at"))
        paid_at = _parse_dt(inv.get("paid_at"))
        if not paid_at and status == "paid":
            paid_at = _parse_dt(inv.get("updated_at"))

        if status == "paid" and issued_at and paid_at:
            paid_count += 1
            dtp = (paid_at - issued_at).total_seconds() / 86400.0
            if dtp >= 0:
                days_to_pay_values.append(dtp)
                payment_timestamps.append(paid_at)

        if due_at and now > due_at and status not in ("paid", "voided"):
            overdue_count += 1

    # Days-to-pay slope: positive = getting slower, negative = getting faster
    # Values are in chronological order (oldest first) since invoices come DESC
    slope = _compute_slope(list(reversed(days_to_pay_values)))

    # Average days to pay
    avg_dtp = sum(days_to_pay_values) / len(days_to_pay_values) if days_to_pay_values else 0.0

    # Payment frequency score
    sorted_ts = sorted(payment_timestamps)
    intervals = []
    for i in range(1, len(sorted_ts)):
        gap = (sorted_ts[i] - sorted_ts[i - 1]).total_seconds() / 86400.0
        if gap > 0:
            intervals.append(gap)
    freq_score = _compute_frequency_score(intervals)

    return {
        "days_to_pay_slope": round(slope, 4),
        "avg_days_to_pay": round(avg_dtp, 2),
        "payment_frequency_score": round(freq_score, 4),
        "invoices_paid_count": float(paid_count),
        "invoices_overdue_count": float(overdue_count),
        "silence_after_outreach_days": -1.0,  # requires event data, set by caller
    }


async def load_customer_trajectory(
    pool,
    tenant_id: str,
    party_id: str,
    *,
    before: str | None = None,
    reference_time: datetime | None = None,
) -> dict[str, float]:
    """Load and compute trajectory features for a customer."""
    if pool is None:
        return _default_trajectory()

    invoices = await get_customer_payment_history(
        pool, tenant_id, party_id, before=before,
    )
    if not invoices:
        return _default_trajectory()

    return compute_trajectory_from_history(invoices, reference_time)


def _default_trajectory() -> dict[str, float]:
    return {
        "days_to_pay_slope": 0.0,
        "avg_days_to_pay": 0.0,
        "payment_frequency_score": 0.0,
        "invoices_paid_count": 0.0,
        "invoices_overdue_count": 0.0,
        "silence_after_outreach_days": -1.0,
    }
