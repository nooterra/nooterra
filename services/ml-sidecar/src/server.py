from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import FastAPI
import numpy as np
from starlette.requests import Request
from starlette.responses import JSONResponse

from .calibration import fit_best_calibrator, calibrate
from .uplift import fit_uplift_model, predict_uplift, TrainedUpliftModel
from .conformal import compute_intervals_from_residuals
from .db import (
    close_pool,
    get_epoch_training_rows,
    get_event_counts_for_object,
    get_intervention_comparison_rows,
    get_intervention_training_rows,
    get_latest_model_release,
    get_party_id_for_invoice,
    get_pool,
    get_prediction_outcome_pairs,
    get_prediction_training_rows,
    insert_model_release,
    list_model_releases,
)
from .epoch_trigger import (
    create_epoch_for_invoice,
    resolve_pending_outcomes,
    sweep_invoices_for_epochs,
)
from .features import build_full_feature_vector
from .tenant_stats import load_tenant_stats_with_customer
from .trajectory import load_customer_trajectory
from .drift import drift_monitor, check_all_models
from .models import (
    CalibrateRequest,
    CalibrateResponse,
    CalibrationInfo,
    ConfidenceInterval,
    DriftInfo,
    DriftResponse,
    DriftStatus,
    InterventionEstimate,
    InterventionEstimateRequest,
    InterventionEstimateResponse,
    ModelRelease,
    ModelReleaseResponse,
    ModelSelectionInfo,
    OodInfo,
    PredictRequest,
    PredictResponse,
    TrainRequest,
    TrainResponse,
)
from .ood import distribution_monitor
from .catboost_model import TrainedCatBoostModel, fit_catboost_payment_model, predict_catboost
from .segments import assign_segment, get_tenant_segment, upsert_tenant_segment
from .survival import TrainedSurvivalModel, fit_survival_model, predict_survival
from .training import (
    TrainedInterventionModel,
    TrainedProbabilityModel,
    build_invoice_feature_map,
    fit_intervention_effect_model,
    fit_probability_model,
    predict_with_intervention_model,
    predict_with_trained_model,
    summarize_comparative_treatment,
)

log = logging.getLogger("ml-sidecar")

# LRU-bounded model caches — prevent OOM from unbounded tenant growth.
# Max 200 entries per cache; evicts least-recently-used when full.
from collections import OrderedDict

MAX_CACHE_SIZE = int(os.environ.get("ML_MODEL_CACHE_SIZE", "200"))

class LRUCache(OrderedDict):
    """Simple LRU cache using OrderedDict. Thread-safe for single-threaded async."""
    def __init__(self, maxsize=MAX_CACHE_SIZE):
        super().__init__()
        self._maxsize = maxsize

    def get(self, key, default=None):
        if key in self:
            self.move_to_end(key)
            return self[key]
        return default

    def set(self, key, value):
        if key in self:
            self.move_to_end(key)
        self[key] = value
        while len(self) > self._maxsize:
            self.popitem(last=False)

    # dict-compatible __setitem__ for direct assignment
    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        while len(self) > self._maxsize:
            self.popitem(last=False)

_calibrators: LRUCache = LRUCache()
_trained_models: LRUCache = LRUCache()
_catboost_models: LRUCache = LRUCache()
_survival_models: LRUCache = LRUCache()
_intervention_models: LRUCache = LRUCache()
_uplift_models: LRUCache = LRUCache()

MIN_TENANT_TRAINING_ROWS = 20
MIN_GLOBAL_TRAINING_ROWS = 50
MIN_INTERVENTION_TRAINING_ROWS = 8
ELIGIBLE_LEARNED_PREDICTIONS = {"paymentProbability7d"}


def _cache_key(scope: str, prediction_type: str, tenant_id: str | None) -> str:
    return f"{scope}:{tenant_id or 'global'}:{prediction_type}"


def _intervention_cache_key(tenant_id: str, action_class: str, object_type: str, field: str) -> str:
    return f"{tenant_id}:{action_class}:{object_type}:{field}"


def _feature_matrix_from_rows(rows: list[dict[str, Any]]) -> dict[str, list[float]]:
    columns: dict[str, list[float]] = {}
    for row in rows:
        features = build_invoice_feature_map(
            row.get("state") if isinstance(row.get("state"), dict) else {},
            row.get("estimated") if isinstance(row.get("estimated"), dict) else {},
            reference_time=(
                row.get("predicted_at")
                if isinstance(row.get("predicted_at"), datetime)
                else datetime.fromisoformat(str(row["predicted_at"]).replace("Z", "+00:00"))
                if row.get("predicted_at")
                else None
            ),
        )
        for key, value in features.items():
            columns.setdefault(key, []).append(float(value))
    return columns


def _compute_brier(predictions: list[float], outcomes: list[float]) -> float | None:
    if not predictions or len(predictions) != len(outcomes):
        return None
    total = 0.0
    for prediction, outcome in zip(predictions, outcomes):
        total += (float(prediction) - float(outcome)) ** 2
    return total / len(predictions)


def _compute_mae(predictions: list[float], outcomes: list[float]) -> float | None:
    if not predictions or len(predictions) != len(outcomes):
        return None
    total = 0.0
    for prediction, outcome in zip(predictions, outcomes):
        total += abs(float(prediction) - float(outcome))
    return total / len(predictions)


def _compute_auc(predictions: list[float], outcomes: list[float]) -> float | None:
    try:
        from sklearn.metrics import roc_auc_score

        if len(set(int(float(value) >= 0.5) for value in outcomes)) < 2:
            return None
        return float(roc_auc_score(outcomes, predictions))
    except Exception:
        return None


