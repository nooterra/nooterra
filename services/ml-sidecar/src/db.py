from __future__ import annotations

import os
import json
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


async def get_prediction_training_rows(
    pool: asyncpg.Pool,
    prediction_type: str,
    tenant_id: str | None = None,
    limit: int = 2000,
) -> list[dict]:
    """Return supervised training rows joined to the current world object snapshot."""
    rows = await pool.fetch(
        """
        SELECT
          p.tenant_id,
          p.object_id,
          p.prediction_type,
          p.predicted_value,
          p.predicted_at,
          o.outcome_value,
          o.outcome_at,
          obj.state,
          obj.estimated
        FROM world_prediction_outcomes o
        JOIN world_predictions p
          ON p.id = o.prediction_id
         AND p.tenant_id = o.tenant_id
        JOIN world_objects obj
          ON obj.id = p.object_id
         AND obj.tenant_id = p.tenant_id
        WHERE o.prediction_type = $1
          AND ($2::text IS NULL OR o.tenant_id = $2)
        ORDER BY o.outcome_at DESC, p.predicted_at DESC
        LIMIT $3
        """,
        prediction_type,
        tenant_id,
        limit,
    )
    return [dict(r) for r in rows]


async def get_intervention_training_rows(
    pool: asyncpg.Pool,
    tenant_id: str,
    action_class: str,
    object_type: str,
    field: str,
    limit: int = 1000,
) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT
          e.tenant_id,
          e.action_id,
          e.object_id,
          e.field,
          e.current_value,
          e.predicted_value,
          e.delta_expected,
          e.delta_observed,
          e.confidence,
          e.matched,
          e.observed_at,
          o.objective_score,
          o.summary,
          obj.state,
          obj.estimated
        FROM world_action_effect_observations e
        JOIN world_action_outcomes o
          ON o.action_id = e.action_id
         AND o.tenant_id = e.tenant_id
        JOIN world_objects obj
          ON obj.id = e.object_id
         AND obj.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1
          AND o.action_class = $2
          AND o.target_object_type = $3
          AND e.field = $4
          AND e.observation_status = 'observed'
          AND e.delta_observed IS NOT NULL
        ORDER BY e.observed_at DESC NULLS LAST, e.created_at DESC
        LIMIT $5
        """,
        tenant_id,
        action_class,
        object_type,
        field,
        limit,
    )
    return [dict(r) for r in rows]


async def get_intervention_comparison_rows(
    pool: asyncpg.Pool,
    tenant_id: str,
    object_type: str,
    field: str,
    limit: int = 32,
) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT
          o.action_class,
          COUNT(*)::int AS sample_count,
          AVG(e.delta_observed)::float8 AS avg_delta_observed,
          AVG(e.confidence)::float8 AS avg_confidence,
          AVG(CASE WHEN e.matched THEN 1 ELSE 0 END)::float8 AS match_rate,
          AVG(COALESCE(o.objective_score, 0))::float8 AS avg_objective_score
        FROM world_action_effect_observations e
        JOIN world_action_outcomes o
          ON o.action_id = e.action_id
         AND o.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1
          AND o.target_object_type = $2
          AND e.field = $3
          AND e.observation_status = 'observed'
          AND e.delta_observed IS NOT NULL
        GROUP BY o.action_class
        ORDER BY AVG(COALESCE(o.objective_score, 0)) DESC, COUNT(*) DESC, o.action_class ASC
        LIMIT $4
        """,
        tenant_id,
        object_type,
        field,
        limit,
    )
    return [dict(r) for r in rows]


async def get_object_state_at(
    pool: asyncpg.Pool,
    tenant_id: str,
    object_id: str,
    as_of: str,
) -> dict | None:
    """Bi-temporal lookup: get object state as it was at a specific time.

    Uses world_object_versions to find the version that was valid at as_of.
    Falls back to current world_objects if no version history exists.
    """
    row = await pool.fetchrow(
        """
        SELECT state, estimated, version, valid_from, valid_to
        FROM world_object_versions
        WHERE object_id = $1
          AND valid_from <= $2
          AND (valid_to IS NULL OR valid_to > $2)
        ORDER BY version DESC
        LIMIT 1
        """,
        object_id,
        as_of,
    )
    if row is not None:
        return {
            "state": _parse_json_value(row["state"], {}),
            "estimated": _parse_json_value(row["estimated"], {}),
            "version": row["version"],
            "valid_from": row["valid_from"],
        }

    # Fallback: if no version history, use current object state (for objects
    # created before versioning was enabled)
    row = await pool.fetchrow(
        """
        SELECT state, estimated, version
        FROM world_objects
        WHERE id = $1 AND tenant_id = $2
        """,
        object_id,
        tenant_id,
    )
    if row is None:
        return None
    return {
        "state": _parse_json_value(row["state"], {}),
        "estimated": _parse_json_value(row["estimated"], {}),
        "version": row["version"],
        "valid_from": None,
    }


