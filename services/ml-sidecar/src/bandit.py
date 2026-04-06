"""Contextual bandit foundation — inverse propensity weighting and exploration.

Uses the action_decision_log to compute unbiased treatment effect estimates
via inverse propensity scoring (IPS). This is the foundation for learning
which actions actually work, not just predicting outcomes.

The pipeline is:
  1. Load decision logs with propensities
  2. Join with outcomes (paid/unpaid after observation window)
  3. Compute IPS-weighted reward estimates per action class
  4. Estimate conditional average treatment effects (CATE)

This module does NOT make decisions — it provides the data for upgrading
the uplift model from T-learner to a propensity-aware causal model.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


async def load_decision_outcomes(
    pool,
    tenant_id: str,
    min_age_days: int = 7,
    limit: int = 5000,
) -> list[dict]:
    """Load decision logs joined with resolved outcomes.

    Only includes decisions old enough for outcomes to be observed.
    """
    rows = await pool.fetch(
        """
        SELECT
          dl.id AS decision_id,
          dl.object_id,
          dl.chosen_action,
          dl.chosen_variant_id,
          dl.chosen_value,
          dl.chosen_propensity,
          dl.candidate_count,
          dl.exploration,
          dl.feature_hash,
          dl.created_at AS decision_at,
          obj.state,
          obj.estimated
        FROM action_decision_log dl
        LEFT JOIN world_objects obj
          ON obj.id = dl.object_id AND obj.tenant_id = dl.tenant_id
        WHERE dl.tenant_id = $1
          AND dl.created_at <= now() - ($2 || ' days')::interval
          AND dl.chosen_propensity IS NOT NULL
          AND dl.chosen_propensity > 0
        ORDER BY dl.created_at DESC
        LIMIT $3
        """,
        tenant_id,
        str(min_age_days),
        limit,
    )
    return [dict(r) for r in rows]


def compute_ips_estimates(
    decision_outcomes: list[dict],
) -> dict[str, Any]:
    """Compute inverse-propensity-weighted reward estimates per action class.

    For each action class, estimates:
      - avg_reward: IPS-weighted average reward
      - raw_avg_reward: unweighted average (biased by selection)
      - effective_sample_size: how much exploration data we have
      - confidence: whether we trust this estimate
    """
    by_action: dict[str, list[tuple[float, float, float]]] = {}  # action -> [(reward, propensity, weight)]

    for row in decision_outcomes:
        action = str(row.get("chosen_action", ""))
        propensity = _to_float(row.get("chosen_propensity"), 0)
        if propensity <= 0.01:
            continue  # Skip near-zero propensities (unstable IPS)

        state = row.get("state") if isinstance(row.get("state"), dict) else {}
        status = str(state.get("status", "")).lower()
        amount_cents = _to_float(state.get("amountCents"))
        amount_paid = _to_float(state.get("amountPaidCents"))

        # Reward = normalized cash recovered (0-1)
        if status == "paid":
            reward = 1.0
        elif amount_paid > 0 and amount_cents > 0:
            reward = min(1.0, amount_paid / amount_cents)
        elif status in ("written_off", "uncollectible"):
            reward = 0.0
        else:
            continue  # Skip unresolved

        weight = 1.0 / propensity  # IPS weight
        by_action.setdefault(action, []).append((reward, propensity, weight))

    results = {}
    for action, data in by_action.items():
        rewards = np.array([d[0] for d in data])
        weights = np.array([d[2] for d in data])

        # Clip weights to prevent extreme values
        weight_cap = np.percentile(weights, 95) if len(weights) > 10 else weights.max()
        clipped_weights = np.minimum(weights, weight_cap)

        # IPS estimate
        ips_reward = float(np.sum(rewards * clipped_weights) / np.sum(clipped_weights)) if np.sum(clipped_weights) > 0 else 0.0
        raw_reward = float(rewards.mean()) if len(rewards) > 0 else 0.0

        # Effective sample size (Kish's formula)
        ess = float(np.sum(clipped_weights) ** 2 / np.sum(clipped_weights ** 2)) if np.sum(clipped_weights ** 2) > 0 else 0.0

        results[action] = {
            "action_class": action,
            "ips_avg_reward": round(ips_reward, 4),
            "raw_avg_reward": round(raw_reward, 4),
            "sample_count": len(data),
            "effective_sample_size": round(ess, 1),
            "exploration_count": sum(1 for d in data if d[1] < 0.5),  # low-propensity = likely exploration
            "confidence": "high" if ess >= 20 else "medium" if ess >= 10 else "low",
        }

    return {
        "tenant_id": None,
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "total_decisions": len(decision_outcomes),
        "resolved_decisions": sum(len(v) for v in by_action.values()),
        "action_estimates": results,
    }


def compute_exploration_rate(
    ips_results: dict[str, Any],
    base_rate: float = 0.10,
    min_rate: float = 0.02,
    decay_factor: float = 0.95,
) -> float:
    """Compute the current exploration rate based on evidence strength.

    Starts at base_rate and decays as effective sample sizes grow.
    """
    estimates = ips_results.get("action_estimates", {})
    if not estimates:
        return base_rate

    # Average effective sample size across actions
    ess_values = [e["effective_sample_size"] for e in estimates.values()]
    avg_ess = sum(ess_values) / len(ess_values) if ess_values else 0

    # Decay exploration as evidence accumulates
    # At ESS=0 → base_rate, at ESS=50 → ~min_rate
    if avg_ess <= 0:
        return base_rate

    rate = base_rate * (decay_factor ** (avg_ess / 5))
    return max(min_rate, min(base_rate, rate))
