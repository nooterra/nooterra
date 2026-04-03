import random
import pytest
from src.drift import DriftMonitor


@pytest.fixture
def monitor():
    return DriftMonitor()


def test_no_drift_on_stationary_residuals(monitor):
    """100 stationary residuals (mean 0, std 0.1) should not trigger drift."""
    random.seed(42)
    for _ in range(100):
        predicted = 0.5
        actual = 0.5 + random.gauss(0, 0.1)
        result = monitor.update("model_a", "paymentProbability7d", "t_1", predicted, actual)

    status = monitor.get_status("model_a", "paymentProbability7d", "t_1")
    assert status["drift_detected"] is False
    assert isinstance(status["adwin_value"], float)
    assert isinstance(status["last_checked"], str)


def test_drift_detected_on_mean_shift(monitor):
    """After 100 stationary residuals, 50 with shifted mean should trigger drift."""
    random.seed(42)

    # Stationary phase: residuals around 0
    for _ in range(100):
        predicted = 0.5
        actual = 0.5 + random.gauss(0, 0.1)
        monitor.update("model_a", "paymentProbability7d", "t_1", predicted, actual)

    # Shifted phase: residuals jump to ~0.5 (large, unambiguous shift)
    drift_detected = False
    for _ in range(100):
        predicted = 1.0
        actual = 0.5 + random.gauss(0, 0.1)
        if monitor.update("model_a", "paymentProbability7d", "t_1", predicted, actual):
            drift_detected = True

    assert drift_detected, "Drift should be detected after mean shift of ~0.5"


def test_get_status_format(monitor):
    """get_status returns correct keys and types."""
    monitor.update("model_x", "churnRisk", "t_2", 0.5, 0.4)
    status = monitor.get_status("model_x", "churnRisk", "t_2")

    assert "drift_detected" in status
    assert "adwin_value" in status
    assert "last_checked" in status
    assert isinstance(status["drift_detected"], bool)
    assert isinstance(status["adwin_value"], float)
    assert isinstance(status["last_checked"], str)


def test_get_status_unknown_key(monitor):
    """get_status for unknown model returns defaults."""
    status = monitor.get_status("unknown", "unknown", "t_99")
    assert status["drift_detected"] is False
    assert status["adwin_value"] == 0.0


def test_get_all_status_filters_by_tenant(monitor):
    """get_all_status returns only monitors for the requested tenant."""
    random.seed(42)

    # Feed data for two tenants
    for _ in range(10):
        monitor.update("model_a", "paymentProbability7d", "t_1", 0.5, 0.5 + random.gauss(0, 0.1))
        monitor.update("model_b", "churnRisk", "t_1", 0.3, 0.3 + random.gauss(0, 0.1))
        monitor.update("model_a", "disputeRisk", "t_2", 0.4, 0.4 + random.gauss(0, 0.1))

    t1_status = monitor.get_all_status("t_1")
    t2_status = monitor.get_all_status("t_2")

    assert len(t1_status) == 2
    assert len(t2_status) == 1

    t1_model_ids = {s["model_id"] for s in t1_status}
    assert t1_model_ids == {"model_a", "model_b"}

    t2_model_ids = {s["model_id"] for s in t2_status}
    assert t2_model_ids == {"model_a"}

    # Each entry has the right shape
    for entry in t1_status:
        assert "model_id" in entry
        assert "prediction_type" in entry
        assert "drift_detected" in entry
        assert "adwin_value" in entry
        assert "last_checked" in entry


def test_rebuild_from_pairs_matches_sequential(monitor):
    """rebuild_from_pairs produces same ADWIN state as sequential updates."""
    random.seed(42)
    pairs = [(0.5, 0.5 + random.gauss(0, 0.1)) for _ in range(100)]

    # Sequential updates
    seq_monitor = DriftMonitor()
    for predicted, actual in pairs:
        seq_monitor.update("model_a", "paymentProbability7d", "t_1", predicted, actual)

    # Rebuild
    rebuild_monitor = DriftMonitor()
    rebuild_monitor.rebuild_from_pairs("model_a", "paymentProbability7d", "t_1", pairs)

    seq_status = seq_monitor.get_status("model_a", "paymentProbability7d", "t_1")
    rebuild_status = rebuild_monitor.get_status("model_a", "paymentProbability7d", "t_1")

    assert seq_status["drift_detected"] == rebuild_status["drift_detected"]
    assert abs(seq_status["adwin_value"] - rebuild_status["adwin_value"]) < 1e-10