async def get_epoch_training_rows(
    pool: asyncpg.Pool,
    tenant_id: str | None = None,
    prediction_type: str | None = None,
    limit: int = 5000,
) -> list[dict]:
    """Return resolved decision epochs for model training.

    Unlike get_prediction_training_rows, these rows carry point-in-time
    correct feature snapshots — no data leakage from future state.
    """
    rows = await pool.fetch(
        """
        SELECT
          id AS epoch_id,
          tenant_id,
          object_id,
          object_type,
          epoch_trigger,
          epoch_at,
          feature_snapshot,
          feature_hash,
          eligible_actions,
          chosen_action,
          outcome_label,
          outcome_window_end,
          created_at
        FROM decision_epochs
        WHERE outcome_resolved = TRUE
          AND ($1::text IS NULL OR tenant_id = $1)
          -- Exclude censored observations: they are NOT confirmed negatives.
          -- Censored epochs should be used by the survival model, not the classifier.
          AND (outcome_label->>'censored')::boolean IS NOT TRUE
        ORDER BY epoch_at DESC
        LIMIT $2
        """,
        tenant_id,
        limit,
    )
    result = []
    for r in rows:
        record = dict(r)
        record["feature_snapshot"] = _parse_json_value(record.get("feature_snapshot"), {})
        record["outcome_label"] = _parse_json_value(record.get("outcome_label"), {})
        result.append(record)
    return result


async def get_unresolved_epochs(
    pool: asyncpg.Pool,
    tenant_id: str | None = None,
    limit: int = 500,
) -> list[dict]:
    """Return epochs whose outcome window has passed but are not yet resolved."""
    rows = await pool.fetch(
        """
        SELECT
          id AS epoch_id,
          tenant_id,
          object_id,
          object_type,
          epoch_trigger,
          epoch_at,
          outcome_window_end,
          created_at
        FROM decision_epochs
        WHERE outcome_resolved = FALSE
          AND outcome_window_end <= now()
          AND ($1::text IS NULL OR tenant_id = $1)
        ORDER BY outcome_window_end ASC
        LIMIT $2
        """,
        tenant_id,
        limit,
    )
    return [dict(r) for r in rows]


async def get_event_counts_for_object(
    pool: asyncpg.Pool,
    tenant_id: str,
    object_id: str,
    as_of: str | None = None,
) -> dict[str, int]:
    """Count actions/events for an object up to a point in time."""
    time_filter = "AND we.timestamp <= $3" if as_of else ""
    params = [tenant_id, object_id]
    if as_of:
        params.append(as_of)

    rows = await pool.fetch(
        f"""
        SELECT
          we.type,
          COUNT(*)::int AS cnt
        FROM world_events we
        WHERE we.tenant_id = $1
          AND (
            we.payload->>'objectId' = $2
            OR we.payload->>'targetObjectId' = $2
          )
          {time_filter}
        GROUP BY we.type
        """,
        *params,
    )

    counts: dict[str, int] = {}
    for r in rows:
        event_type = str(r["type"] or "")
        cnt = int(r["cnt"])
        if "remind" in event_type or "communicate.email" in event_type:
            counts["reminder_count"] = counts.get("reminder_count", 0) + cnt
        if "partial" in event_type or "payment.received" in event_type:
            counts["partial_payment_count"] = counts.get("partial_payment_count", 0) + cnt
        if "escalat" in event_type or "task.create" in event_type:
            counts["escalation_count"] = counts.get("escalation_count", 0) + cnt
        if "dispute" in event_type:
            counts["dispute_count"] = counts.get("dispute_count", 0) + cnt

    # Days since last contact
    last_contact = await pool.fetchval(
        f"""
        SELECT MAX(we.timestamp)
        FROM world_events we
        WHERE we.tenant_id = $1
          AND (
            we.payload->>'objectId' = $2
            OR we.payload->>'targetObjectId' = $2
          )
          AND we.type LIKE 'action.%%'
          {time_filter}
        """,
        *params,
    )
    if last_contact is not None:
        from datetime import datetime, timezone
        ref = datetime.fromisoformat(as_of.replace("Z", "+00:00")) if as_of else datetime.now(timezone.utc)
        if isinstance(last_contact, datetime):
            delta = (ref - last_contact).total_seconds() / 86400.0
            counts["days_since_last_contact"] = max(0, int(delta))
        else:
            counts["days_since_last_contact"] = -1
    else:
        counts["days_since_last_contact"] = -1

    return counts


