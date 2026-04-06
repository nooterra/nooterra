from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import brier_score_loss, mean_absolute_error, r2_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .calibration import calibrate, fit_best_calibrator
from .conformal import compute_intervals_from_residuals
from .features import build_invoice_feature_map, build_full_feature_vector, compute_feature_hash


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


@dataclass
class TrainedProbabilityModel:
    model_id: str
    release_id: str | None
    release_status: str
    scope: str
    tenant_id: str | None
    prediction_type: str
    feature_names: list[str]
    estimator: Pipeline
    calibrator: dict[str, Any] | None
    trained_at: str
    sample_count: int
    positive_rate: float
    brier_score: float | None
    roc_auc: float | None
    residuals: list[float]
    metadata: dict[str, Any]


@dataclass
class TrainedInterventionModel:
    model_id: str
    tenant_id: str
    action_class: str
    object_type: str
    field: str
    feature_names: list[str]
    estimator: Pipeline
    trained_at: str
    sample_count: int
    mean_absolute_error: float
    r2_score: float | None
    delta_mean: float
    metadata: dict[str, Any]


@dataclass
class ComparativeTreatmentSummary:
    chosen_action_class: str
    baseline_action_class: str
    chosen_sample_count: int
    baseline_sample_count: int
    chosen_avg_delta: float
    baseline_avg_delta: float
    treatment_lift: float
    quality_score: float
    evidence_strength: float
    comparative_winner: bool


def fit_probability_model(
    rows: list[dict[str, Any]],
    *,
    prediction_type: str,
    tenant_id: str | None,
    scope: str,
) -> TrainedProbabilityModel | None:
    if len(rows) < 12:
        return None

    feature_rows = []
    outcomes = []
    is_epoch_based = False
    for row in rows:
        # Epoch-based rows carry a frozen feature_snapshot (point-in-time correct).
        # Legacy rows carry current state/estimated (data leakage — to be phased out).
        feature_snapshot = row.get("feature_snapshot")
        if isinstance(feature_snapshot, dict) and feature_snapshot:
            feature_rows.append(feature_snapshot)
            is_epoch_based = True
            label = row.get("outcome_label")
            if isinstance(label, dict):
                outcomes.append(int(bool(label.get("paid_7d")) if prediction_type == "paymentProbability7d" else bool(label.get("paid_30d"))))
            else:
                outcomes.append(int(_to_float(row.get("outcome_value")) >= 0.5))
        else:
            state = row.get("state") if isinstance(row.get("state"), dict) else {}
            estimated = row.get("estimated") if isinstance(row.get("estimated"), dict) else {}
            feature_rows.append(
                build_invoice_feature_map(
                    state,
                    estimated,
                    reference_time=_parse_datetime(row.get("predicted_at")),
                )
            )
            outcomes.append(int(_to_float(row.get("outcome_value")) >= 0.5))

    if len(set(outcomes)) < 2:
        return None

    feature_names = sorted(feature_rows[0].keys())
    X = np.asarray([[feature_row.get(name, 0.0) for name in feature_names] for feature_row in feature_rows], dtype=np.float64)
    y = np.asarray(outcomes, dtype=np.int32)

    estimator = Pipeline([
        ("scaler", StandardScaler()),
        ("logreg", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=0)),
    ])
    estimator.fit(X, y)

    raw_probabilities = estimator.predict_proba(X)[:, 1]
    calibrator = fit_best_calibrator(raw_probabilities.tolist(), y.astype(float).tolist()) if len(rows) >= 20 else None
    probabilities = np.asarray(
        [calibrate(float(prob), calibrator) if calibrator is not None else float(prob) for prob in raw_probabilities],
        dtype=np.float64,
    )
    residuals = (probabilities - y).tolist()

    try:
        auc = float(roc_auc_score(y, probabilities))
    except ValueError:
        auc = None

    score_scope = "tenant" if scope == "tenant" else "global"
    model_id = (
        f"ml_logreg_invoice_payment_7d_{score_scope}_v1"
        if prediction_type == "paymentProbability7d"
        else f"ml_logreg_{prediction_type}_{score_scope}_v1"
    )

    return TrainedProbabilityModel(
        model_id=model_id,
        release_id=None,
        release_status="candidate",
        scope=scope,
        tenant_id=tenant_id,
        prediction_type=prediction_type,
        feature_names=feature_names,
        estimator=estimator,
        calibrator=calibrator,
        trained_at=datetime.now(timezone.utc).isoformat(),
        sample_count=len(rows),
        positive_rate=float(y.mean()),
        brier_score=float(brier_score_loss(y, probabilities)),
        roc_auc=auc,
        residuals=residuals,
        metadata={
            "feature_source": "decision_epochs_v1" if is_epoch_based else "current_world_object_snapshot_v1",
            "model_family": "logistic_regression",
            "baseline_model_id": "rule_inference",
        },
    )


