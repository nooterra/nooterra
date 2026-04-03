from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI

from .db import close_pool, get_pool
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize DB pool (may be None if DATABASE_URL not set)
    await get_pool()
    yield
    # Shutdown: close pool
    await close_pool()


app = FastAPI(title="Nooterra ML Sidecar", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    from .drift import drift_monitor

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
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    # Stub: return mock response matching the API contract.
    # Real implementation will call conformal.py, calibration.py, drift.py, ood.py.
    return PredictResponse(
        value=0.34,
        confidence=0.82,
        interval=ConfidenceInterval(lower=0.22, upper=0.47, coverage=0.90),
        model_id="stub_model_v0",
        calibration=CalibrationInfo(
            score=0.78,
            method="isotonic",
            ece=0.04,
            n_outcomes=0,
        ),
        drift=DriftInfo(detected=False, adwin_value=0.0),
        ood=OodInfo(in_distribution=True, kl_divergence=0.0),
    )


@app.post("/calibrate", response_model=CalibrateResponse)
async def calibrate(req: CalibrateRequest):
    # Stub: return mock calibration result.
    # Real implementation will call calibration.py.
    return CalibrateResponse(
        method="isotonic",
        ece_before=0.12,
        ece_after=0.04,
        n_samples=0,
        temperature=None,
    )


@app.get("/drift/{tenant_id}", response_model=DriftResponse)
async def drift(tenant_id: str):
    # Stub: return empty drift status.
    # Real implementation will call drift.py.
    return DriftResponse(
        models=[
            DriftStatus(
                model_id="rule_inference",
                prediction_type="paymentProbability7d",
                drift_detected=False,
                adwin_value=0.0,
                last_checked=datetime.now(timezone.utc),
            )
        ]
    )