def _evaluate_candidate_release(
    model: TrainedProbabilityModel,
    rows: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], str]:
    candidate_predictions: list[float] = []
    baseline_predictions: list[float] = []
    outcomes: list[float] = []

    predicted_at_values: list[datetime] = []
    outcome_at_values: list[datetime] = []

    for row in rows:
        features = build_invoice_feature_map(
            row.get("state") if isinstance(row.get("state"), dict) else {},
            row.get("estimated") if isinstance(row.get("estimated"), dict) else {},
            reference_time=(
                row.get("predicted_at")
                if isinstance(row.get("predicted_at"), datetime)
                else datetime.fromisoformat(str(row["predicted_at"]).replace("Z", "+00:00"))
                if row.get("predicted_at")
                else None
            ),
        )
        candidate_prediction = predict_with_trained_model(model, features)
        candidate_predictions.append(float(candidate_prediction["value"]))
        baseline_predictions.append(float(row.get("predicted_value") or 0.0))
        outcomes.append(float(row.get("outcome_value") or 0.0))

        if row.get("predicted_at"):
            predicted_at_values.append(
                row["predicted_at"]
                if isinstance(row["predicted_at"], datetime)
                else datetime.fromisoformat(str(row["predicted_at"]).replace("Z", "+00:00"))
            )
        if row.get("outcome_at"):
            outcome_at_values.append(
                row["outcome_at"]
                if isinstance(row["outcome_at"], datetime)
                else datetime.fromisoformat(str(row["outcome_at"]).replace("Z", "+00:00"))
            )

    candidate_brier = _compute_brier(candidate_predictions, outcomes)
    baseline_brier = _compute_brier(baseline_predictions, outcomes)
    candidate_mae = _compute_mae(candidate_predictions, outcomes)
    baseline_mae = _compute_mae(baseline_predictions, outcomes)
    candidate_auc = _compute_auc(candidate_predictions, outcomes)
    baseline_auc = _compute_auc(baseline_predictions, outcomes)

    improvement = None
    if candidate_brier is not None and baseline_brier is not None:
        improvement = baseline_brier - candidate_brier

    if improvement is None:
        status = "candidate"
    elif improvement >= 0.01:
        status = "approved"
    elif improvement <= -0.01:
        status = "rejected"
    else:
        status = "candidate"

    baseline_comparison = {
        "baseline_model_id": "rule_inference",
        "baseline_brier_score": baseline_brier,
        "candidate_brier_score": candidate_brier,
        "brier_improvement": improvement,
        "baseline_mae": baseline_mae,
        "candidate_mae": candidate_mae,
        "baseline_roc_auc": baseline_auc,
        "candidate_roc_auc": candidate_auc,
    }
    replay_report = {
        "schemaVersion": "world.model-replay.v1",
        "rowsEvaluated": len(rows),
        "candidateModelId": model.model_id,
        "baselineModelId": "rule_inference",
        "evaluatedAt": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "candidate": {
                "brierScore": candidate_brier,
                "meanAbsoluteError": candidate_mae,
                "rocAuc": candidate_auc,
            },
            "baseline": {
                "brierScore": baseline_brier,
                "meanAbsoluteError": baseline_mae,
                "rocAuc": baseline_auc,
            },
        },
    }
    training_window = {
        "predictedAtStart": min(predicted_at_values).isoformat() if predicted_at_values else None,
        "predictedAtEnd": max(predicted_at_values).isoformat() if predicted_at_values else None,
        "outcomeAtStart": min(outcome_at_values).isoformat() if outcome_at_values else None,
        "outcomeAtEnd": max(outcome_at_values).isoformat() if outcome_at_values else None,
    }
    return baseline_comparison, replay_report, training_window, status


async def _train_cached_model(
    pool,
    *,
    prediction_type: str,
    tenant_id: str | None,
    scope: str,
    force: bool = False,
) -> TrainedProbabilityModel | None:
    cache_key = _cache_key(scope, prediction_type, tenant_id)
    latest_release = await get_latest_model_release(pool, prediction_type, scope, tenant_id)
    if (
        not force
        and cache_key in _trained_models
        and latest_release is not None
        and _trained_models[cache_key].release_id == latest_release["release_id"]
    ):
        return _trained_models[cache_key]

    rows = await get_prediction_training_rows(pool, prediction_type, tenant_id)
    min_rows = MIN_TENANT_TRAINING_ROWS if scope == "tenant" else MIN_GLOBAL_TRAINING_ROWS
    if len(rows) < min_rows:
        return None

    model = fit_probability_model(
        rows,
        prediction_type=prediction_type,
        tenant_id=tenant_id,
        scope=scope,
    )
    if model is None:
        return None
    distribution_monitor.fit(
        tenant_id or "global",
        prediction_type,
        _feature_matrix_from_rows(rows),
    )
    training_pairs = []
    for row in rows:
        features = build_invoice_feature_map(
            row.get("state") if isinstance(row.get("state"), dict) else {},
            row.get("estimated") if isinstance(row.get("estimated"), dict) else {},
            reference_time=(
                row.get("predicted_at")
                if isinstance(row.get("predicted_at"), datetime)
                else datetime.fromisoformat(str(row["predicted_at"]).replace("Z", "+00:00"))
                if row.get("predicted_at")
                else None
            ),
        )
        prediction = predict_with_trained_model(model, features)
        training_pairs.append((prediction["value"], float(row.get("outcome_value") or 0.0)))
    drift_monitor.rebuild_from_pairs(model.model_id, prediction_type, tenant_id or "global", training_pairs)

    if not force and latest_release is not None:
        model.release_id = str(latest_release["release_id"])
        model.release_status = str(latest_release["status"])
        model.metadata = {
            **model.metadata,
            "baseline_comparison": latest_release.get("baseline_comparison") or {},
            "replay_report": latest_release.get("replay_report") or {},
        }
        _trained_models[cache_key] = model
        return model

    baseline_comparison, replay_report, training_window, release_status = _evaluate_candidate_release(model, rows)
    release_id = f"release_{uuid4().hex}"
    await insert_model_release(
        pool,
        {
            "release_id": release_id,
            "model_id": model.model_id,
            "prediction_type": prediction_type,
            "scope": scope,
            "tenant_id": tenant_id,
            "status": release_status,
            "trained_at": model.trained_at,
            "sample_count": model.sample_count,
            "positive_rate": model.positive_rate,
            "brier_score": model.brier_score,
            "roc_auc": model.roc_auc,
            "calibration_method": model.calibrator["method"] if model.calibrator else "none",
            "feature_manifest": model.feature_names,
            "training_window": training_window,
            "baseline_model_id": "rule_inference",
            "baseline_comparison": baseline_comparison,
            "replay_report": replay_report,
            "metadata": model.metadata,
        },
    )
    model.release_id = release_id
    model.release_status = release_status
    model.metadata = {
        **model.metadata,
        "baseline_comparison": baseline_comparison,
        "replay_report": replay_report,
    }
    if release_status == "approved" or cache_key not in _trained_models:
        _trained_models[cache_key] = model
    return model


