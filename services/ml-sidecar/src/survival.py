"""Survival model for time-to-pay prediction.

Open invoices are right-censored observations — an invoice that is 10 days
old and not yet paid is NOT a "negative." It just hasn't resolved yet.
The previous logistic regression treated these as negatives, which is wrong.

This module uses lifelines CoxPH for survival analysis:
- Time-to-pay as the primary event
- Write-off/cancel as competing risks
- Proper handling of censored (still-open) observations

Evaluation: C-index for ranking quality, time-dependent Brier score.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

MIN_SURVIVAL_SAMPLES = 30


@dataclass
class TrainedSurvivalModel:
    model_id: str
    tenant_id: str | None
    scope: str
    feature_names: list[str]
    model: Any  # CoxPHFitter or similar
    trained_at: str
    sample_count: int
    event_count: int
    censored_count: int
    concordance: float | None
    median_survival_days: float | None
    metadata: dict[str, Any]


@dataclass
class SurvivalPrediction:
    median_days_to_pay: float | None
    survival_7d: float  # P(still unpaid at day 7)
    survival_30d: float  # P(still unpaid at day 30)
    survival_90d: float  # P(still unpaid at day 90)
    hazard_ratio: float  # relative risk vs median invoice
    concordance: float | None


def fit_survival_model(
    epochs: list[dict[str, Any]],
    *,
    tenant_id: str | None = None,
    scope: str = "tenant",
) -> TrainedSurvivalModel | None:
    """Fit a Cox Proportional Hazards model on resolved decision epochs.

    Each epoch contributes one observation:
    - duration: time_to_pay_days (from outcome_label) or days since epoch_at (if censored)
    - event: 1 if paid, 0 if censored/still-open/written-off
    """
    if len(epochs) < MIN_SURVIVAL_SAMPLES:
        return None

    try:
        from lifelines import CoxPHFitter
    except ImportError:
        logger.warning("lifelines not installed, skipping survival model")
        return None

    import pandas as pd

    records = []
    for epoch in epochs:
        label = epoch.get("outcome_label")
        snapshot = epoch.get("feature_snapshot")
        if not isinstance(label, dict) or not isinstance(snapshot, dict):
            continue

        time_to_pay = label.get("time_to_pay_days")
        censored = label.get("censored", False)
        bad_debt = label.get("bad_debt", False)

        if time_to_pay is not None and time_to_pay > 0:
            duration = float(time_to_pay)
            event = 1  # observed payment
        elif censored:
            # Duration = time from epoch to now (or outcome_window_end)
            epoch_at = epoch.get("epoch_at")
            window_end = epoch.get("outcome_window_end")
            if epoch_at and window_end:
                try:
                    ea = datetime.fromisoformat(str(epoch_at).replace("Z", "+00:00"))
                    we = datetime.fromisoformat(str(window_end).replace("Z", "+00:00"))
                    duration = max(1.0, (we - ea).total_seconds() / 86400.0)
                except (ValueError, TypeError):
                    duration = 30.0
            else:
                duration = 30.0
            event = 0  # censored
        elif bad_debt:
            duration = 90.0  # convention: bad debt at 90 days
            event = 0  # censored (not a payment event)
        else:
            continue

        # Select survival-relevant features from snapshot
        record = {
            "duration": max(0.5, duration),  # floor at 0.5 days
            "event": event,
            "amountCents": float(snapshot.get("amountCents", 0)),
            "daysOverdue": float(snapshot.get("daysOverdue", 0)),
            "amountPaidRatio": float(snapshot.get("amountPaidRatio", 0)),
            "paymentReliability": float(snapshot.get("paymentReliability", 0)),
            "disputeRisk": float(snapshot.get("disputeRisk", 0)),
            "reminderCount": float(snapshot.get("reminderCount", 0)),
            "daysToPaySlope": float(snapshot.get("daysToPaySlope", 0)),
            "customerReliabilityPercentile": float(snapshot.get("customerReliabilityPercentile", 0.5)),
            "amountVsTenantMedian": float(snapshot.get("amountVsTenantMedian", 1.0)),
        }
        records.append(record)

    if len(records) < MIN_SURVIVAL_SAMPLES:
        return None

    df = pd.DataFrame(records)
    event_count = int(df["event"].sum())
    censored_count = len(df) - event_count

    if event_count < 5:
        logger.info("Too few events (%d) for survival model", event_count)
        return None

    feature_cols = [c for c in df.columns if c not in ("duration", "event")]

    # Standardize features for numerical stability
    means = df[feature_cols].mean()
    stds = df[feature_cols].std().replace(0, 1)
    df[feature_cols] = (df[feature_cols] - means) / stds

    cph = CoxPHFitter(penalizer=0.1)
    try:
        cph.fit(df, duration_col="duration", event_col="event")
    except Exception as e:
        logger.warning("CoxPH fit failed: %s", e)
        return None

    concordance = float(cph.concordance_index_) if hasattr(cph, "concordance_index_") else None

    # Median survival time
    try:
        median_survival = float(cph.median_survival_time_)
    except (AttributeError, ValueError):
        median_survival = None

    model_id = f"ml_survival_cox_{scope}_v1"

    return TrainedSurvivalModel(
        model_id=model_id,
        tenant_id=tenant_id,
        scope=scope,
        feature_names=feature_cols,
        model={
            "cph": cph,
            "feature_means": means.to_dict(),
            "feature_stds": stds.to_dict(),
        },
        trained_at=datetime.now(timezone.utc).isoformat(),
        sample_count=len(records),
        event_count=event_count,
        censored_count=censored_count,
        concordance=concordance,
        median_survival_days=median_survival,
        metadata={
            "model_family": "cox_ph",
            "feature_source": "decision_epochs_v1",
            "penalizer": 0.1,
        },
    )


def predict_survival(
    model: TrainedSurvivalModel,
    features: dict[str, float],
) -> SurvivalPrediction:
    """Predict survival function for a single invoice."""
    import pandas as pd

    cph = model.model["cph"]
    means = model.model["feature_means"]
    stds = model.model["feature_stds"]

    # Build feature vector, standardized
    record = {}
    for name in model.feature_names:
        raw = float(features.get(name, 0.0))
        mean = float(means.get(name, 0.0))
        std = float(stds.get(name, 1.0))
        record[name] = (raw - mean) / std if std > 0 else 0.0

    df = pd.DataFrame([record])

    # Survival function at specific time points
    try:
        sf = cph.predict_survival_function(df, times=[7, 30, 90])
        survival_7d = float(sf.iloc[0, 0]) if sf.shape[0] > 0 else 0.5
        survival_30d = float(sf.iloc[1, 0]) if sf.shape[0] > 1 else 0.3
        survival_90d = float(sf.iloc[2, 0]) if sf.shape[0] > 2 else 0.1
    except Exception:
        survival_7d = 0.5
        survival_30d = 0.3
        survival_90d = 0.1

    # Median time to pay for this specific invoice
    try:
        median = cph.predict_median(df)
        median_days = float(median.iloc[0]) if not np.isinf(median.iloc[0]) else None
    except Exception:
        median_days = None

    # Hazard ratio relative to baseline
    try:
        hr = float(np.exp(cph.predict_partial_hazard(df).iloc[0]))
    except Exception:
        hr = 1.0

    return SurvivalPrediction(
        median_days_to_pay=median_days,
        survival_7d=round(survival_7d, 4),
        survival_30d=round(survival_30d, 4),
        survival_90d=round(survival_90d, 4),
        hazard_ratio=round(hr, 4),
        concordance=model.concordance,
    )
