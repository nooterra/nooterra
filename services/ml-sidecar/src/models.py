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


class ModelSelectionInfo(BaseModel):
    strategy: str
    chosen_model_id: str
    baseline_model_id: str
    fallback_reason: Optional[str] = None
    training_samples: int = 0
    scope: str = "rule"
    release_id: Optional[str] = None
    release_status: Optional[str] = None
    brier_improvement: Optional[float] = None


class PredictResponse(BaseModel):
    value: float
    confidence: float
    interval: ConfidenceInterval
    model_id: str
    calibration: CalibrationInfo
    drift: DriftInfo
    ood: OodInfo
    selection: ModelSelectionInfo


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


class TrainRequest(BaseModel):
    prediction_type: str
    tenant_id: Optional[str] = None
    force: bool = False


class TrainResponse(BaseModel):
    status: str
    prediction_type: str
    tenant_id: Optional[str] = None
    model_id: Optional[str] = None
    release_id: Optional[str] = None
    release_status: Optional[str] = None
    sample_count: int = 0
    scope: str = "rule"
    details: dict


class ModelRelease(BaseModel):
    release_id: str
    model_id: str
    prediction_type: str
    scope: str
    tenant_id: Optional[str] = None
    status: str
    trained_at: datetime
    sample_count: int
    positive_rate: float
    brier_score: Optional[float] = None
    roc_auc: Optional[float] = None
    baseline_model_id: str
    calibration_method: str
    feature_manifest: list[str] = []
    training_window: dict = {}
    baseline_comparison: dict = {}
    replay_report: dict = {}
    metadata: dict = {}


class ModelReleaseResponse(BaseModel):
    releases: list[ModelRelease]


class InterventionEffectInput(BaseModel):
    field: str
    current_value: float
    predicted_value: float
    confidence: float
    label: Optional[str] = None


class InterventionEstimateRequest(BaseModel):
    tenant_id: str
    object_id: str
    object_type: str
    action_class: str
    state: dict = {}
    estimated: dict = {}
    effects: list[InterventionEffectInput]


class InterventionEstimate(BaseModel):
    field: str
    current_value: float
    predicted_value: float
    confidence: float
    label: Optional[str] = None
    model_id: str
    sample_count: int
    quality_score: float
    evidence_strength: float
    baseline_action_class: Optional[str] = None
    comparative_lift: Optional[float] = None
    comparative_quality_score: Optional[float] = None
    comparative_sample_count: int = 0
    comparative_winner: Optional[bool] = None


class InterventionEstimateResponse(BaseModel):
    object_id: str
    action_class: str
    object_type: str
    model_id: str
    model_type: str
    sample_count: int
    evidence_strength: float
    comparative_evidence_strength: float = 0.0
    estimates: list[InterventionEstimate]
