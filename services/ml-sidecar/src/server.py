from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI

from .calibration import compute_ece, fit_best_calibrator, calibrate
from .conformal import compute_intervals_from_residuals
from .db import close_pool, get_pool, get_prediction_outcome_pairs
from .drift import drift_monitor, check_all_models
from .models import (
    CalibrateRequest,
    CalibrateResponse,
    CalibrationInfo,
    ConfidenceInterval,
    DriftInfo,
    DriftResponse,
    DriftStatus,
    OodInfo,
    PredictRequest,
    PredictResponse,
)
from .ood import distribution_monitor

log = logging.getLogger("ml-sidecar")

# In-memory cache of fitted calibrators per (tenant, prediction_type)
_calibrators: dict[str, dict] = {}


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
    raw_value = req.features.get(req.prediction_type, 0.5)

    # --- Calibration ---
    cal_key = f"{req.tenant_id}:{req.prediction_type}"
    calibrator = _calibrators.get(cal_key)
    cal_info = CalibrationInfo(score=0.5, method="none", ece=1.0, n_outcomes=0)

    if pool:
        pairs = await get_prediction_outcome_pairs(pool, req.tenant_id, req.prediction_type)
        if len(pairs) >= 10:
            predictions_list = [p for p, _ in pairs]
            outcomes_list = [o for _, o in pairs]

            if calibrator is None:
                calibrator = fit_best_calibrator(predictions_list, outcomes_list)
                _calibrators[cal_key] = calibrator

            raw_value = calibrate(raw_value, calibrator)
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
    interval = ConfidenceInterval(lower=max(0, raw_value - 0.2), upper=min(1, raw_value + 0.2), coverage=0.90)
    if pool:
        pairs = await get_prediction_outcome_pairs(pool, req.tenant_id, req.prediction_type)
        if len(pairs) >= 5:
            residuals = [p - o for p, o in pairs]
            interval_dict = compute_intervals_from_residuals(residuals, raw_value, coverage=0.90)
            interval = ConfidenceInterval(
                lower=interval_dict["lower"],
                upper=interval_dict["upper"],
                coverage=interval_dict["coverage"],
            )

    # --- Drift ---
    drift_status = drift_monitor.get_status("rule_inference", req.prediction_type, req.tenant_id)
    drift_info = DriftInfo(
        detected=drift_status["drift_detected"],
        adwin_value=drift_status["adwin_value"],
    )

    # --- OOD ---
    ood_result = distribution_monitor.check(req.tenant_id, req.prediction_type, req.features)
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
        value=raw_value,
        confidence=round(confidence, 4),
        interval=interval,
        model_id="rule_inference",
        calibration=cal_info,
        drift=drift_info,
        ood=ood_info,
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