async def upsert_decision_epoch(
    pool: asyncpg.Pool,
    epoch: dict,
) -> None:
    """Insert or update a decision epoch."""
    await pool.execute(
        """
        INSERT INTO decision_epochs (
          id, tenant_id, object_id, object_type, epoch_trigger, epoch_at,
          feature_snapshot, feature_hash, eligible_actions, chosen_action,
          chosen_action_id, propensity, policy_version,
          outcome_window_end, outcome_label, outcome_resolved, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7::jsonb, $8, $9, $10,
          $11, $12::jsonb, $13,
          $14, $15::jsonb, $16, now()
        )
        ON CONFLICT (tenant_id, object_id, epoch_trigger)
        DO UPDATE SET
          -- NEVER overwrite frozen features — they capture point-in-time state
          feature_snapshot = COALESCE(decision_epochs.feature_snapshot, EXCLUDED.feature_snapshot),
          feature_hash = COALESCE(decision_epochs.feature_hash, EXCLUDED.feature_hash),
          eligible_actions = EXCLUDED.eligible_actions,
          chosen_action = COALESCE(EXCLUDED.chosen_action, decision_epochs.chosen_action),
          chosen_action_id = COALESCE(EXCLUDED.chosen_action_id, decision_epochs.chosen_action_id),
          propensity = COALESCE(EXCLUDED.propensity, decision_epochs.propensity),
          outcome_label = COALESCE(EXCLUDED.outcome_label, decision_epochs.outcome_label),
          outcome_resolved = EXCLUDED.outcome_resolved
        """,
        epoch["id"],
        epoch["tenant_id"],
        epoch["object_id"],
        epoch.get("object_type", "invoice"),
        epoch["epoch_trigger"],
        epoch["epoch_at"],
        json.dumps(epoch["feature_snapshot"]),
        epoch["feature_hash"],
        epoch.get("eligible_actions", []),
        epoch.get("chosen_action"),
        epoch.get("chosen_action_id"),
        json.dumps(epoch["propensity"]) if epoch.get("propensity") else None,
        epoch.get("policy_version"),
        epoch.get("outcome_window_end"),
        json.dumps(epoch["outcome_label"]) if epoch.get("outcome_label") else None,
        epoch.get("outcome_resolved", False),
    )


async def resolve_epoch_outcome(
    pool: asyncpg.Pool,
    epoch_id: str,
    outcome_label: dict,
) -> None:
    """Mark an epoch as resolved with its outcome labels."""
    await pool.execute(
        """
        UPDATE decision_epochs
        SET outcome_label = $2::jsonb,
            outcome_resolved = TRUE
        WHERE id = $1
        """,
        epoch_id,
        json.dumps(outcome_label),
    )


