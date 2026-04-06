"""Post-hoc calibration: temperature scaling + isotonic regression."""

import math
import numpy as np
from scipy.optimize import minimize_scalar
from sklearn.isotonic import IsotonicRegression


def _clamp(p: float, lo: float = 0.001, hi: float = 0.999) -> float:
    return max(lo, min(hi, p))


def _logit(p: float) -> float:
    p = _clamp(p)
    return math.log(p / (1.0 - p))


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    ex = math.exp(x)
    return ex / (1.0 + ex)


def compute_ece(predictions: list[float], outcomes: list[float], n_bins: int = 10) -> float:
    """Expected Calibration Error. 10-bin histogram.
    ECE = sum(|bin_accuracy - bin_confidence| * bin_count / total)
    """
    if len(predictions) == 0:
        return 0.0

    preds = np.array(predictions, dtype=np.float64)
    outs = np.array(outcomes, dtype=np.float64)
    total = len(preds)

    ece = 0.0
    for i in range(n_bins):
        lo = i / n_bins
        hi = (i + 1) / n_bins
        if i == n_bins - 1:
            mask = (preds >= lo) & (preds <= hi)
        else:
            mask = (preds >= lo) & (preds < hi)

        count = mask.sum()
        if count == 0:
            continue
        bin_acc = outs[mask].mean()
        bin_conf = preds[mask].mean()
        ece += abs(bin_acc - bin_conf) * count / total

    return float(ece)


def fit_temperature_scaling(predictions: list[float], outcomes: list[float]) -> float:
    """Learn scalar T that minimizes NLL. Returns T.
    calibrated = sigmoid(logit(raw) / T)
    """
    logits = np.array([_logit(p) for p in predictions])
    y = np.array(outcomes, dtype=np.float64)

    def nll(T: float) -> float:
        calibrated = np.array([_sigmoid(l / T) for l in logits])
        calibrated = np.clip(calibrated, 1e-7, 1.0 - 1e-7)
        return -np.sum(y * np.log(calibrated) + (1.0 - y) * np.log(1.0 - calibrated))

    result = minimize_scalar(nll, bounds=(0.1, 10.0), method="bounded")
    return float(result.x)


def apply_temperature(prediction: float, temperature: float) -> float:
    """Apply temperature scaling to a single prediction."""
    return _sigmoid(_logit(prediction) / temperature)


def fit_isotonic(predictions: list[float], outcomes: list[float]) -> IsotonicRegression:
    """Fit sklearn IsotonicRegression. Returns the fitted model."""
    model = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip")
    model.fit(predictions, outcomes)
    return model


def apply_isotonic(prediction: float, model: IsotonicRegression) -> float:
    """Apply isotonic calibration to a single prediction."""
    result = model.predict([prediction])
    return float(result[0])


def fit_best_calibrator(predictions: list[float], outcomes: list[float]) -> dict:
    """
    Fit both temperature scaling and isotonic regression.
    Return the one with lower ECE.

    Returns: {
        "method": "temperature" | "isotonic",
        "ece_before": float,
        "ece_after": float,
        "n_samples": int,
        "temperature": float | None,  # only if method is temperature
        "model": object  # the fitted calibrator
    }
    """
    ece_before = compute_ece(predictions, outcomes)

    # Temperature scaling
    T = fit_temperature_scaling(predictions, outcomes)
    temp_calibrated = [apply_temperature(p, T) for p in predictions]
    ece_temp = compute_ece(temp_calibrated, outcomes)

    # Isotonic regression
    iso_model = fit_isotonic(predictions, outcomes)
    iso_calibrated = [apply_isotonic(p, iso_model) for p in predictions]
    ece_iso = compute_ece(iso_calibrated, outcomes)

    if ece_temp <= ece_iso:
        return {
            "method": "temperature",
            "ece_before": ece_before,
            "ece_after": ece_temp,
            "n_samples": len(predictions),
            "temperature": T,
            "model": T,
        }
    else:
        return {
            "method": "isotonic",
            "ece_before": ece_before,
            "ece_after": ece_iso,
            "n_samples": len(predictions),
            "temperature": None,
            "model": iso_model,
        }


def calibrate(prediction: float, calibrator: dict) -> float:
    """Apply the best calibrator to a raw prediction."""
    if calibrator["method"] == "temperature":
        return apply_temperature(prediction, calibrator["model"])
    else:
        return apply_isotonic(prediction, calibrator["model"])
