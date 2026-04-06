"""Point-in-time feature extraction for invoice payment prediction.

This module is the SINGLE source of truth for feature computation.
Both the epoch builder (offline/training) and the /predict endpoint
(online/serving) call build_full_feature_vector so features never diverge.

Feature families:
  1. Absolute — raw invoice/object state
  2. Relative — normalized against tenant-level statistics
  3. Trajectory — customer payment history trends
  4. Event counts — actions taken, communications sent
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


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


def _safe_ratio(numerator: float, denominator: float, default: float = 0.0) -> float:
    if denominator <= 0:
        return default
    return min(1.0, max(0.0, numerator / denominator))


def build_absolute_features(
    state: dict[str, Any],
    estimated: dict[str, Any],
    reference_time: datetime,
) -> dict[str, float]:
    """Core invoice features from observed and estimated state."""
    amount_cents = _to_float(state.get("amountCents"))
    amount_remaining_cents = _to_float(state.get("amountRemainingCents"), amount_cents)
    amount_paid_cents = _to_float(state.get("amountPaidCents"))
    amount_denominator = amount_cents if amount_cents > 0 else 1.0

    due_at = _parse_datetime(state.get("dueAt"))
    days_overdue = 0.0
    days_since_issued = 0.0
    if due_at is not None:
        days_overdue = max(0.0, (reference_time - due_at).total_seconds() / 86400.0)

    issued_at = _parse_datetime(state.get("issuedAt"))
    if issued_at is not None:
        days_since_issued = max(0.0, (reference_time - issued_at).total_seconds() / 86400.0)

    payment_terms_days = _to_float(state.get("paymentTermsDays"))
    if payment_terms_days == 0.0 and due_at and issued_at and due_at > issued_at:
        payment_terms_days = (due_at - issued_at).total_seconds() / 86400.0

    status = str(state.get("status") or "").lower()
    line_items = state.get("lineItems")
    line_item_count = float(len(line_items)) if isinstance(line_items, list) else 0.0

    return {
        # Amount features
        "amountCents": amount_cents,
        "amountRemainingCents": amount_remaining_cents,
        "amountPaidCents": amount_paid_cents,
        "amountRemainingRatio": _safe_ratio(amount_remaining_cents, amount_denominator),
        "amountPaidRatio": _safe_ratio(amount_paid_cents, amount_denominator),
        # Time features
        "daysOverdue": days_overdue,
        "daysSinceIssued": days_since_issued,
        "paymentTermsDays": payment_terms_days,
        # Status flags
        "isOverdue": 1.0 if days_overdue > 0 or status == "overdue" else 0.0,
        "isSent": 1.0 if status == "sent" else 0.0,
        "isPartial": 1.0 if amount_paid_cents > 0 and amount_remaining_cents > 0 else 0.0,
        "isPaid": 1.0 if status == "paid" else 0.0,
        "isDisputed": 1.0 if status == "disputed" else 0.0,
        # Invoice complexity
        "lineItemCount": line_item_count,
        # Estimated risk signals
        "disputeRisk": _to_float(estimated.get("disputeRisk")),
        "urgency": _to_float(estimated.get("urgency")),
        "paymentProbability30d": _to_float(estimated.get("paymentProbability30d")),
        "paymentReliability": _to_float(estimated.get("paymentReliability")),
        "churnRisk": _to_float(estimated.get("churnRisk")),
    }


def build_relative_features(
    absolute: dict[str, float],
    tenant_stats: dict[str, float] | None,
) -> dict[str, float]:
    """Features normalized against tenant-level statistics.

    These make a $500 SaaS invoice and a $50K construction invoice
    comparable without pretending they're identical.
    """
    if not tenant_stats:
        return {
            "amountVsTenantMedian": 0.0,
            "overdueVsTerms": 0.0,
            "customerReliabilityPercentile": 0.5,
            "amountBucket": 1.0,
        }

    median_amount = _to_float(tenant_stats.get("median_amount_cents"), 1.0)
    amount_vs_median = absolute["amountCents"] / median_amount if median_amount > 0 else 1.0

    terms = absolute["paymentTermsDays"]
    overdue_vs_terms = absolute["daysOverdue"] / terms if terms > 0 else 0.0

    percentile = _to_float(tenant_stats.get("customer_reliability_percentile"), 0.5)

    # Amount bucket: 0=tiny, 1=small, 2=medium, 3=large, 4=enterprise
    p25 = _to_float(tenant_stats.get("amount_p25"), 1000)
    p50 = _to_float(tenant_stats.get("amount_p50"), 5000)
    p75 = _to_float(tenant_stats.get("amount_p75"), 20000)
    p95 = _to_float(tenant_stats.get("amount_p95"), 100000)
    amt = absolute["amountCents"]
    if amt <= p25:
        bucket = 0.0
    elif amt <= p50:
        bucket = 1.0
    elif amt <= p75:
        bucket = 2.0
    elif amt <= p95:
        bucket = 3.0
    else:
        bucket = 4.0

    return {
        "amountVsTenantMedian": float(min(amount_vs_median, 10.0)),
        "overdueVsTerms": float(min(overdue_vs_terms, 5.0)),
        "customerReliabilityPercentile": float(percentile),
        "amountBucket": bucket,
    }


def build_event_count_features(
    event_counts: dict[str, int] | None,
) -> dict[str, float]:
    """Features from action/event history for this invoice."""
    if not event_counts:
        return {
            "reminderCount": 0.0,
            "partialPaymentCount": 0.0,
            "daysSinceLastContact": -1.0,
            "escalationCount": 0.0,
            "disputeCount": 0.0,
        }

    return {
        "reminderCount": float(event_counts.get("reminder_count", 0)),
        "partialPaymentCount": float(event_counts.get("partial_payment_count", 0)),
        "daysSinceLastContact": float(event_counts.get("days_since_last_contact", -1)),
        "escalationCount": float(event_counts.get("escalation_count", 0)),
        "disputeCount": float(event_counts.get("dispute_count", 0)),
    }


def build_trajectory_features(
    trajectory: dict[str, float] | None,
) -> dict[str, float]:
    """Features from customer payment history trends.

    Computed by trajectory.py from the customer's historical payment records.
    """
    if not trajectory:
        return {
            "daysToPaySlope": 0.0,
            "avgDaysToPay": 0.0,
            "paymentFrequencyScore": 0.0,
            "invoicesPaidCount": 0.0,
            "invoicesOverdueCount": 0.0,
            "silenceAfterOutreachDays": -1.0,
        }

    return {
        "daysToPaySlope": _to_float(trajectory.get("days_to_pay_slope")),
        "avgDaysToPay": _to_float(trajectory.get("avg_days_to_pay")),
        "paymentFrequencyScore": _to_float(trajectory.get("payment_frequency_score")),
        "invoicesPaidCount": _to_float(trajectory.get("invoices_paid_count")),
        "invoicesOverdueCount": _to_float(trajectory.get("invoices_overdue_count")),
        "silenceAfterOutreachDays": _to_float(trajectory.get("silence_after_outreach_days"), -1.0),
    }


def build_full_feature_vector(
    state: dict[str, Any] | None,
    estimated: dict[str, Any] | None,
    *,
    reference_time: datetime | None = None,
    tenant_stats: dict[str, float] | None = None,
    event_counts: dict[str, int] | None = None,
    trajectory: dict[str, float] | None = None,
) -> dict[str, float]:
    """Build the complete feature vector for an invoice.

    This is the SINGLE function called by both:
      - Epoch builder (training): passes historical state from world_object_versions
      - /predict endpoint (serving): passes current state from world_objects

    Same code path guarantees training/serving parity.
    """
    state = state or {}
    estimated = estimated or {}
    now = reference_time if reference_time is not None else datetime.now(timezone.utc)

    absolute = build_absolute_features(state, estimated, now)
    relative = build_relative_features(absolute, tenant_stats)
    events = build_event_count_features(event_counts)
    traj = build_trajectory_features(trajectory)

    return {**absolute, **relative, **events, **traj}


def compute_feature_hash(features: dict[str, float]) -> str:
    """Deterministic SHA256 hash of the feature vector.

    Used for:
      - Epoch deduplication (same features = same epoch)
      - Prediction lineage (link prediction to exact feature snapshot)

    Rounds all float values to 6 decimal places before hashing
    to avoid IEEE 754 representation differences across environments.
    """
    rounded = {k: round(float(v), 6) for k, v in sorted(features.items())}
    canonical = json.dumps(rounded, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Backward compatibility: the old 16-feature map used by the existing
# training pipeline. New code should use build_full_feature_vector instead.
# ---------------------------------------------------------------------------

def build_invoice_feature_map(
    state: dict[str, Any] | None,
    estimated: dict[str, Any] | None,
    *,
    reference_time: datetime | None = None,
) -> dict[str, float]:
    """Legacy 16-feature map. Delegates to build_absolute_features and
    returns only the original feature names for backward compatibility."""
    state = state or {}
    estimated = estimated or {}
    now = reference_time if reference_time is not None else datetime.now(timezone.utc)
    full = build_absolute_features(state, estimated, now)

    # Return only the original 16 features in the original key order
    return {
        "amountCents": full["amountCents"],
        "amountRemainingCents": full["amountRemainingCents"],
        "amountPaidCents": full["amountPaidCents"],
        "amountRemainingRatio": full["amountRemainingRatio"],
        "amountPaidRatio": full["amountPaidRatio"],
        "daysOverdue": full["daysOverdue"],
        "isOverdue": full["isOverdue"],
        "isSent": full["isSent"],
        "isPartial": full["isPartial"],
        "isPaid": full["isPaid"],
        "isDisputed": full["isDisputed"],
        "disputeRisk": full["disputeRisk"],
        "urgency": full["urgency"],
        "paymentProbability30d": full["paymentProbability30d"],
        "paymentReliability": full["paymentReliability"],
        "churnRisk": full["churnRisk"],
    }