async def get_tenant_invoice_stats(
    pool: asyncpg.Pool,
    tenant_id: str,
) -> dict:
    """Compute tenant-level invoice statistics for relative features.

    Returns percentiles, medians, and averages across the tenant's invoices.
    """
    row = await pool.fetchrow(
        """
        SELECT
          COUNT(*)::int AS invoice_count,
          COALESCE(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY (state->>'amountCents')::numeric), 0) AS amount_p25,
          COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY (state->>'amountCents')::numeric), 0) AS amount_p50,
          COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (state->>'amountCents')::numeric), 0) AS amount_p75,
          COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (state->>'amountCents')::numeric), 0) AS amount_p95,
          COALESCE(AVG((state->>'amountCents')::numeric), 0) AS avg_amount_cents
        FROM world_objects
        WHERE tenant_id = $1
          AND type = 'invoice'
          AND NOT tombstone
          AND valid_to IS NULL
          AND state->>'amountCents' IS NOT NULL
        """,
        tenant_id,
    )
    if row is None:
        return {
            "invoice_count": 0,
            "amount_p25": 1000,
            "amount_p50": 5000,
            "amount_p75": 20000,
            "amount_p95": 100000,
            "avg_amount_cents": 5000,
            "median_amount_cents": 5000,
            "avg_days_to_pay": 30.0,
        }

    # Compute average days-to-pay from paid invoices
    dtp_row = await pool.fetchrow(
        """
        SELECT
          AVG(
            EXTRACT(EPOCH FROM (
              COALESCE(
                (state->>'paidAt')::timestamptz,
                updated_at
              ) - (state->>'issuedAt')::timestamptz
            )) / 86400.0
          ) AS avg_days_to_pay,
          COUNT(*)::int AS paid_count
        FROM world_objects
        WHERE tenant_id = $1
          AND type = 'invoice'
          AND NOT tombstone
          AND state->>'status' = 'paid'
          AND state->>'issuedAt' IS NOT NULL
        """,
        tenant_id,
    )

    return {
        "invoice_count": int(row["invoice_count"]),
        "amount_p25": float(row["amount_p25"]),
        "amount_p50": float(row["amount_p50"]),
        "amount_p75": float(row["amount_p75"]),
        "amount_p95": float(row["amount_p95"]),
        "avg_amount_cents": float(row["avg_amount_cents"]),
        "median_amount_cents": float(row["amount_p50"]),
        "avg_days_to_pay": float(dtp_row["avg_days_to_pay"] or 30.0) if dtp_row else 30.0,
    }


