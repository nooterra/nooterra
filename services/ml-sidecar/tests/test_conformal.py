"""
Tests for conformal prediction intervals.

Covers:
- 90% coverage on synthetic data (200 samples)
- Fallback behavior with < 20 samples
- Probability clamping to [0, 1]
- Coverage at 0.80 and 0.95 levels
- compute_intervals_from_residuals
"""

import numpy as np
import pytest

from conformal import compute_intervals, compute_intervals_from_residuals


def _synthetic_data(n: int, noise_std: float = 0.1, seed: int = 42):
    """Generate prediction-outcome pairs where outcome = prediction + N(0, noise_std)."""
    rng = np.random.default_rng(seed)
    predictions = rng.uniform(0.1, 0.9, size=n)
    outcomes = predictions + rng.normal(0, noise_std, size=n)
    outcomes = np.clip(outcomes, 0.0, 1.0)
    return predictions.tolist(), outcomes.tolist()


# ---- compute_intervals (MAPIE-based) ----


class TestComputeIntervals:
    def test_coverage_90_on_synthetic_data(self):
        """90% interval should contain the true value at least 88% of the time."""
        preds, outs = _synthetic_data(200, noise_std=0.1, seed=42)
        rng = np.random.default_rng(99)
        test_preds = rng.uniform(0.1, 0.9, size=100)
        test_outcomes = test_preds + rng.normal(0, 0.1, size=100)
        test_outcomes = np.clip(test_outcomes, 0.0, 1.0)

        hits = 0
        for p, o in zip(test_preds, test_outcomes):
            result = compute_intervals(preds, outs, float(p), coverage=0.90)
            if result["lower"] <= o <= result["upper"]:
                hits += 1

        coverage_rate = hits / len(test_preds)
        assert coverage_rate >= 0.88, (
            f"Coverage {coverage_rate:.2f} is below 0.88 threshold"
        )

    def test_fallback_with_small_sample(self):
        """With < 20 samples, should use MAE-based fallback."""
        preds, outs = _synthetic_data(10, noise_std=0.1, seed=7)
        result = compute_intervals(preds, outs, 0.5, coverage=0.90)
        assert "lower" in result
        assert "upper" in result
        assert result["coverage"] == 0.90
        # Fallback uses +/- 2*MAE, so interval should be non-trivial
        assert result["upper"] > result["lower"]

    def test_fallback_with_zero_samples(self):
        """With 0 samples, should still return a valid interval."""
        result = compute_intervals([], [], 0.5, coverage=0.90)
        assert result["lower"] == 0.0
        assert result["upper"] == 1.0
        assert result["coverage"] == 0.90

    def test_probability_clamping(self):
        """Intervals should be clamped to [0, 1]."""
        # Predictions near boundaries
        preds, outs = _synthetic_data(200, noise_std=0.2, seed=42)
        result_low = compute_intervals(preds, outs, 0.02, coverage=0.90)
        result_high = compute_intervals(preds, outs, 0.98, coverage=0.90)

        assert result_low["lower"] >= 0.0
        assert result_low["upper"] <= 1.0
        assert result_high["lower"] >= 0.0
        assert result_high["upper"] <= 1.0

    def test_coverage_80(self):
        """80% coverage should produce narrower intervals than 90%."""
        preds, outs = _synthetic_data(200, noise_std=0.1, seed=42)
        result_80 = compute_intervals(preds, outs, 0.5, coverage=0.80)
        result_90 = compute_intervals(preds, outs, 0.5, coverage=0.90)

        width_80 = result_80["upper"] - result_80["lower"]
        width_90 = result_90["upper"] - result_90["lower"]
        assert width_80 <= width_90, (
            f"80% width ({width_80:.4f}) should be <= 90% width ({width_90:.4f})"
        )

    def test_coverage_95(self):
        """95% coverage should produce wider intervals than 90%."""
        preds, outs = _synthetic_data(200, noise_std=0.1, seed=42)
        result_90 = compute_intervals(preds, outs, 0.5, coverage=0.90)
        result_95 = compute_intervals(preds, outs, 0.5, coverage=0.95)

        width_90 = result_90["upper"] - result_90["lower"]
        width_95 = result_95["upper"] - result_95["lower"]
        assert width_95 >= width_90, (
            f"95% width ({width_95:.4f}) should be >= 90% width ({width_90:.4f})"
        )

    def test_mismatched_lengths_raises(self):
        """Should raise ValueError if predictions and outcomes have different lengths."""
        with pytest.raises(ValueError):
            compute_intervals([0.5, 0.6], [0.5], 0.5)


# ---- compute_intervals_from_residuals ----


class TestComputeIntervalsFromResiduals:
    def test_coverage_on_synthetic_residuals(self):
        """Empirical conformal should provide near-nominal coverage."""
        rng_cal = np.random.default_rng(42)
        n_cal = 200
        residuals = rng_cal.normal(0, 0.1, size=n_cal).tolist()

        # Use a separate RNG for test data to ensure exchangeability
        rng_test = np.random.default_rng(999)
        test_preds = rng_test.uniform(0.1, 0.9, size=100)
        test_noise = rng_test.normal(0, 0.1, size=100)

        hits = 0
        for p, noise in zip(test_preds, test_noise):
            true_val = np.clip(p + noise, 0.0, 1.0)
            result = compute_intervals_from_residuals(
                residuals, float(p), coverage=0.90
            )
            if result["lower"] <= true_val <= result["upper"]:
                hits += 1

        coverage_rate = hits / len(test_preds)
        assert coverage_rate >= 0.88, (
            f"Residual coverage {coverage_rate:.2f} is below 0.88"
        )

    def test_empty_residuals(self):
        """With no residuals, should return a wide default interval."""
        result = compute_intervals_from_residuals([], 0.5, coverage=0.90)
        assert result["lower"] == 0.0
        assert result["upper"] == 1.0

    def test_clamping(self):
        """Intervals should be clamped to [0, 1]."""
        residuals = [0.3, -0.3, 0.4, -0.4, 0.5, -0.5]
        result = compute_intervals_from_residuals(residuals, 0.05, coverage=0.90)
        assert result["lower"] >= 0.0
        assert result["upper"] <= 1.0

    def test_higher_coverage_wider(self):
        """95% interval should be wider than 80%."""
        rng = np.random.default_rng(42)
        residuals = rng.normal(0, 0.1, size=200).tolist()

        r80 = compute_intervals_from_residuals(residuals, 0.5, coverage=0.80)
        r95 = compute_intervals_from_residuals(residuals, 0.5, coverage=0.95)

        w80 = r80["upper"] - r80["lower"]
        w95 = r95["upper"] - r95["lower"]
        assert w95 >= w80
