"""
Two-model uplift baseline (T-learner).

Treatment model: P(paid | action taken, features)
Control model:   P(paid | hold/no-action, features)
Lift:            treatment_prob - control_prob
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .training import build_invoice_feature_map, _to_float, _parse_datetime
from .conformal import compute_intervals_from_residuals  # noqa: F401 — used for reference


@dataclass
class TrainedUpliftModel:
    model_id: str
    tenant_id: str
    action_class: str
    scope: str
    feature_names: list[str]
    treatment_estimator: Pipeline
    control_estimator: Pipeline
    trained_at: str
    treatment_sample_count: int
    control_sample_count: int
    treatment_positive_rate: float
    control_positive_rate: float
    observed_lift: float
    residuals: list[float]
    metadata: dict[str, Any]


def _build_features_from_graded_outcome(row: dict[str, Any]) -> dict[str, float]:
    state = row.get("state") if isinstance(row.get("state"), dict) else {}
    estimated = row.get("estimated") if isinstance(row.get("estimated"), dict) else {}

    if state or estimated:
        return build_invoice_feature_map(
            state, estimated,
            reference_time=_parse_datetime(row.get("action_at")),
        )

    return {
        "amountCents": _to_float(row.get("invoice_amount_cents")),
        "amountRemainingCents": _to_float(row.get("invoice_amount_cents")),
        "amountPaidCents": 0.0,
        "amountRemainingRatio": 1.0,
        "amountPaidRatio": 0.0,
        "daysOverdue": _to_float(row.get("days_overdue")),
        "isOverdue": 1.0,
        "isSent": 0.0,
        "isPartial": 0.0,
        "isPaid": 0.0,
        "isDisputed": 0.0,
        "disputeRisk": 0.0,
        "urgency": min(1.0, _to_float(row.get("days_overdue")) / 30.0),
        "paymentProbability30d": _to_float(row.get("predicted_payment_prob", 0.5)),
        "paymentReliability": 0.5,
        "churnRisk": 0.2,
    }


def fit_uplift_model(
    outcomes: list[dict[str, Any]],
    *,
    tenant_id: str,
    action_class: str,
    min_treatment: int = 30,
    min_control: int = 15,
) -> TrainedUpliftModel | None:
    treatment_rows = []
    control_rows = []

    for row in outcomes:
        decision = row.get("decision_type", "")
        ac = row.get("action_class", "")
        if decision == "strategic_hold" or ac == "strategic.hold":
            control_rows.append(row)
        elif ac == action_class:  # STRICT: only this action class in treatment
            treatment_rows.append(row)
        # Rows with other action classes are DROPPED — not treatment, not control

    if len(treatment_rows) < min_treatment or len(control_rows) < min_control:
        return None

    treatment_features = [_build_features_from_graded_outcome(r) for r in treatment_rows]
    control_features = [_build_features_from_graded_outcome(r) for r in control_rows]
    feature_names = sorted(treatment_features[0].keys())

    def to_matrix(feature_rows):
        return np.asarray(
            [[f.get(name, 0.0) for name in feature_names] for f in feature_rows],
            dtype=np.float64,
        )

    X_treat = to_matrix(treatment_features)
    y_treat = np.asarray([1 if row.get("objective_achieved") else 0 for row in treatment_rows], dtype=np.int32)
    X_ctrl = to_matrix(control_features)
    y_ctrl = np.asarray([1 if row.get("objective_achieved") else 0 for row in control_rows], dtype=np.int32)

    if len(set(y_treat.tolist())) < 2 or len(set(y_ctrl.tolist())) < 2:
        return None

    treatment_estimator = Pipeline([
        ("scaler", StandardScaler()),
        ("logreg", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=0)),
    ])
    treatment_estimator.fit(X_treat, y_treat)

    control_estimator = Pipeline([
        ("scaler", StandardScaler()),
        ("logreg", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=1)),
    ])
    control_estimator.fit(X_ctrl, y_ctrl)

    treat_preds = treatment_estimator.predict_proba(X_treat)[:, 1]
    ctrl_preds_on_treat = control_estimator.predict_proba(X_treat)[:, 1]
    predicted_lifts_treat = treat_preds - ctrl_preds_on_treat
    actual_lifts_treat = y_treat.astype(float) - ctrl_preds_on_treat
    residuals = (predicted_lifts_treat - actual_lifts_treat).tolist()

    treatment_positive_rate = float(y_treat.mean())
    control_positive_rate = float(y_ctrl.mean())
    observed_lift = treatment_positive_rate - control_positive_rate

    model_id = f"uplift_tlearner_{action_class.replace('.', '_')}_v1"

    return TrainedUpliftModel(
        model_id=model_id,
        tenant_id=tenant_id,
        action_class=action_class,
        scope="tenant",
        feature_names=feature_names,
        treatment_estimator=treatment_estimator,
        control_estimator=control_estimator,
        trained_at=datetime.now(timezone.utc).isoformat(),
        treatment_sample_count=len(treatment_rows),
        control_sample_count=len(control_rows),
        treatment_positive_rate=treatment_positive_rate,
        control_positive_rate=control_positive_rate,
        observed_lift=observed_lift,
        residuals=residuals,
        metadata={
            "model_family": "t_learner",
            "treatment_action_class": action_class,
            "control_decision_type": "strategic_hold",
        },
    )


def predict_uplift(
    model: TrainedUpliftModel,
    features: dict[str, Any],
) -> dict[str, Any]:
    vector = np.asarray(
        [[_to_float(features.get(name)) for name in model.feature_names]],
        dtype=np.float64,
    )
    treatment_prob = float(model.treatment_estimator.predict_proba(vector)[0][1])
    control_prob = float(model.control_estimator.predict_proba(vector)[0][1])
    lift = treatment_prob - control_prob

    # Compute conformal interval directly for lift (which can be negative,
    # unlike probabilities, so we clip to [-1, 1] instead of [0, 1]).
    resids = np.asarray(model.residuals, dtype=np.float64)
    if len(resids) == 0:
        q = 0.5
    else:
        abs_resids = np.abs(resids)
        n = len(abs_resids)
        quantile_level = min(np.ceil((n + 1) * 0.90) / n, 1.0)
        q = float(np.quantile(abs_resids, quantile_level))
    interval = {
        "lower": float(np.clip(lift - q, -1.0, 1.0)),
        "upper": float(np.clip(lift + q, -1.0, 1.0)),
        "coverage": 0.90,
    }

    return {
        "lift": float(np.clip(lift, -1.0, 1.0)),
        "treatment_prob": float(np.clip(treatment_prob, 0.0, 1.0)),
        "control_prob": float(np.clip(control_prob, 0.0, 1.0)),
        "interval": interval,
        "model_id": model.model_id,
        "treatment_samples": model.treatment_sample_count,
        "control_samples": model.control_sample_count,
        "observed_lift": model.observed_lift,
    }
