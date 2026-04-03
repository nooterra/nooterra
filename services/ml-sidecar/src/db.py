from __future__ import annotations

import os
from typing import Optional

import asyncpg

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> Optional[asyncpg.Pool]:
    """Return a connection pool singleton. Returns None if DATABASE_URL is not set."""
    global _pool
    if _pool is not None:
        return _pool

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        return None

    _pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10)
    return _pool


async def close_pool() -> None:
    """Close the connection pool if it exists."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def get_predictions(
    pool: asyncpg.Pool,
    tenant_id: str,
    model_id: str,
    prediction_type: str,
) -> list[dict]:
    """Query world_predictions for a given tenant, model, and prediction type."""
    rows = await pool.fetch(
        """
        SELECT id, tenant_id, object_id, prediction_type, predicted_value,
               confidence, model_id, horizon, reasoning, evidence,
               calibration_score, predicted_at
        FROM world_predictions
        WHERE tenant_id = $1 AND model_id = $2 AND prediction_type = $3
        ORDER BY predicted_at DESC
        """,
        tenant_id,
        model_id,
        prediction_type,
    )
    return [dict(r) for r in rows]


async def get_outcomes(
    pool: asyncpg.Pool,
    tenant_id: str,
    model_id: str,
    prediction_type: str,
) -> list[dict]:
    """Query world_prediction_outcomes joined with world_predictions."""
    rows = await pool.fetch(
        """
        SELECT o.prediction_id, o.tenant_id, o.object_id, o.prediction_type,
               o.outcome_value, o.outcome_at, o.calibration_error,
               p.predicted_value, p.confidence, p.model_id
        FROM world_prediction_outcomes o
        JOIN world_predictions p ON p.id = o.prediction_id
        WHERE o.tenant_id = $1 AND p.model_id = $2 AND o.prediction_type = $3
        ORDER BY o.outcome_at DESC
        """,
        tenant_id,
        model_id,
        prediction_type,
    )
    return [dict(r) for r in rows]


async def get_prediction_outcome_pairs(
    pool: asyncpg.Pool,
    tenant_id: str,
    prediction_type: str,
) -> list[tuple[float, float]]:
    """Return (predicted_value, outcome_value) tuples for calibration."""
    rows = await pool.fetch(
        """
        SELECT p.predicted_value, o.outcome_value
        FROM world_prediction_outcomes o
        JOIN world_predictions p ON p.id = o.prediction_id
        WHERE o.tenant_id = $1 AND o.prediction_type = $2
        ORDER BY o.outcome_at DESC
        """,
        tenant_id,
        prediction_type,
    )
    return [(float(r["predicted_value"]), float(r["outcome_value"])) for r in rows]