async def _select_model(pool, tenant_id: str, prediction_type: str) -> tuple[TrainedProbabilityModel | None, str | None]:
    if prediction_type not in ELIGIBLE_LEARNED_PREDICTIONS:
        return None, "prediction_type_not_enabled"
    tenant_block_reason: str | None = None
    tenant_model = await _train_cached_model(
        pool,
        prediction_type=prediction_type,
        tenant_id=tenant_id,
        scope="tenant",
    )
    tenant_release = await get_latest_model_release(pool, prediction_type, "tenant", tenant_id)
    if tenant_model is not None and tenant_release is not None and tenant_release.get("status") == "approved":
        tenant_model.release_id = str(tenant_release["release_id"])
        tenant_model.release_status = str(tenant_release["status"])
        return tenant_model, None
    if tenant_release is not None and tenant_release.get("status") != "approved":
        tenant_block_reason = f"tenant_release_{tenant_release.get('status')}"

    global_model = await _train_cached_model(
        pool,
        prediction_type=prediction_type,
        tenant_id=None,
        scope="global",
    )
    global_release = await get_latest_model_release(pool, prediction_type, "global", None)
    if global_model is not None and global_release is not None and global_release.get("status") == "approved":
        global_model.release_id = str(global_release["release_id"])
        global_model.release_status = str(global_release["status"])
        return global_model, tenant_block_reason or "tenant_data_insufficient"
    if global_release is not None and global_release.get("status") != "approved":
        return None, tenant_block_reason or f"global_release_{global_release.get('status')}"

    return None, tenant_block_reason or "insufficient_training_data"


async def _train_intervention_model(
    pool,
    *,
    tenant_id: str,
    action_class: str,
    object_type: str,
    field: str,
    force: bool = False,
) -> TrainedInterventionModel | None:
    cache_key = _intervention_cache_key(tenant_id, action_class, object_type, field)
    if not force and cache_key in _intervention_models:
        return _intervention_models[cache_key]

    rows = await get_intervention_training_rows(pool, tenant_id, action_class, object_type, field)
    if len(rows) < MIN_INTERVENTION_TRAINING_ROWS:
        return None

    model = fit_intervention_effect_model(
        rows,
        tenant_id=tenant_id,
        action_class=action_class,
        object_type=object_type,
        field=field,
    )
    if model is None:
        return None

    _intervention_models[cache_key] = model
    return model


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield
    await close_pool()


