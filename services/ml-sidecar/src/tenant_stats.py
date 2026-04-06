"""Tenant-level statistics for relative feature normalization.

Computes and caches tenant-wide metrics (median invoice amount, average
days-to-pay, percentiles) so that individual invoice features can be
expressed relative to the tenant's norms. This makes a $500 SaaS invoice
and a $50K construction invoice comparable.

Cache TTL is 1 hour — stats shift slowly, no need to recompute per request.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from .db import get_customer_reliability_percentile, get_tenant_invoice_stats

logger = logging.getLogger(__name__)

# In-memory cache: tenant_id -> (stats_dict, timestamp)
_cache: dict[str, tuple[dict[str, float], float]] = {}
CACHE_TTL_SECONDS = 3600  # 1 hour


async def load_tenant_stats(
    pool,
    tenant_id: str,
    *,
    force: bool = False,
) -> dict[str, float]:
    """Load tenant-level statistics, using cache when fresh."""
    now = time.time()

    if not force and tenant_id in _cache:
        stats, cached_at = _cache[tenant_id]
        if now - cached_at < CACHE_TTL_SECONDS:
            return stats

    if pool is None:
        return _default_stats()

    stats = await get_tenant_invoice_stats(pool, tenant_id)
    _cache[tenant_id] = (stats, now)
    logger.info(
        "Loaded tenant stats for %s: %d invoices, median=$%.0f, avg_dtp=%.1fd",
        tenant_id,
        stats.get("invoice_count", 0),
        stats.get("median_amount_cents", 0) / 100,
        stats.get("avg_days_to_pay", 0),
    )
    return stats


async def load_tenant_stats_with_customer(
    pool,
    tenant_id: str,
    party_id: str | None,
    *,
    force: bool = False,
) -> dict[str, float]:
    """Load tenant stats enriched with the specific customer's percentile."""
    stats = await load_tenant_stats(pool, tenant_id, force=force)

    if party_id and pool:
        percentile = await get_customer_reliability_percentile(pool, tenant_id, party_id)
        stats = {**stats, "customer_reliability_percentile": percentile}

    return stats


def invalidate_cache(tenant_id: str | None = None) -> None:
    """Clear cached stats. Called after significant data changes."""
    if tenant_id:
        _cache.pop(tenant_id, None)
    else:
        _cache.clear()


def _default_stats() -> dict[str, float]:
    return {
        "invoice_count": 0,
        "amount_p25": 1000,
        "amount_p50": 5000,
        "amount_p75": 20000,
        "amount_p95": 100000,
        "avg_amount_cents": 5000,
        "median_amount_cents": 5000,
        "avg_days_to_pay": 30.0,
        "customer_reliability_percentile": 0.5,
    }
