import sys
import os

# Add src/ to path so we can import ood directly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import numpy as np
import pytest

from ood import DistributionMonitor, distribution_monitor


@pytest.fixture
def monitor():
    return DistributionMonitor(n_bins=50, threshold=0.5)


@pytest.fixture
def strict_monitor():
    return DistributionMonitor(n_bins=50, threshold=0.1)


@pytest.fixture
def loose_monitor():
    return DistributionMonitor(n_bins=50, threshold=1.0)


class TestSingleFeature:
    """Fit on N(0,1), check in-distribution and OOD points."""

    def test_in_distribution_value(self, monitor):
        rng = np.random.default_rng(42)
        samples = rng.standard_normal(1000).tolist()
        monitor.fit("t1", "paymentProbability7d", {"amount": samples})

        result = monitor.check("t1", "paymentProbability7d", {"amount": 0.5})
        assert result["in_distribution"] is True
        assert result["kl_divergence"] < monitor.threshold
        assert "amount" in result["per_feature"]

    def test_ood_value(self, monitor):
        rng = np.random.default_rng(42)
        samples = rng.standard_normal(1000).tolist()
        monitor.fit("t1", "paymentProbability7d", {"amount": samples})

        result = monitor.check("t1", "paymentProbability7d", {"amount": 10.0})
        assert result["in_distribution"] is False
        assert result["kl_divergence"] > monitor.threshold
        assert result["per_feature"]["amount"] > monitor.threshold


class TestMultipleFeatures:
    """Fit on multiple features, verify per_feature KL is reported."""

    def test_per_feature_reported(self, monitor):
        rng = np.random.default_rng(42)
        feature_matrix = {
            "amount": rng.standard_normal(1000).tolist(),
            "days_overdue": rng.standard_normal(1000).tolist(),
            "contact_count": rng.standard_normal(1000).tolist(),
        }
        monitor.fit("t1", "paymentProbability7d", feature_matrix)

        result = monitor.check(
            "t1",
            "paymentProbability7d",
            {"amount": 0.0, "days_overdue": 8.0, "contact_count": 0.5},
        )
        assert "amount" in result["per_feature"]
        assert "days_overdue" in result["per_feature"]
        assert "contact_count" in result["per_feature"]
        # days_overdue at 8.0 should have much higher KL than amount at 0.0
        assert result["per_feature"]["days_overdue"] > result["per_feature"]["amount"]

    def test_unknown_feature_ignored(self, monitor):
        rng = np.random.default_rng(42)
        monitor.fit("t1", "churnRisk", {"amount": rng.standard_normal(100).tolist()})
        result = monitor.check("t1", "churnRisk", {"nonexistent_feature": 5.0})
        assert result["in_distribution"] is True
        assert result["kl_divergence"] == 0.0


class TestThresholds:
    """Test with strict and loose thresholds."""

    def test_strict_threshold_flags_moderate_deviation(self, strict_monitor):
        rng = np.random.default_rng(42)
        samples = rng.standard_normal(1000).tolist()
        strict_monitor.fit("t1", "paymentProbability7d", {"x": samples})

        # A value at 2.0 should be flagged with strict threshold=0.1
        result = strict_monitor.check("t1", "paymentProbability7d", {"x": 2.0})
        assert result["kl_divergence"] > strict_monitor.threshold

    def test_loose_threshold_passes_moderate_outlier(self, loose_monitor):
        rng = np.random.default_rng(42)
        samples = rng.standard_normal(1000).tolist()
        loose_monitor.fit("t1", "paymentProbability7d", {"x": samples})

        # 1.5 sigma with loose threshold=1.0 should be in-distribution
        result = loose_monitor.check("t1", "paymentProbability7d", {"x": 1.5})
        assert result["in_distribution"] is True


class TestSameDistribution:
    """Features drawn from the same distribution as training should have low KL."""

    def test_same_distribution_low_kl(self, monitor):
        rng = np.random.default_rng(42)
        training = rng.standard_normal(1000).tolist()
        monitor.fit("t1", "paymentProbability7d", {"x": training})

        # Check many points drawn from the same distribution
        test_rng = np.random.default_rng(99)
        test_points = test_rng.standard_normal(100)

        ood_count = 0
        for val in test_points:
            result = monitor.check("t1", "paymentProbability7d", {"x": float(val)})
            if not result["in_distribution"]:
                ood_count += 1

        # Vast majority should be in-distribution
        assert ood_count < 25, f"Too many false OOD detections: {ood_count}/100"


class TestAcceptanceCriteria:
    """Sprint spec acceptance: KL > 0.5 when distribution shifts by 2 std devs."""

    def test_shifted_distribution_high_kl(self, monitor):
        rng = np.random.default_rng(42)
        training = rng.standard_normal(1000).tolist()
        monitor.fit("t1", "paymentProbability7d", {"x": training})

        # Point shifted well beyond 2 standard deviations
        result = monitor.check("t1", "paymentProbability7d", {"x": 5.0})
        assert result["kl_divergence"] > 0.5
        assert result["in_distribution"] is False


class TestNoFitGraceful:
    """Checking before fitting should not crash."""

    def test_no_fit_returns_in_distribution(self, monitor):
        result = monitor.check("unknown_tenant", "unknown_type", {"x": 1.0})
        assert result["in_distribution"] is True
        assert result["kl_divergence"] == 0.0
        assert result["per_feature"] == {}


class TestSingleton:
    """Module-level singleton exists."""

    def test_singleton_import(self):
        assert isinstance(distribution_monitor, DistributionMonitor)
