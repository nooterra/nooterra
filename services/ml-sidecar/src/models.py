from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PredictRequest(BaseModel):
    tenant_id: str
    object_id: str
    prediction_type: str
    features: dict


class ConfidenceInterval(BaseModel):
    lower: float
    upper: float
    coverage: float


class CalibrationInfo(BaseModel):
    score: float
    method: str
    ece: float
    n_outcomes: int


class DriftInfo(BaseModel):
    detected: bool
    adwin_value: float


class OodInfo(BaseModel):
    in_distribution: bool
    kl_divergence: float


class PredictResponse(BaseModel):
    value: float
    confidence: float
    interval: ConfidenceInterval
    model_id: str
    calibration: CalibrationInfo
    drift: DriftInfo
    ood: OodInfo


class CalibrateRequest(BaseModel):
    model_id: str
    prediction_type: str
    tenant_id: str


class CalibrateResponse(BaseModel):
    method: str
    ece_before: float
    ece_after: float
    n_samples: int
    temperature: Optional[float] = None


class DriftStatus(BaseModel):
    model_id: str
    prediction_type: str
    drift_detected: bool
    adwin_value: float
    last_checked: datetime


class DriftResponse(BaseModel):
    models: list[DriftStatus]