def predict_with_trained_model(
    model: TrainedProbabilityModel,
    request_features: dict[str, Any],
) -> dict[str, Any]:
    vector = np.asarray(
        [[_to_float(request_features.get(feature_name)) for feature_name in model.feature_names]],
        dtype=np.float64,
    )
    raw_probability = float(model.estimator.predict_proba(vector)[0][1])
    calibrated_probability = calibrate(raw_probability, model.calibrator) if model.calibrator is not None else raw_probability
    interval = compute_intervals_from_residuals(model.residuals, calibrated_probability, coverage=0.90)
    return {
        "value": float(np.clip(calibrated_probability, 0.0, 1.0)),
        "raw_value": float(np.clip(raw_probability, 0.0, 1.0)),
        "interval": interval,
    }


def fit_intervention_effect_model(
    rows: list[dict[str, Any]],
    *,
    tenant_id: str,
    action_class: str,
    object_type: str,
    field: str,
) -> TrainedInterventionModel | None:
    if len(rows) < 8:
        return None

    feature_rows = []
    targets = []
    for row in rows:
        state = row.get("state") if isinstance(row.get("state"), dict) else {}
        estimated = row.get("estimated") if isinstance(row.get("estimated"), dict) else {}
        features = build_invoice_feature_map(
            state,
            estimated,
            reference_time=_parse_datetime(row.get("observed_at")),
        )
        features = {
            **features,
            "currentValue": _to_float(row.get("current_value")),
            "predictedValue": _to_float(row.get("predicted_value")),
            "deltaExpected": _to_float(row.get("delta_expected")),
            "effectConfidence": _to_float(row.get("confidence"), 0.5),
            "objectiveScore": _to_float(row.get("objective_score"), 0.0),
        }
        feature_rows.append(features)
        targets.append(_to_float(row.get("delta_observed")))

    feature_names = sorted(feature_rows[0].keys())
    X = np.asarray([[feature_row.get(name, 0.0) for name in feature_names] for feature_row in feature_rows], dtype=np.float64)
    y = np.asarray(targets, dtype=np.float64)

    estimator = Pipeline([
        ("scaler", StandardScaler()),
        ("regression", LinearRegression()),
    ])
    estimator.fit(X, y)
    predicted_deltas = estimator.predict(X)
    mae = float(mean_absolute_error(y, predicted_deltas))
    try:
        model_r2 = float(r2_score(y, predicted_deltas))
    except Exception:
        model_r2 = None

    return TrainedInterventionModel(
        model_id=f"ml_intervention_effect_{action_class}_{object_type}_{field}_v1",
        tenant_id=tenant_id,
        action_class=action_class,
        object_type=object_type,
        field=field,
        feature_names=feature_names,
        estimator=estimator,
        trained_at=datetime.now(timezone.utc).isoformat(),
        sample_count=len(rows),
        mean_absolute_error=mae,
        r2_score=model_r2,
        delta_mean=float(y.mean()) if len(y) > 0 else 0.0,
        metadata={
            "model_family": "linear_regression",
            "feature_source": "world_action_effect_observations_v1",
        },
    )


