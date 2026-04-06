"""Tests for calibration module."""

import numpy as np
import pytest
from src.calibration import (
    apply_isotonic,
    apply_temperature,
    calibrate,
    compute_ece,
    fit_best_calibrator,
    fit_isotonic,
    fit_temperature_scaling,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_overconfident(n: int = 500, seed: int = 42):
    """True prob ~0.5, predicted prob ~0.8 => overconfident."""
    rng = np.random.default_rng(seed)
    outcomes = rng.binomial(1, 0.5, size=n).astype(float).tolist()
    predictions = np.clip(rng.normal(0.8, 0.05, size=n), 0.01, 0.99).tolist()
    return predictions, outcomes


# ---------------------------------------------------------------------------
# ECE tests
# ---------------------------------------------------------------------------

class TestComputeECE:
    def test_perfect_calibration(self):
        """predictions = outcomes => ECE ~ 0."""
        outcomes = [0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0]
        predictions = list(outcomes)
        ece = compute_ece(predictions, outcomes)
        assert ece == pytest.approx(0.0, abs=1e-9)

    def test_overconfident_high_ece(self):
        """Overconfident predictions should have ECE > 0.2."""
        predictions, outcomes = _make_overconfident()
        ece = compute_ece(predictions, outcomes)
        assert ece > 0.2

    def test_empty(self):
        assert compute_ece([], []) == 0.0


# ---------------------------------------------------------------------------
# Temperature scaling tests
# ---------------------------------------------------------------------------

class TestTemperatureScaling:
    def test_overconfident_T_gt_1(self):
        """For overconfident predictions, T should be > 1 (softens probs)."""
        predictions, outcomes = _make_overconfident()
        T = fit_temperature_scaling(predictions, outcomes)
        assert T > 1.0

    def test_apply_temperature_softens(self):
        """Applying T > 1 should move prediction toward 0.5."""
        p = 0.8
        T = 2.0
        cal = apply_temperature(p, T)
        assert 0.5 < cal < p

    def test_apply_temperature_identity_at_T1(self):
        """T=1 should return the original prediction."""
        p = 0.73
        assert apply_temperature(p, 1.0) == pytest.approx(p, abs=1e-6)


# ---------------------------------------------------------------------------
# Isotonic regression tests
# ---------------------------------------------------------------------------

class TestIsotonic:
    def test_monotonic_output(self):
        """Isotonic calibration output must be monotonically non-decreasing."""
        predictions, outcomes = _make_overconfident()
        model = fit_isotonic(predictions, outcomes)

        test_inputs = np.linspace(0.01, 0.99, 100)
        outputs = [apply_isotonic(float(x), model) for x in test_inputs]
        for i in range(1, len(outputs)):
            assert outputs[i] >= outputs[i - 1] - 1e-9

    def test_output_in_bounds(self):
        """Output should stay in [0, 1]."""
        predictions, outcomes = _make_overconfident()
        model = fit_isotonic(predictions, outcomes)
        for p in [0.0, 0.01, 0.5, 0.99, 1.0]:
            cal = apply_isotonic(p, model)
            assert 0.0 <= cal <= 1.0


# ---------------------------------------------------------------------------
# fit_best_calibrator tests
# ---------------------------------------------------------------------------

class TestFitBestCalibrator:
    def test_ece_drops(self):
        """ECE after calibration should drop by at least 50%."""
        predictions, outcomes = _make_overconfident()
        result = fit_best_calibrator(predictions, outcomes)
        assert result["ece_before"] > 0.2
        assert result["ece_after"] < result["ece_before"] * 0.5
        assert result["n_samples"] == len(predictions)
        assert result["method"] in ("temperature", "isotonic")

    def test_calibrate_function(self):
        """calibrate() should return value in [0, 1]."""
        predictions, outcomes = _make_overconfident()
        calibrator = fit_best_calibrator(predictions, outcomes)
        for p in [0.1, 0.5, 0.8, 0.95]:
            cal = calibrate(p, calibrator)
            assert 0.0 <= cal <= 1.0


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_all_zeros(self):
        """All predictions 0, outcomes 0."""
        preds = [0.001] * 20  # clamped away from exact 0
        outcomes = [0.0] * 20
        ece = compute_ece(preds, outcomes)
        assert ece < 0.01

    def test_all_ones(self):
        """All predictions 1, outcomes 1."""
        preds = [0.999] * 20
        outcomes = [1.0] * 20
        ece = compute_ece(preds, outcomes)
        assert ece < 0.01

    def test_single_prediction(self):
        """Single sample should not crash."""
        ece = compute_ece([0.7], [1.0])
        assert isinstance(ece, float)

    def test_fit_temperature_single_class(self):
        """All outcomes same class — should still return a valid T."""
        preds = [0.9] * 30
        outcomes = [1.0] * 30
        T = fit_temperature_scaling(preds, outcomes)
        assert 0.1 <= T <= 10.0

    def test_fit_best_calibrator_returns_temperature_key(self):
        """temperature key present regardless of method chosen."""
        predictions, outcomes = _make_overconfident()
        result = fit_best_calibrator(predictions, outcomes)
        assert "temperature" in result
        if result["method"] == "temperature":
            assert isinstance(result["temperature"], float)
        else:
            assert result["temperature"] is None
