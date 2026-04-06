"""CatBoost payment propensity model.

Replaces logistic regression with CatBoost for payment prediction:
- Native categorical feature handling
- Monotone constraints (encode domain knowledge)
- Virtual ensemble uncertainty
- SHAP reason codes for every prediction

Three prediction heads:
  - paymentProbability7d: paid within 7 days
  - paymentProbability30d: paid within 30 days
  - badDebtRisk: will be written off

Falls back to logistic regression if < 50 samples (CatBoost needs more data).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Features where higher value should DECREASE payment probability
MONOTONE_DECREASING = {
    "daysOverdue",
    "amountRemainingRatio",
    "disputeRisk",
    "churnRisk",
    "overdueVsTerms",
    "escalationCount",
    "disputeCount",
}

# Features where higher value should INCREASE payment probability
MONOTONE_INCREASING = {
    "paymentReliability",
    "amountPaidRatio",
    "customerReliabilityPercentile",
    "paymentFrequencyScore",
    "invoicesPaidCount",
}

MIN_CATBOOST_SAMPLES = 50


@dataclass
class TrainedCatBoostModel:
    model_id: str
    release_id: str | None
    release_status: str
    scope: str
    tenant_id: str | None
    prediction_type: str
    feature_names: list[str]
    model: Any  # CatBoostClassifier
    calibrator: dict[str, Any] | None
    trained_at: str
    sample_count: int
    positive_rate: float
    brier_score: float | None
    roc_auc: float | None
    metadata: dict[str, Any]
    shap_explainer: Any | None = None


@dataclass
class ShapReason:
    feature: str
    value: float
    contribution: float


def _build_monotone_constraints(feature_names: list[str]) -> list[int]:
    """Build monotone constraint vector: -1=decreasing, 0=none, 1=increasing."""
    constraints = []
    for name in feature_names:
        if name in MONOTONE_DECREASING:
            constraints.append(-1)
        elif name in MONOTONE_INCREASING:
            constraints.append(1)
        else:
            constraints.append(0)
    return constraints


def fit_catboost_payment_model(
    rows: list[dict[str, Any]],
    *,
    prediction_type: str,
    tenant_id: str | None,
    scope: str,
) -> TrainedCatBoostModel | None:
    """Fit a CatBoost classifier for payment prediction.

    Requires at least MIN_CATBOOST_SAMPLES rows. For smaller datasets,
    the caller should fall back to logistic regression.
    """
    if len(rows) < MIN_CATBOOST_SAMPLES:
        return None

    try:
        from catboost import CatBoostClassifier
    except ImportError:
        logger.warning("catboost not installed, skipping CatBoost training")
        return None

    # Extract features and labels from epoch rows
    feature_rows = []
    outcomes = []
    for row in rows:
        snapshot = row.get("feature_snapshot")
        if isinstance(snapshot, dict) and snapshot:
            feature_rows.append(snapshot)
            label = row.get("outcome_label")
            if isinstance(label, dict):
                if prediction_type == "paymentProbability7d":
                    outcomes.append(int(bool(label.get("paid_7d"))))
                elif prediction_type == "badDebtRisk":
                    outcomes.append(int(bool(label.get("bad_debt"))))
                else:
                    outcomes.append(int(bool(label.get("paid_30d"))))
            else:
                outcomes.append(int(float(row.get("outcome_value", 0)) >= 0.5))
        else:
            # Legacy row — skip for CatBoost (needs epoch data)
            continue

    if len(feature_rows) < MIN_CATBOOST_SAMPLES:
        return None

    if len(set(outcomes)) < 2:
        return None

    feature_names = sorted(feature_rows[0].keys())
    X = np.asarray(
        [[float(row.get(name, 0.0)) for name in feature_names] for row in feature_rows],
        dtype=np.float64,
    )
    y = np.asarray(outcomes, dtype=np.int32)

    monotone_constraints = _build_monotone_constraints(feature_names)

    model = CatBoostClassifier(
        iterations=300,
        learning_rate=0.05,
        depth=6,
        l2_leaf_reg=3.0,
        monotone_constraints=monotone_constraints,
        auto_class_weights="Balanced",
        random_seed=42,
        verbose=0,
        posterior_sampling=True,  # virtual ensemble for uncertainty
    )
    model.fit(X, y)

    probabilities = model.predict_proba(X)[:, 1]

    # Calibration
    from .calibration import fit_best_calibrator, calibrate
    calibrator = fit_best_calibrator(probabilities.tolist(), y.astype(float).tolist()) if len(rows) >= 30 else None

    calibrated = np.asarray(
        [calibrate(float(p), calibrator) if calibrator else float(p) for p in probabilities],
        dtype=np.float64,
    )

    # Metrics
    from sklearn.metrics import brier_score_loss, roc_auc_score
    brier = float(brier_score_loss(y, calibrated))
    try:
        auc = float(roc_auc_score(y, calibrated))
    except ValueError:
        auc = None

    scope_label = "tenant" if scope == "tenant" else "global"
    model_id = f"ml_catboost_{prediction_type}_{scope_label}_v1"

    # SHAP explainer (precompute for fast per-prediction SHAP)
    shap_explainer = None
    try:
        import shap
        shap_explainer = shap.TreeExplainer(model)
    except Exception:
        logger.warning("Failed to create SHAP explainer")

    return TrainedCatBoostModel(
        model_id=model_id,
        release_id=None,
        release_status="candidate",
        scope=scope,
        tenant_id=tenant_id,
        prediction_type=prediction_type,
        feature_names=feature_names,
        model=model,
        calibrator=calibrator,
        trained_at=datetime.now(timezone.utc).isoformat(),
        sample_count=len(feature_rows),
        positive_rate=float(y.mean()),
        brier_score=brier,
        roc_auc=auc,
        metadata={
            "feature_source": "decision_epochs_v1",
            "model_family": "catboost",
            "baseline_model_id": "rule_inference",
            "monotone_features_constrained": sum(1 for c in monotone_constraints if c != 0),
            "iterations": 300,
        },
        shap_explainer=shap_explainer,
    )


def predict_catboost(
    model: TrainedCatBoostModel,
    features: dict[str, float],
    *,
    top_k_shap: int = 5,
) -> dict[str, Any]:
    """Predict with CatBoost model, returning value, interval, and SHAP reasons."""
    from .calibration import calibrate

    vector = np.asarray(
        [[float(features.get(name, 0.0)) for name in model.feature_names]],
        dtype=np.float64,
    )

    raw_prob = float(model.model.predict_proba(vector)[0][1])
    calibrated = calibrate(raw_prob, model.calibrator) if model.calibrator else raw_prob
    value = float(np.clip(calibrated, 0.0, 1.0))

    # Virtual ensemble uncertainty — predict with posterior sampling
    try:
        virtual_preds = model.model.virtual_ensembles_predict(
            vector, prediction_type="TotalUncertainty",
        )
        # virtual_preds shape: (1, 2) -> [mean, variance]
        variance = float(virtual_preds[0][1]) if virtual_preds.shape[1] > 1 else 0.02
        std = float(np.sqrt(max(variance, 0)))
        lower = float(np.clip(value - 1.645 * std, 0.0, 1.0))
        upper = float(np.clip(value + 1.645 * std, 0.0, 1.0))
    except Exception:
        # Fallback interval
        lower = float(np.clip(value - 0.15, 0.0, 1.0))
        upper = float(np.clip(value + 0.15, 0.0, 1.0))

    interval = {"lower": lower, "upper": upper, "coverage": 0.90}

    # SHAP reason codes
    shap_reasons: list[dict[str, Any]] = []
    if model.shap_explainer is not None:
        try:
            shap_values = model.shap_explainer.shap_values(vector)
            # For binary classification, shap_values may be a list [class0, class1]
            if isinstance(shap_values, list):
                sv = shap_values[1][0]  # class 1 (positive) SHAP values
            else:
                sv = shap_values[0]

            # Top-k by absolute contribution
            indexed = [(model.feature_names[i], float(features.get(model.feature_names[i], 0)), float(sv[i])) for i in range(len(sv))]
            indexed.sort(key=lambda x: abs(x[2]), reverse=True)
            shap_reasons = [
                {"feature": name, "value": round(val, 4), "contribution": round(contrib, 4)}
                for name, val, contrib in indexed[:top_k_shap]
            ]
        except Exception:
            pass

    return {
        "value": value,
        "raw_value": raw_prob,
        "interval": interval,
        "shap_reasons": shap_reasons,
    }
