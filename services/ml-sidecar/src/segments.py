"""Tenant segment assignment for hierarchical model learning.

Groups tenants by characteristics so new tenants can warm-start
from a segment prior instead of starting from zero.

Segment assignment is rule-based for now (no clustering):
  - smb_saas: low median invoice, high frequency, short terms
  - enterprise_services: high median invoice, low frequency, long terms
  - construction: very high median, milestone-based, retainage patterns
  - general: everything else

The model hierarchy is:
  tenant model (>50 epochs) → segment model (>20 epochs) → global model → rules
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def assign_segment(tenant_stats: dict[str, float]) -> str:
    """Assign a tenant to a segment based on their invoice characteristics."""
    median_amount = tenant_stats.get("median_amount_cents", 5000)
    avg_dtp = tenant_stats.get("avg_days_to_pay", 30)
    invoice_count = tenant_stats.get("invoice_count", 0)

    if invoice_count < 5:
        return "general"  # Not enough data to segment

    # High-value, long-cycle → enterprise or construction
    if median_amount > 50000:
        if avg_dtp > 60:
            return "construction"
        return "enterprise_services"

    # Low-value, fast-cycle → SaaS/subscription
    if median_amount < 10000 and avg_dtp < 25:
        return "smb_saas"

    # Mid-range
    if median_amount < 30000:
        return "smb_services"

    return "general"


async def upsert_tenant_segment(
    pool,
    tenant_id: str,
    segment_id: str,
    segment_features: dict[str, Any],
) -> None:
    """Store or update a tenant's segment assignment."""
    await pool.execute(
        """
        INSERT INTO tenant_segments (tenant_id, segment_id, segment_features, assigned_at, updated_at)
        VALUES ($1, $2, $3::jsonb, now(), now())
        ON CONFLICT (tenant_id) DO UPDATE SET
          segment_id = EXCLUDED.segment_id,
          segment_features = EXCLUDED.segment_features,
          updated_at = now()
        """,
        tenant_id,
        segment_id,
        __import__("json").dumps(segment_features),
    )


async def get_tenant_segment(pool, tenant_id: str) -> str | None:
    """Get a tenant's current segment assignment."""
    row = await pool.fetchrow(
        "SELECT segment_id FROM tenant_segments WHERE tenant_id = $1",
        tenant_id,
    )
    return str(row["segment_id"]) if row else None


async def get_segment_epoch_rows(
    pool,
    segment_id: str,
    exclude_tenant_id: str | None = None,
    limit: int = 5000,
) -> list[dict]:
    """Get training rows from all tenants in a segment."""
    from .db import _parse_json_value

    rows = await pool.fetch(
        """
        SELECT
          e.id AS epoch_id,
          e.tenant_id,
          e.object_id,
          e.epoch_trigger,
          e.epoch_at,
          e.feature_snapshot,
          e.outcome_label,
          e.outcome_window_end
        FROM decision_epochs e
        JOIN tenant_segments s ON s.tenant_id = e.tenant_id
        WHERE s.segment_id = $1
          AND e.outcome_resolved = TRUE
          AND ($2::text IS NULL OR e.tenant_id != $2)
        ORDER BY e.epoch_at DESC
        LIMIT $3
        """,
        segment_id,
        exclude_tenant_id,
        limit,
    )

    result = []
    for r in rows:
        record = dict(r)
        record["feature_snapshot"] = _parse_json_value(record.get("feature_snapshot"), {})
        record["outcome_label"] = _parse_json_value(record.get("outcome_label"), {})
        result.append(record)
    return result


async def get_global_epoch_rows(
    pool,
    limit: int = 10000,
) -> list[dict]:
    """Get training rows from all tenants (for global model)."""
    from .db import _parse_json_value

    rows = await pool.fetch(
        """
        SELECT
          id AS epoch_id,
          tenant_id,
          object_id,
          epoch_trigger,
          epoch_at,
          feature_snapshot,
          outcome_label,
          outcome_window_end
        FROM decision_epochs
        WHERE outcome_resolved = TRUE
        ORDER BY epoch_at DESC
        LIMIT $1
        """,
        limit,
    )

    result = []
    for r in rows:
        record = dict(r)
        record["feature_snapshot"] = _parse_json_value(record.get("feature_snapshot"), {})
        record["outcome_label"] = _parse_json_value(record.get("outcome_label"), {})
        result.append(record)
    return result