app = FastAPI(title="Nooterra ML Sidecar", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    pool = await get_pool()
    monitor_count = len(drift_monitor._monitors)
    stale_monitors = 0
    now = datetime.now(timezone.utc)
    for key, ts in drift_monitor._last_checked.items():
        checked = datetime.fromisoformat(ts)
        if (now - checked).total_seconds() > 3600:
            stale_monitors += 1

    return {
        "status": "ok",
        "db_connected": pool is not None,
        "drift_monitors_active": monitor_count,
        "drift_monitors_stale": stale_monitors,
        "calibrators_cached": len(_calibrators),
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    pool = await get_pool()
    predicted_value = float(req.features.get(req.prediction_type, 0.5))
    selection = ModelSelectionInfo(
        strategy="fallback_rule",
        chosen_model_id="rule_inference",
        baseline_model_id="rule_inference",
        fallback_reason=None,
        training_samples=0,
        scope="rule",
    )
    chosen_model_id = "rule_inference"
    learned_model: TrainedProbabilityModel | None = None

    if pool:
        learned_model, fallback_reason = await _select_model(pool, req.tenant_id, req.prediction_type)
        if learned_model is not None:
            learned_prediction = predict_with_trained_model(learned_model, req.features)
            predicted_value = float(learned_prediction["value"])
            chosen_model_id = learned_model.model_id
            latest_release = await get_latest_model_release(
                pool,
                req.prediction_type,
                learned_model.scope,
                req.tenant_id if learned_model.scope == "tenant" else None,
            )
            selection = ModelSelectionInfo(
                strategy="trained_probability_model",
                chosen_model_id=learned_model.model_id,
                baseline_model_id="rule_inference",
                fallback_reason=fallback_reason,
                training_samples=learned_model.sample_count,
                scope=learned_model.scope,
                release_id=str(latest_release["release_id"]) if latest_release is not None else learned_model.release_id,
                release_status=str(latest_release["status"]) if latest_release is not None else learned_model.release_status,
                brier_improvement=(
                    float((latest_release.get("baseline_comparison") or {}).get("brier_improvement"))
                    if latest_release is not None and (latest_release.get("baseline_comparison") or {}).get("brier_improvement") is not None
                    else None
                ),
            )
        else:
            selection.fallback_reason = fallback_reason

    # --- Calibration ---
    cal_key = f"{req.tenant_id}:{req.prediction_type}:{chosen_model_id}"
    calibrator = _calibrators.get(cal_key)
    cal_info = CalibrationInfo(score=0.5, method="none", ece=1.0, n_outcomes=0)

    if learned_model is not None:
        if learned_model.calibrator is not None:
            calibrator = learned_model.calibrator
            cal_info = CalibrationInfo(
                score=max(0, 1 - calibrator["ece_after"]),
                method=calibrator["method"],
                ece=calibrator["ece_after"],
                n_outcomes=learned_model.sample_count,
            )
        else:
            cal_info = CalibrationInfo(
                score=max(0, 1 - (learned_model.brier_score or 0.5)),
                method="training_residuals",
                ece=learned_model.brier_score or 0.5,
                n_outcomes=learned_model.sample_count,
            )
    elif pool:
        pairs = await get_prediction_outcome_pairs(pool, req.tenant_id, req.prediction_type)
        if len(pairs) >= 10:
            predictions_list = [p for p, _ in pairs]
            outcomes_list = [o for _, o in pairs]

            if calibrator is None:
                calibrator = fit_best_calibrator(predictions_list, outcomes_list)
                _calibrators[cal_key] = calibrator

            predicted_value = calibrate(predicted_value, calibrator)
            cal_info = CalibrationInfo(
                score=max(0, 1 - calibrator["ece_after"]),
                method=calibrator["method"],
                ece=calibrator["ece_after"],
                n_outcomes=len(pairs),
            )
        else:
            cal_info = CalibrationInfo(
                score=0.5, method="insufficient_data", ece=1.0, n_outcomes=len(pairs),
            )

    # --- Conformal intervals ---
    interval = ConfidenceInterval(
        lower=max(0, predicted_value - 0.2),
        upper=min(1, predicted_value + 0.2),
        coverage=0.90,
    )
    if learned_model is not None:
        prediction = predict_with_trained_model(learned_model, req.features)
        interval = ConfidenceInterval(
            lower=prediction["interval"]["lower"],
            upper=prediction["interval"]["upper"],
            coverage=prediction["interval"]["coverage"],
        )
    elif pool:
        pairs = await get_prediction_outcome_pairs(pool, req.tenant_id, req.prediction_type)
        if len(pairs) >= 5:
            residuals = [p - o for p, o in pairs]
            interval_dict = compute_intervals_from_residuals(residuals, predicted_value, coverage=0.90)
            interval = ConfidenceInterval(
                lower=interval_dict["lower"],
                upper=interval_dict["upper"],
                coverage=interval_dict["coverage"],
            )

    # --- Drift ---
    drift_tenant = req.tenant_id if learned_model is None or learned_model.scope == "tenant" else "global"
    drift_status = drift_monitor.get_status(chosen_model_id, req.prediction_type, drift_tenant)
    drift_info = DriftInfo(
        detected=drift_status["drift_detected"],
        adwin_value=drift_status["adwin_value"],
    )

    # --- OOD ---
    ood_scope = req.tenant_id if learned_model is None or learned_model.scope == "tenant" else "global"
    ood_result = distribution_monitor.check(ood_scope, req.prediction_type, req.features)
    ood_info = OodInfo(
        in_distribution=ood_result["in_distribution"],
        kl_divergence=ood_result["kl_divergence"],
    )

    # --- Confidence ---
    confidence = cal_info.score
    if drift_info.detected:
        confidence *= 0.5
    if not ood_info.in_distribution:
        confidence *= 0.5

    return PredictResponse(
        value=predicted_value,
        confidence=round(confidence, 4),
        interval=interval,
        model_id=chosen_model_id,
        calibration=cal_info,
        drift=drift_info,
        ood=ood_info,
        selection=selection,
    )


@app.post("/predict/v2")
async def predict_v2(request: Request):
    """Enhanced prediction with auto-built full feature vector.

    Instead of receiving pre-built features, this endpoint takes tenant_id +
    object_id and builds the 34-feature vector from the current world model
    state, including tenant stats, trajectory, and event counts.
    """
    body = await request.json()
    tenant_id = body.get("tenant_id")
    object_id = body.get("object_id")
    prediction_type = body.get("prediction_type", "paymentProbability7d")

    if not tenant_id or not object_id:
        return JSONResponse({"error": "tenant_id and object_id required"}, status_code=400)

    pool = await get_pool()
    if not pool:
        return JSONResponse({"error": "no_db"}, status_code=503)

    # Load current object state
    from .db import get_object_state_at
    obj = await get_object_state_at(pool, tenant_id, object_id, datetime.now(timezone.utc).isoformat())
    if obj is None:
        return JSONResponse({"error": "object_not_found"}, status_code=404)

    state = obj["state"]
    estimated = obj["estimated"]

    # Resolve party for trajectory
    party_id = await get_party_id_for_invoice(pool, tenant_id, object_id)

    # Build full feature vector with all 4 families
    tenant_stats = await load_tenant_stats_with_customer(pool, tenant_id, party_id)
    event_counts = await get_event_counts_for_object(pool, tenant_id, object_id)
    trajectory = None
    if party_id:
        trajectory = await load_customer_trajectory(pool, tenant_id, party_id)

    features = build_full_feature_vector(
        state,
        estimated,
        tenant_stats=tenant_stats,
        event_counts=event_counts,
        trajectory=trajectory,
    )

    # Try CatBoost first (has SHAP), then logistic regression, then rule fallback
    from .features import compute_feature_hash as _compute_fh
    feature_hash = _compute_fh(features)

    predicted_value = float(features.get(prediction_type, 0.5))
    chosen_model_id = "rule_inference"
    shap_reasons: list[dict] = []
    interval = {"lower": max(0, predicted_value - 0.2), "upper": min(1, predicted_value + 0.2), "coverage": 0.90}
    model_family = "rule_inference"

    # Hierarchical model selection: tenant → segment → global → logistic → rules
    # 1. Try tenant-specific CatBoost
    cb_key = _cache_key("tenant", prediction_type, tenant_id)
    catboost_model = _catboost_models.get(cb_key)

    # 2. Try segment CatBoost if no tenant model
    if catboost_model is None and pool and tenant_id:
        segment_id = await get_tenant_segment(pool, tenant_id)
        if segment_id:
            seg_key = _cache_key("segment", prediction_type, segment_id)
            catboost_model = _catboost_models.get(seg_key)
            if catboost_model:
                model_family = "catboost_segment"

    # 3. Try global CatBoost
    if catboost_model is None:
        global_key = _cache_key("global", prediction_type, None)
        catboost_model = _catboost_models.get(global_key)
        if catboost_model:
            model_family = "catboost_global"

    if catboost_model is not None:
        cb_result = predict_catboost(catboost_model, features)
        predicted_value = cb_result["value"]
        interval = cb_result["interval"]
        shap_reasons = cb_result.get("shap_reasons", [])
        chosen_model_id = catboost_model.model_id
        if model_family == "rule_inference":
            model_family = "catboost"
    else:
        # 4. Try logistic regression
        learned_model, _ = await _select_model(pool, tenant_id, prediction_type)
        if learned_model is not None:
            learned_prediction = predict_with_trained_model(learned_model, features)
            predicted_value = float(learned_prediction["value"])
            interval = learned_prediction["interval"]
            chosen_model_id = learned_model.model_id
            model_family = "logistic_regression"

    # Survival prediction (time-to-pay)
    surv_key = f"tenant:{tenant_id}:survival"
    surv_model = _survival_models.get(surv_key) or _survival_models.get("global:global:survival")
    survival_info = None
    if surv_model is not None:
        sp = predict_survival(surv_model, features)
        survival_info = {
            "median_days_to_pay": sp.median_days_to_pay,
            "survival_7d": sp.survival_7d,
            "survival_30d": sp.survival_30d,
            "survival_90d": sp.survival_90d,
            "hazard_ratio": sp.hazard_ratio,
        }

    # Drift + OOD
    drift_scope = tenant_id if model_family == "rule_inference" else "global"
    drift_status = drift_monitor.get_status(chosen_model_id, prediction_type, drift_scope)
    ood_result = distribution_monitor.check(drift_scope, prediction_type, features)

    confidence = 0.6 if model_family == "rule_inference" else 0.75
    if model_family == "catboost" and catboost_model and catboost_model.calibrator:
        confidence = max(0, 1 - catboost_model.calibrator["ece_after"])
    if drift_status["drift_detected"]:
        confidence *= 0.5
    if not ood_result["in_distribution"]:
        confidence *= 0.5

    return JSONResponse({
        "value": round(predicted_value, 6),
        "confidence": round(confidence, 4),
        "interval": interval,
        "model_id": chosen_model_id,
        "model_family": model_family,
        "feature_count": len(features),
        "feature_hash": feature_hash,
        "shap_reasons": shap_reasons,
        "survival": survival_info,
        "drift_detected": drift_status["drift_detected"],
        "in_distribution": ood_result["in_distribution"],
        "tenant_stats_available": tenant_stats is not None and tenant_stats.get("invoice_count", 0) > 0,
        "trajectory_available": trajectory is not None and trajectory.get("invoices_paid_count", 0) > 0,
    })


@app.post("/interventions/estimate", response_model=InterventionEstimateResponse)
async def estimate_intervention(req: InterventionEstimateRequest):
    pool = await get_pool()
    if pool is None:
        return InterventionEstimateResponse(
            object_id=req.object_id,
            action_class=req.action_class,
            object_type=req.object_type,
            model_id="intervention_rule_fallback",
            model_type="fallback_rule",
            sample_count=0,
            evidence_strength=0.0,
            estimates=[],
        )

    estimates: list[InterventionEstimate] = []
    sample_count = 0
    evidence_strength = 0.0
    comparative_evidence_strength = 0.0
    model_ids: set[str] = set()
    comparative_estimates = 0

    for effect in req.effects:
        model = await _train_intervention_model(
            pool,
            tenant_id=req.tenant_id,
            action_class=req.action_class,
            object_type=req.object_type,
            field=effect.field,
        )
        if model is None:
            continue

        comparative_rows = await get_intervention_comparison_rows(
            pool,
            req.tenant_id,
            req.object_type,
            effect.field,
        )
        comparative_summary = summarize_comparative_treatment(
            comparative_rows,
            action_class=req.action_class,
        )

        prediction = predict_with_intervention_model(
            model,
            req.state,
            req.estimated,
            current_value=effect.current_value,
            predicted_value=effect.predicted_value,
            confidence=effect.confidence,
        )
        quality_score = float(prediction["quality_score"])
        if model.sample_count < MIN_INTERVENTION_TRAINING_ROWS or quality_score < 0.45:
            continue

        next_value = float(prediction["predicted_value"])
        predicted_confidence = float(prediction["confidence"])
        baseline_action_class = None
        comparative_lift = None
        comparative_quality_score = None
        comparative_sample_count = 0
        comparative_winner = None

        if comparative_summary is not None and comparative_summary.quality_score >= 0.45:
            comparative_weight = min(0.35, comparative_summary.quality_score * 0.35)
            next_value = float(next_value + (comparative_summary.treatment_lift * comparative_weight))
            predicted_confidence = float(np.clip(
                (predicted_confidence * 0.8) + (comparative_summary.quality_score * 0.2),
                0.15,
                0.99,
            ))
            baseline_action_class = comparative_summary.baseline_action_class
            comparative_lift = float(comparative_summary.treatment_lift)
            comparative_quality_score = float(comparative_summary.quality_score)
            comparative_sample_count = int(
                comparative_summary.chosen_sample_count + comparative_summary.baseline_sample_count
            )
            comparative_winner = bool(comparative_summary.comparative_winner)
            comparative_estimates += 1
            comparative_evidence_strength = max(
                comparative_evidence_strength,
                float(comparative_summary.evidence_strength),
            )

        sample_count += model.sample_count
        evidence_strength = max(evidence_strength, float(prediction["evidence_strength"]))
        model_ids.add(model.model_id)
        estimates.append(
            InterventionEstimate(
                field=effect.field,
                current_value=effect.current_value,
                predicted_value=next_value,
                confidence=predicted_confidence,
                label=effect.label,
                model_id=model.model_id,
                sample_count=model.sample_count,
                quality_score=quality_score,
                evidence_strength=float(prediction["evidence_strength"]),
                baseline_action_class=baseline_action_class,
                comparative_lift=comparative_lift,
                comparative_quality_score=comparative_quality_score,
                comparative_sample_count=comparative_sample_count,
                comparative_winner=comparative_winner,
            )
        )

    return InterventionEstimateResponse(
        object_id=req.object_id,
        action_class=req.action_class,
        object_type=req.object_type,
        model_id=next(iter(sorted(model_ids)), "intervention_rule_fallback"),
        model_type="comparative_treatment_effect" if comparative_estimates > 0 else ("intervention_regression" if estimates else "fallback_rule"),
        sample_count=sample_count,
        evidence_strength=round(evidence_strength, 4),
        comparative_evidence_strength=round(comparative_evidence_strength, 4),
        estimates=estimates,
    )


@app.post("/calibrate", response_model=CalibrateResponse)
async def calibrate_endpoint(req: CalibrateRequest):
    pool = await get_pool()
    if not pool:
        return CalibrateResponse(
            method="no_db", ece_before=1.0, ece_after=1.0, n_samples=0, temperature=None,
        )

    pairs = await get_prediction_outcome_pairs(pool, req.tenant_id, req.prediction_type)
    if len(pairs) < 10:
        return CalibrateResponse(
            method="insufficient_data", ece_before=1.0, ece_after=1.0,
            n_samples=len(pairs), temperature=None,
        )

    predictions_list = [p for p, _ in pairs]
    outcomes_list = [o for _, o in pairs]

    result = fit_best_calibrator(predictions_list, outcomes_list)

    # Cache the calibrator
    cal_key = f"{req.tenant_id}:{req.prediction_type}"
    _calibrators[cal_key] = result

    return CalibrateResponse(
        method=result["method"],
        ece_before=round(result["ece_before"], 4),
        ece_after=round(result["ece_after"], 4),
        n_samples=result["n_samples"],
        temperature=result.get("temperature"),
    )


@app.get("/drift/{tenant_id}", response_model=DriftResponse)
async def drift(tenant_id: str):
    pool = await get_pool()
    if pool:
        statuses = await check_all_models(pool, tenant_id)
        return DriftResponse(
            models=[
                DriftStatus(
                    model_id=s["model_id"],
                    prediction_type=s["prediction_type"],
                    drift_detected=s["drift_detected"],
                    adwin_value=s["adwin_value"],
                    last_checked=datetime.fromisoformat(s["last_checked"]),
                )
                for s in statuses
            ]
        )

    return DriftResponse(models=[])


@app.post("/train", response_model=TrainResponse)
async def train(req: TrainRequest):
    pool = await get_pool()
    if not pool:
        return TrainResponse(
            status="no_db",
            prediction_type=req.prediction_type,
            tenant_id=req.tenant_id,
            details={"reason": "DATABASE_URL not configured"},
        )

    scope = "tenant" if req.tenant_id else "global"
    model = await _train_cached_model(
        pool,
        prediction_type=req.prediction_type,
        tenant_id=req.tenant_id,
        scope=scope,
        force=req.force,
    )
    if model is None:
        return TrainResponse(
            status="insufficient_data",
            prediction_type=req.prediction_type,
            tenant_id=req.tenant_id,
            scope=scope,
            details={"minimum_samples": MIN_TENANT_TRAINING_ROWS if scope == "tenant" else MIN_GLOBAL_TRAINING_ROWS},
        )

    latest_release = await get_latest_model_release(pool, req.prediction_type, scope, req.tenant_id)

    return TrainResponse(
        status="trained" if latest_release is not None else "trained_untracked",
        prediction_type=req.prediction_type,
        tenant_id=req.tenant_id,
        model_id=model.model_id,
        release_id=str(latest_release["release_id"]) if latest_release is not None else model.release_id,
        release_status=str(latest_release["status"]) if latest_release is not None else model.release_status,
        sample_count=model.sample_count,
        scope=model.scope,
        details={
            "trained_at": model.trained_at,
            "positive_rate": model.positive_rate,
            "brier_score": model.brier_score,
            "roc_auc": model.roc_auc,
            "baseline_comparison": latest_release.get("baseline_comparison") if latest_release is not None else model.metadata.get("baseline_comparison"),
            "replay_report": latest_release.get("replay_report") if latest_release is not None else model.metadata.get("replay_report"),
        },
    )


@app.get("/models/releases", response_model=ModelReleaseResponse)
async def model_releases():
    pool = await get_pool()
    if not pool:
        return ModelReleaseResponse(releases=[])

    releases = [
        ModelRelease(
            release_id=str(release["release_id"]),
            model_id=str(release["model_id"]),
            prediction_type=str(release["prediction_type"]),
            scope=str(release["scope"]),
            tenant_id=release.get("tenant_id"),
            status=str(release["status"]),
            trained_at=release["trained_at"] if isinstance(release["trained_at"], datetime) else datetime.fromisoformat(str(release["trained_at"]).replace("Z", "+00:00")),
            sample_count=int(release["sample_count"]),
            positive_rate=float(release["positive_rate"]),
            brier_score=float(release["brier_score"]) if release.get("brier_score") is not None else None,
            roc_auc=float(release["roc_auc"]) if release.get("roc_auc") is not None else None,
            baseline_model_id=str(release.get("baseline_model_id", "rule_inference")),
            calibration_method=str(release.get("calibration_method", "none")),
            feature_manifest=[str(item) for item in (release.get("feature_manifest") or [])],
            training_window=release.get("training_window") or {},
            baseline_comparison=release.get("baseline_comparison") or {},
            replay_report=release.get("replay_report") or {},
            metadata=release.get("metadata") or {},
        )
        for release in await list_model_releases(pool)
    ]
    return ModelReleaseResponse(releases=releases)


@app.post("/graded-outcomes")
async def ingest_graded_outcomes(request: Request):
    """Ingest graded action-outcome pairs for uplift model training."""
    body = await request.json()
    outcomes = body.get("outcomes", [])
    tenant_id = body.get("tenant_id")

    if not tenant_id or not outcomes:
        return JSONResponse({"stored": 0}, status_code=200)

    pool = await get_pool()
    if pool is None:
        return JSONResponse({"stored": 0}, status_code=200)

    stored = 0
    errors = 0
    for outcome in outcomes:
        action_id = outcome.get("actionId")
        if not action_id:
            errors += 1
            print(f"[graded-outcomes] skipping outcome without actionId for tenant {tenant_id}")
            continue
        try:
            await pool.execute(
                """INSERT INTO training_examples
                   (tenant_id, example_type, object_id, features, label, metadata, created_at)
                   VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)
                   ON CONFLICT DO NOTHING""",
                tenant_id,
                "graded_outcome",
                outcome.get("targetObjectId"),
                json.dumps({
                    "action_id": action_id,
                    "action_class": outcome.get("actionClass"),
                    "decision_type": outcome.get("decisionType"),
                    "variant_id": outcome.get("variantId"),
                    "invoice_amount_cents": outcome.get("invoiceAmountCents", 0),
                    "days_overdue": outcome.get("daysOverdueAtAction", 0),
                    "predicted_payment_prob": outcome.get("predictedPaymentProb7d"),
                }),
                outcome.get("objectiveScore"),
                json.dumps({
                    "delta_expected": outcome.get("deltaExpected"),
                    "delta_observed": outcome.get("deltaObserved"),
                    "effect_matched": outcome.get("effectMatched"),
                    "objective_achieved": outcome.get("objectiveAchieved"),
                    "action_at": outcome.get("actionAt"),
                    "observed_at": outcome.get("observedAt"),
                }),
                outcome.get("actionAt"),
            )
            stored += 1
        except Exception as e:
            errors += 1
            import traceback
            traceback.print_exc()

    return JSONResponse({"stored": stored, "errors": errors})


@app.post("/uplift/train")
async def train_uplift(request: Request):
    """Train an uplift model from graded outcomes."""
    body = await request.json()
    tenant_id = body.get("tenant_id")
    action_class = body.get("action_class", "communicate.email")
    outcomes = body.get("outcomes", [])

    if not tenant_id or len(outcomes) < 30:
        return JSONResponse({"status": "insufficient_data", "model_id": None}, status_code=200)

    model = fit_uplift_model(
        outcomes,
        tenant_id=tenant_id,
        action_class=action_class,
    )

    if model is None:
        return JSONResponse({"status": "insufficient_data", "model_id": None}, status_code=200)

    cache_key = f"{tenant_id}:{action_class}"
    _uplift_models[cache_key] = model

    return JSONResponse({
        "status": "trained",
        "model_id": model.model_id,
        "treatment_samples": model.treatment_sample_count,
        "control_samples": model.control_sample_count,
        "observed_lift": model.observed_lift,
        "treatment_positive_rate": model.treatment_positive_rate,
        "control_positive_rate": model.control_positive_rate,
    })


@app.post("/uplift/predict")
async def predict_uplift_endpoint(request: Request):
    """Predict uplift for a single observation."""
    body = await request.json()
    tenant_id = body.get("tenant_id")
    action_class = body.get("action_class", "communicate.email")
    features = body.get("features", {})

    cache_key = f"{tenant_id}:{action_class}"
    model = _uplift_models.get(cache_key)

    if model is None:
        return JSONResponse({"error": "no_model", "lift": None}, status_code=200)

    result = predict_uplift(model, features)
    return JSONResponse(result)


# ---------------------------------------------------------------------------
# Bandit endpoints — IPS estimation and exploration rates
# ---------------------------------------------------------------------------


@app.post("/bandit/ips")
async def bandit_ips_endpoint(request: Request):
    """Compute inverse-propensity-weighted reward estimates per action class."""
    body = await request.json()
    tenant_id = body.get("tenant_id")
    if not tenant_id:
        return JSONResponse({"error": "tenant_id required"}, status_code=400)

    pool = await get_pool()
    if not pool:
        return JSONResponse({"error": "no_db"}, status_code=503)

    from .bandit import load_decision_outcomes, compute_ips_estimates
    decisions = await load_decision_outcomes(pool, tenant_id)
    results = compute_ips_estimates(decisions)
    results["tenant_id"] = tenant_id
    return JSONResponse(results)


@app.get("/bandit/exploration-rate/{tenant_id}")
async def bandit_exploration_rate(tenant_id: str):
    """Get the current exploration rate for a tenant."""
    pool = await get_pool()
    if not pool:
        return JSONResponse({"exploration_rate": 0.10, "source": "default"})

    from .bandit import load_decision_outcomes, compute_ips_estimates, compute_exploration_rate
    decisions = await load_decision_outcomes(pool, tenant_id, min_age_days=7, limit=1000)
    ips = compute_ips_estimates(decisions)
    rate = compute_exploration_rate(ips)
    return JSONResponse({
        "exploration_rate": round(rate, 4),
        "effective_samples": sum(
            e["effective_sample_size"]
            for e in ips.get("action_estimates", {}).values()
        ),
        "resolved_decisions": ips.get("resolved_decisions", 0),
        "source": "ips_decay",
    })


# ---------------------------------------------------------------------------
# Survival endpoints
# ---------------------------------------------------------------------------


@app.post("/survival/predict")
async def survival_predict_endpoint(request: Request):
    """Predict time-to-pay survival function for an invoice."""
    body = await request.json()
    tenant_id = body.get("tenant_id")
    features = body.get("features", {})

    if not tenant_id:
        return JSONResponse({"error": "tenant_id required"}, status_code=400)

    # Try tenant model, fall back to global
    surv_key = f"tenant:{tenant_id}:survival"
    model = _survival_models.get(surv_key)
    if model is None:
        model = _survival_models.get("global:global:survival")

    if model is None:
        return JSONResponse({
            "error": "no_survival_model",
            "median_days_to_pay": None,
            "survival_7d": None,
            "survival_30d": None,
            "survival_90d": None,
        })

    prediction = predict_survival(model, features)
    return JSONResponse({
        "median_days_to_pay": prediction.median_days_to_pay,
        "survival_7d": prediction.survival_7d,
        "survival_30d": prediction.survival_30d,
        "survival_90d": prediction.survival_90d,
        "hazard_ratio": prediction.hazard_ratio,
        "concordance": prediction.concordance,
        "model_id": model.model_id,
    })


# ---------------------------------------------------------------------------
# Epoch endpoints — decision epoch lifecycle
# ---------------------------------------------------------------------------


@app.post("/epochs/sweep")
async def epoch_sweep(request: Request):
    """Sweep open invoices for a tenant and create decision epochs."""
    body = await request.json()
    tenant_id = body.get("tenant_id")
    if not tenant_id:
        return JSONResponse({"error": "tenant_id required"}, status_code=400)

    pool = await get_pool()
    if not pool:
        return JSONResponse({"created": 0, "error": "no_db"}, status_code=200)

    created = await sweep_invoices_for_epochs(
        pool,
        tenant_id,
        tenant_stats=body.get("tenant_stats"),
        limit=body.get("limit", 200),
    )
    return JSONResponse({"created": created, "tenant_id": tenant_id})


@app.post("/epochs/resolve")
async def epoch_resolve(request: Request):
    """Resolve outcomes for epochs whose observation window has closed."""
    body = await request.json()
    tenant_id = body.get("tenant_id")

    pool = await get_pool()
    if not pool:
        return JSONResponse({"resolved": 0, "error": "no_db"}, status_code=200)

    resolved = await resolve_pending_outcomes(pool, tenant_id)
    return JSONResponse({"resolved": resolved, "tenant_id": tenant_id})


@app.post("/epochs/create")
async def epoch_create_single(request: Request):
    """Create an epoch for a single invoice (called after Stripe webhooks)."""
    body = await request.json()
    tenant_id = body.get("tenant_id")
    object_id = body.get("object_id")
    if not tenant_id or not object_id:
        return JSONResponse({"error": "tenant_id and object_id required"}, status_code=400)

    pool = await get_pool()
    if not pool:
        return JSONResponse({"created": False, "error": "no_db"}, status_code=200)

    epoch = await create_epoch_for_invoice(
        pool,
        tenant_id,
        object_id,
        tenant_stats=body.get("tenant_stats"),
        trajectory=body.get("trajectory"),
    )
    return JSONResponse({
        "created": epoch is not None,
        "epoch_id": epoch["id"] if epoch else None,
        "trigger": epoch["epoch_trigger"] if epoch else None,
    })


@app.post("/train/v2")
async def train_v2(request: Request):
    """Train a model using epoch-based training data (point-in-time correct)."""
    body = await request.json()
    tenant_id = body.get("tenant_id")
    prediction_type = body.get("prediction_type", "paymentProbability7d")
    force = body.get("force", False)

    pool = await get_pool()
    if not pool:
        return JSONResponse({"status": "no_db"}, status_code=200)

    scope = "tenant" if tenant_id else "global"
    epoch_rows = await get_epoch_training_rows(pool, tenant_id, prediction_type)

    if len(epoch_rows) < MIN_TENANT_TRAINING_ROWS:
        return JSONResponse({
            "status": "insufficient_epoch_data",
            "epoch_rows": len(epoch_rows),
            "minimum_required": MIN_TENANT_TRAINING_ROWS,
            "fallback": "use /train for legacy training",
        })

    # Try CatBoost first (needs >= 50 samples), fall back to logistic regression
    catboost_model = fit_catboost_payment_model(
        epoch_rows,
        prediction_type=prediction_type,
        tenant_id=tenant_id,
        scope=scope,
    )

    if catboost_model is not None:
        cache_key = _cache_key(scope, prediction_type, tenant_id)
        _catboost_models[cache_key] = catboost_model
        model_id = catboost_model.model_id
        model_family = "catboost"
        brier = catboost_model.brier_score
        auc = catboost_model.roc_auc
        sample_count = catboost_model.sample_count
        metadata = catboost_model.metadata
    else:
        # Fall back to logistic regression
        logreg = fit_probability_model(
            epoch_rows,
            prediction_type=prediction_type,
            tenant_id=tenant_id,
            scope=scope,
        )
        if logreg is None:
            return JSONResponse({"status": "training_failed"})

        cache_key = _cache_key(scope, prediction_type, tenant_id)
        logreg.release_id = None
        logreg.release_status = "candidate"
        _trained_models[cache_key] = logreg
        model_id = logreg.model_id
        model_family = "logistic_regression"
        brier = logreg.brier_score
        auc = logreg.roc_auc
        sample_count = logreg.sample_count
        metadata = logreg.metadata

    # Also train survival model (time-to-pay)
    survival = fit_survival_model(epoch_rows, tenant_id=tenant_id, scope=scope)
    survival_info = None
    if survival is not None:
        surv_cache_key = f"{scope}:{tenant_id or 'global'}:survival"
        _survival_models[surv_cache_key] = survival
        survival_info = {
            "model_id": survival.model_id,
            "concordance": survival.concordance,
            "median_survival_days": survival.median_survival_days,
            "sample_count": survival.sample_count,
            "event_count": survival.event_count,
            "censored_count": survival.censored_count,
        }

    # Create release record
    release_id = f"release_{uuid4().hex}"
    baseline_comparison, replay_report, training_window, release_status = _evaluate_candidate_release(
        # Create a minimal adapter for evaluation
        type("_Model", (), {
            "model_id": model_id, "feature_names": list((epoch_rows[0].get("feature_snapshot") or {}).keys()),
            "estimator": None, "calibrator": None, "residuals": [],
        })() if catboost_model is None else type("_Model", (), {
            "model_id": model_id, "feature_names": catboost_model.feature_names,
            "estimator": None, "calibrator": catboost_model.calibrator, "residuals": [],
        })(),
        epoch_rows,
    ) if catboost_model is None else ({}, {}, {}, "candidate")

    await insert_model_release(pool, {
        "release_id": release_id,
        "model_id": model_id,
        "prediction_type": prediction_type,
        "scope": scope,
        "tenant_id": tenant_id,
        "status": release_status,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "sample_count": sample_count,
        "positive_rate": 0.0,
        "brier_score": brier,
        "roc_auc": auc,
        "calibration_method": "catboost_builtin" if model_family == "catboost" else "none",
        "feature_manifest": catboost_model.feature_names if catboost_model else [],
        "training_window": training_window if isinstance(training_window, dict) else {},
        "baseline_model_id": "rule_inference",
        "baseline_comparison": baseline_comparison if isinstance(baseline_comparison, dict) else {},
        "replay_report": replay_report if isinstance(replay_report, dict) else {},
        "metadata": metadata,
    })

    return JSONResponse({
        "status": "trained",
        "source": "decision_epochs",
        "model_family": model_family,
        "model_id": model_id,
        "release_id": release_id,
        "release_status": release_status,
        "sample_count": sample_count,
        "brier_score": brier,
        "roc_auc": auc,
        "survival": survival_info,
    })