def predict_with_intervention_model(
    model: TrainedInterventionModel,
    state: dict[str, Any] | None,
    estimated: dict[str, Any] | None,
    *,
    current_value: float,
    predicted_value: float,
    confidence: float,
    objective_score: float = 0.0,
) -> dict[str, Any]:
    feature_map = {
        **build_invoice_feature_map(state, estimated),
        "currentValue": _to_float(current_value),
        "predictedValue": _to_float(predicted_value),
        "deltaExpected": _to_float(predicted_value) - _to_float(current_value),
        "effectConfidence": _to_float(confidence, 0.5),
        "objectiveScore": _to_float(objective_score, 0.0),
    }
    vector = np.asarray(
        [[_to_float(feature_map.get(feature_name)) for feature_name in model.feature_names]],
        dtype=np.float64,
    )
    predicted_delta = float(model.estimator.predict(vector)[0])
    next_value = _to_float(current_value) + predicted_delta
    quality_score = float(np.clip((1.0 - min(model.mean_absolute_error, 1.0)) * 0.8 + (min(model.sample_count, 50) / 50.0) * 0.2, 0.0, 1.0))
    evidence_strength = float(np.clip((quality_score * 0.7) + (min(model.sample_count, 40) / 40.0) * 0.3, 0.0, 1.0))
    predicted_confidence = float(np.clip((quality_score * 0.75) + (_to_float(confidence, 0.5) * 0.25), 0.15, 0.98))
    return {
        "delta": predicted_delta,
        "predicted_value": next_value,
        "confidence": predicted_confidence,
        "quality_score": quality_score,
        "evidence_strength": evidence_strength,
    }


def summarize_comparative_treatment(
    rows: list[dict[str, Any]],
    *,
    action_class: str,
) -> ComparativeTreatmentSummary | None:
    if len(rows) < 2:
        return None

    normalized_rows = []
    for row in rows:
        sample_count = int(_to_float(row.get("sample_count"), 0))
        if sample_count <= 0:
            continue
        normalized_rows.append(
            {
                "action_class": str(row.get("action_class") or ""),
                "sample_count": sample_count,
                "avg_delta_observed": _to_float(row.get("avg_delta_observed")),
                "avg_confidence": _to_float(row.get("avg_confidence"), 0.5),
                "match_rate": _to_float(row.get("match_rate"), 0.5),
                "avg_objective_score": _to_float(row.get("avg_objective_score"), 0.0),
            }
        )

    if len(normalized_rows) < 2:
        return None

    chosen = next((row for row in normalized_rows if row["action_class"] == action_class and row["sample_count"] >= 4), None)
    if chosen is None:
        return None

    alternatives = [
        row for row in normalized_rows
        if row["action_class"] != action_class and row["sample_count"] >= 4
    ]
    if not alternatives:
        return None

    baseline = sorted(
        alternatives,
        key=lambda row: (
            row["avg_objective_score"],
            row["sample_count"],
            row["avg_confidence"],
            row["action_class"],
        ),
        reverse=True,
    )[0]

    treatment_lift = chosen["avg_delta_observed"] - baseline["avg_delta_observed"]
    sample_balance = min(chosen["sample_count"], baseline["sample_count"])
    comparative_quality = np.clip(
        ((min(sample_balance, 24) / 24.0) * 0.45)
        + ((((chosen["avg_confidence"] + baseline["avg_confidence"]) / 2.0)) * 0.15)
        + ((((chosen["match_rate"] + baseline["match_rate"]) / 2.0)) * 0.2)
        + (min(abs(treatment_lift), 0.35) / 0.35 * 0.1)
        + (min(abs(chosen["avg_objective_score"] - baseline["avg_objective_score"]), 0.25) / 0.25 * 0.1),
        0.0,
        1.0,
    )
    evidence_strength = np.clip(
        (comparative_quality * 0.75) + (min(sample_balance, 20) / 20.0 * 0.25),
        0.0,
        1.0,
    )

    return ComparativeTreatmentSummary(
        chosen_action_class=action_class,
        baseline_action_class=str(baseline["action_class"]),
        chosen_sample_count=int(chosen["sample_count"]),
        baseline_sample_count=int(baseline["sample_count"]),
        chosen_avg_delta=float(chosen["avg_delta_observed"]),
        baseline_avg_delta=float(baseline["avg_delta_observed"]),
        treatment_lift=float(treatment_lift),
        quality_score=float(comparative_quality),
        evidence_strength=float(evidence_strength),
        comparative_winner=bool(treatment_lift >= 0),
    )