async def get_customer_payment_history(
    pool: asyncpg.Pool,
    tenant_id: str,
    party_id: str,
    before: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """Get payment history for a customer (party) for trajectory analysis.

    Returns invoices linked to this party via 'pays' relationships,
    ordered by issue date descending.
    """
    time_filter = "AND inv.created_at <= $3" if before else ""
    params: list = [tenant_id, party_id]
    if before:
        params.append(before)
    params.append(limit)
    limit_idx = len(params)

    rows = await pool.fetch(
        f"""
        SELECT
          inv.id AS invoice_id,
          inv.state->>'status' AS status,
          (inv.state->>'amountCents')::numeric AS amount_cents,
          (inv.state->>'amountPaidCents')::numeric AS amount_paid_cents,
          inv.state->>'issuedAt' AS issued_at,
          inv.state->>'dueAt' AS due_at,
          inv.state->>'paidAt' AS paid_at,
          inv.updated_at
        FROM world_relationships rel
        JOIN world_objects inv
          ON inv.id = rel.to_id
          AND inv.tenant_id = rel.tenant_id
        WHERE rel.tenant_id = $1
          AND rel.from_id = $2
          AND rel.type = 'pays'
          AND rel.valid_to IS NULL
          AND inv.type = 'invoice'
          AND NOT inv.tombstone
          AND inv.valid_to IS NULL
          {time_filter}
        ORDER BY inv.created_at DESC
        LIMIT ${limit_idx}
        """,
        *params,
    )
    return [dict(r) for r in rows]


async def get_customer_reliability_percentile(
    pool: asyncpg.Pool,
    tenant_id: str,
    party_id: str,
) -> float:
    """Compute where this customer ranks among the tenant's customers.

    Returns 0.0-1.0 percentile based on payment reliability from estimated state.
    """
    row = await pool.fetchrow(
        """
        WITH customer_scores AS (
          SELECT
            p.id,
            COALESCE((p.estimated->>'paymentReliability')::float8, 0.5) AS reliability
          FROM world_objects p
          WHERE p.tenant_id = $1
            AND p.type = 'party'
            AND NOT p.tombstone
            AND p.valid_to IS NULL
        )
        SELECT
          COALESCE(
            PERCENT_RANK() OVER (ORDER BY reliability) ,
            0.5
          ) AS percentile
        FROM customer_scores
        WHERE id = $2
        """,
        tenant_id,
        party_id,
    )
    if row is None:
        return 0.5
    return float(row["percentile"]) if row["percentile"] is not None else 0.5


async def get_party_id_for_invoice(
    pool: asyncpg.Pool,
    tenant_id: str,
    invoice_id: str,
) -> str | None:
    """Find the party (customer) linked to an invoice via 'pays' relationship."""
    row = await pool.fetchrow(
        """
        SELECT from_id
        FROM world_relationships
        WHERE tenant_id = $1
          AND to_id = $2
          AND type = 'pays'
          AND valid_to IS NULL
        LIMIT 1
        """,
        tenant_id,
        invoice_id,
    )
    return str(row["from_id"]) if row else None


def _parse_json_value(raw, default):
    if raw is None:
        return default
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return default
    return raw


async def insert_model_release(
    pool: asyncpg.Pool,
    release: dict,
) -> None:
    await pool.execute(
        """
        INSERT INTO world_model_releases (
          release_id,
          model_id,
          prediction_type,
          scope,
          tenant_id,
          status,
          trained_at,
          sample_count,
          positive_rate,
          brier_score,
          roc_auc,
          calibration_method,
          feature_manifest,
          training_window,
          baseline_model_id,
          baseline_comparison,
          replay_report,
          metadata,
          created_at,
          updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16::jsonb,$17::jsonb,$18::jsonb,now(),now()
        )
        ON CONFLICT (release_id) DO UPDATE SET
          status = EXCLUDED.status,
          trained_at = EXCLUDED.trained_at,
          sample_count = EXCLUDED.sample_count,
          positive_rate = EXCLUDED.positive_rate,
          brier_score = EXCLUDED.brier_score,
          roc_auc = EXCLUDED.roc_auc,
          calibration_method = EXCLUDED.calibration_method,
          feature_manifest = EXCLUDED.feature_manifest,
          training_window = EXCLUDED.training_window,
          baseline_model_id = EXCLUDED.baseline_model_id,
          baseline_comparison = EXCLUDED.baseline_comparison,
          replay_report = EXCLUDED.replay_report,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        """,
        release["release_id"],
        release["model_id"],
        release["prediction_type"],
        release["scope"],
        release.get("tenant_id"),
        release["status"],
        release["trained_at"],
        release["sample_count"],
        release["positive_rate"],
        release.get("brier_score"),
        release.get("roc_auc"),
        release["calibration_method"],
        json.dumps(release.get("feature_manifest") or []),
        json.dumps(release.get("training_window") or {}),
        release.get("baseline_model_id", "rule_inference"),
        json.dumps(release.get("baseline_comparison") or {}),
        json.dumps(release.get("replay_report") or {}),
        json.dumps(release.get("metadata") or {}),
    )


async def list_model_releases(
    pool: asyncpg.Pool,
    tenant_id: str | None = None,
    prediction_type: str | None = None,
) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT *
        FROM world_model_releases
        WHERE ($1::text IS NULL OR tenant_id = $1 OR tenant_id IS NULL)
          AND ($2::text IS NULL OR prediction_type = $2)
        ORDER BY trained_at DESC, release_id DESC
        """,
        tenant_id,
        prediction_type,
    )
    parsed = []
    for row in rows:
        record = dict(row)
        record["feature_manifest"] = _parse_json_value(record.get("feature_manifest"), [])
        record["training_window"] = _parse_json_value(record.get("training_window"), {})
        record["baseline_comparison"] = _parse_json_value(record.get("baseline_comparison"), {})
        record["replay_report"] = _parse_json_value(record.get("replay_report"), {})
        record["metadata"] = _parse_json_value(record.get("metadata"), {})
        parsed.append(record)
    return parsed


async def get_latest_model_release(
    pool: asyncpg.Pool,
    prediction_type: str,
    scope: str,
    tenant_id: str | None = None,
    status: str | None = None,
) -> dict | None:
    row = await pool.fetchrow(
        """
        SELECT *
        FROM world_model_releases
        WHERE prediction_type = $1
          AND scope = $2
          AND (($3::text IS NULL AND tenant_id IS NULL) OR tenant_id = $3)
          AND ($4::text IS NULL OR status = $4)
        ORDER BY trained_at DESC, release_id DESC
        LIMIT 1
        """,
        prediction_type,
        scope,
        tenant_id,
        status,
    )
    if row is None:
        return None
    record = dict(row)
    record["feature_manifest"] = _parse_json_value(record.get("feature_manifest"), [])
    record["training_window"] = _parse_json_value(record.get("training_window"), {})
    record["baseline_comparison"] = _parse_json_value(record.get("baseline_comparison"), {})
    record["replay_report"] = _parse_json_value(record.get("replay_report"), {})
    record["metadata"] = _parse_json_value(record.get("metadata"), {})
    return record
