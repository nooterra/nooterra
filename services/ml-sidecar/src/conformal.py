"""
Conformal prediction intervals for the ML sidecar.

Two approaches:
1. compute_intervals — MAPIE-based, fits a model on residuals
2. compute_intervals_from_residuals — pure empirical conformal (no model fitting)
"""

import numpy as np


def compute_intervals(
    predictions: list[float],
    outcomes: list[float],
    new_prediction: float,
    coverage: float = 0.90,
) -> dict:
    """
    Given historical (predicted, outcome) pairs and a new prediction,
    return a prediction interval with guaranteed coverage.

    Uses MAPIE MapieRegressor with a linear base estimator to learn the
    error distribution from residuals, then produces a conformal interval
    for the new prediction.

    Falls back to +/- 2*MAE when fewer than 20 data points are available.

    Returns: {"lower": float, "upper": float, "coverage": float}
    """
    preds = np.asarray(predictions, dtype=np.float64)
    outs = np.asarray(outcomes, dtype=np.float64)

    if len(preds) != len(outs):
        raise ValueError("predictions and outcomes must have the same length")

    # --- Fallback for small samples ---
    if len(preds) < 20:
        mae = np.mean(np.abs(preds - outs)) if len(preds) > 0 else 0.5
        margin = 2.0 * mae
        lower = float(np.clip(new_prediction - margin, 0.0, 1.0))
        upper = float(np.clip(new_prediction + margin, 0.0, 1.0))
        return {"lower": lower, "upper": upper, "coverage": coverage}

    # --- MAPIE-based conformal interval ---
    from mapie.regression import CrossConformalRegressor
    from sklearn.linear_model import LinearRegression

    # Feature: the raw prediction. Target: the actual outcome.
    # MAPIE learns the prediction-to-outcome mapping and produces
    # conformal intervals around the corrected prediction.
    X = preds.reshape(-1, 1)
    y = outs

    base_estimator = LinearRegression()
    mapie = CrossConformalRegressor(
        estimator=base_estimator,
        confidence_level=coverage,
        method="plus",
        cv=5,
    )
    mapie.fit_conformalize(X, y)

    X_new = np.array([[new_prediction]])
    y_pred, y_intervals = mapie.predict_interval(X_new)

    # y_intervals shape: (n_samples, 2, n_confidence_levels) — [lower, upper]
    lower = float(np.asarray(y_intervals[0, 0]).flat[0])
    upper = float(np.asarray(y_intervals[0, 1]).flat[0])

    # Clamp probability predictions to [0, 1]
    lower = float(np.clip(lower, 0.0, 1.0))
    upper = float(np.clip(upper, 0.0, 1.0))

    return {"lower": lower, "upper": upper, "coverage": coverage}


def compute_intervals_from_residuals(
    residuals: list[float],
    new_prediction: float,
    coverage: float = 0.90,
) -> dict:
    """
    Split conformal method using the empirical distribution of residuals.
    No model fitting needed.

    Procedure:
    1. Compute absolute residuals
    2. Find the ceil((n+1) * coverage) / n quantile of |residuals|
       (this is the conformal quantile with finite-sample guarantee)
    3. Interval = [prediction - quantile, prediction + quantile]

    Returns: {"lower": float, "upper": float, "coverage": float}
    """
    resids = np.asarray(residuals, dtype=np.float64)

    if len(resids) == 0:
        # No data at all — return a wide default interval
        lower = float(np.clip(new_prediction - 0.5, 0.0, 1.0))
        upper = float(np.clip(new_prediction + 0.5, 0.0, 1.0))
        return {"lower": lower, "upper": upper, "coverage": coverage}

    abs_resids = np.abs(resids)
    n = len(abs_resids)

    # Conformal quantile level with finite-sample correction:
    # q = ceil((n+1) * coverage) / n, clamped to [0, 1]
    quantile_level = min(np.ceil((n + 1) * coverage) / n, 1.0)
    q = float(np.quantile(abs_resids, quantile_level))

    lower = float(np.clip(new_prediction - q, 0.0, 1.0))
    upper = float(np.clip(new_prediction + q, 0.0, 1.0))

    return {"lower": lower, "upper": upper, "coverage": coverage}
