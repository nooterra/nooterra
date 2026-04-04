from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

import src.server as server
from src.server import app


def make_training_rows(count: int, *, tenant_id: str = "t_test") -> list[dict]:
    rows: list[dict] = []
    base_due_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    base_predicted_at = datetime(2026, 4, 1, tzinfo=timezone.utc)
    for idx in range(count):
        outcome = 1.0 if idx % 3 != 0 else 0.0
        amount_cents = 100_000 + (idx * 12_500)
        rows.append(
            {
                "tenant_id": tenant_id,
                "object_id": f"inv_{idx}",
                "prediction_type": "paymentProbability7d",
                "predicted_value": 0.55,
                "predicted_at": (base_predicted_at + timedelta(hours=idx)).isoformat(),
                "outcome_value": outcome,
                "outcome_at": (base_predicted_at + timedelta(days=7, hours=idx)).isoformat(),
                "state": {
                    "amountCents": amount_cents,
                    "amountRemainingCents": amount_cents if outcome < 0.5 else amount_cents * 0.2,
                    "amountPaidCents": 0 if outcome < 0.5 else amount_cents * 0.8,
                    "dueAt": (base_due_at - timedelta(days=idx + 1)).isoformat(),
                    "status": "overdue" if outcome < 0.5 else "paid",
                },
                "estimated": {
                    "disputeRisk": 0.15 if outcome > 0.5 else 0.3,
                    "urgency": min(0.95, 0.4 + idx * 0.01),
                    "paymentProbability30d": 0.7 if outcome > 0.5 else 0.35,
                    "paymentReliability": 0.8 if outcome > 0.5 else 0.45,
                    "churnRisk": 0.2 if outcome > 0.5 else 0.5,
                },
            }
        )
    return rows


def install_release_store(monkeypatch):
    releases: list[dict] = []

    async def fake_insert_model_release(pool, release):
        releases.append(dict(release))

    async def fake_get_latest_model_release(pool, prediction_type, scope, tenant_id=None, status=None):
        matches = [
            release for release in releases
            if release["prediction_type"] == prediction_type
            and release["scope"] == scope
            and release.get("tenant_id") == tenant_id
            and (status is None or release["status"] == status)
        ]
        if not matches:
            return None
        matches.sort(key=lambda item: (item["trained_at"], item["release_id"]), reverse=True)
        return matches[0]

    async def fake_list_model_releases(pool, tenant_id=None, prediction_type=None):
        matches = [
            release for release in releases
            if (tenant_id is None or release.get("tenant_id") == tenant_id or release.get("tenant_id") is None)
            and (prediction_type is None or release["prediction_type"] == prediction_type)
        ]
        matches.sort(key=lambda item: (item["trained_at"], item["release_id"]), reverse=True)
        return matches

    monkeypatch.setattr(server, "insert_model_release", fake_insert_model_release)
    monkeypatch.setattr(server, "get_latest_model_release", fake_get_latest_model_release)
    monkeypatch.setattr(server, "list_model_releases", fake_list_model_releases)
    return releases


@pytest.fixture(autouse=True)
def clear_sidecar_state(monkeypatch):
    server._calibrators.clear()
    server._trained_models.clear()
    server._intervention_models.clear()
    server._uplift_models.clear()
    server.drift_monitor._monitors.clear()
    server.drift_monitor._last_checked.clear()
    server.distribution_monitor._distributions.clear()
    yield
    server._calibrators.clear()
    server._trained_models.clear()
    server._intervention_models.clear()
    server._uplift_models.clear()


@pytest.mark.asyncio
async def test_health_returns_200(monkeypatch):
    async def fake_get_pool():
        return None

    monkeypatch.setattr(server, "get_pool", fake_get_pool)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["db_connected"] is False


@pytest.mark.asyncio
async def test_predict_returns_rule_fallback_when_no_db(monkeypatch):
    async def fake_get_pool():
        return None

    monkeypatch.setattr(server, "get_pool", fake_get_pool)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/predict",
            json={
                "tenant_id": "t_test",
                "object_id": "obj_1",
                "prediction_type": "paymentProbability7d",
                "features": {"paymentProbability7d": 0.41, "amountCents": 100000},
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["model_id"] == "rule_inference"
        assert data["selection"]["chosen_model_id"] == "rule_inference"
        assert data["selection"]["strategy"] == "fallback_rule"


@pytest.mark.asyncio
async def test_predict_uses_trained_tenant_model_when_training_data_exists(monkeypatch):
    rows = make_training_rows(24)
    install_release_store(monkeypatch)

    async def fake_get_pool():
        return object()

    async def fake_get_prediction_training_rows(pool, prediction_type, tenant_id=None, limit=2000):
        assert prediction_type == "paymentProbability7d"
        assert tenant_id == "t_test"
        return rows

    async def fake_get_prediction_outcome_pairs(pool, tenant_id, prediction_type):
        return []

    monkeypatch.setattr(server, "get_pool", fake_get_pool)
    monkeypatch.setattr(server, "get_prediction_training_rows", fake_get_prediction_training_rows)
    monkeypatch.setattr(server, "get_prediction_outcome_pairs", fake_get_prediction_outcome_pairs)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/predict",
            json={
                "tenant_id": "t_test",
                "object_id": "inv_live",
                "prediction_type": "paymentProbability7d",
                "features": {
                    "paymentProbability7d": 0.45,
                    "amountCents": 180000,
                    "amountRemainingCents": 180000,
                    "amountPaidCents": 0,
                    "amountRemainingRatio": 1,
                    "amountPaidRatio": 0,
                    "daysOverdue": 15,
                    "isOverdue": 1,
                    "isSent": 0,
                    "isPartial": 0,
                    "isPaid": 0,
                    "isDisputed": 0,
                    "disputeRisk": 0.18,
                    "urgency": 0.73,
                    "paymentProbability30d": 0.69,
                    "paymentReliability": 0.77,
                    "churnRisk": 0.22,
                },
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["model_id"].startswith("ml_logreg_invoice_payment_7d_tenant")
        assert data["selection"]["strategy"] == "trained_probability_model"
        assert data["selection"]["scope"] == "tenant"
        assert data["selection"]["training_samples"] == 24
        assert 0 <= data["value"] <= 1


@pytest.mark.asyncio
async def test_train_endpoint_returns_trained_model(monkeypatch):
    rows = make_training_rows(24)
    install_release_store(monkeypatch)

    async def fake_get_pool():
        return object()

    async def fake_get_prediction_training_rows(pool, prediction_type, tenant_id=None, limit=2000):
        return rows

    monkeypatch.setattr(server, "get_pool", fake_get_pool)
    monkeypatch.setattr(server, "get_prediction_training_rows", fake_get_prediction_training_rows)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/train",
            json={
                "prediction_type": "paymentProbability7d",
                "tenant_id": "t_test",
                "force": True,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "trained"
        assert data["scope"] == "tenant"
        assert data["sample_count"] == 24
        assert data["model_id"].startswith("ml_logreg_invoice_payment_7d_tenant")
        assert data["release_id"] is not None
        assert data["release_status"] in {"approved", "candidate", "rejected"}


@pytest.mark.asyncio
async def test_model_releases_returns_cached_models(monkeypatch):
    rows = make_training_rows(24)
    install_release_store(monkeypatch)

    async def fake_get_pool():
        return object()

    async def fake_get_prediction_training_rows(pool, prediction_type, tenant_id=None, limit=2000):
        return rows

    monkeypatch.setattr(server, "get_pool", fake_get_pool)
    monkeypatch.setattr(server, "get_prediction_training_rows", fake_get_prediction_training_rows)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        train_resp = await client.post(
            "/train",
            json={
                "prediction_type": "paymentProbability7d",
                "tenant_id": "t_test",
                "force": True,
            },
        )
        assert train_resp.status_code == 200

        resp = await client.get("/models/releases")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["releases"]) == 1
        assert data["releases"][0]["prediction_type"] == "paymentProbability7d"
        assert data["releases"][0]["tenant_id"] == "t_test"


@pytest.mark.asyncio
async def test_intervention_estimate_returns_regression_backed_effects(monkeypatch):
    rows = []
    base_observed_at = datetime(2026, 4, 1, tzinfo=timezone.utc)
    for idx in range(12):
        rows.append(
            {
                "tenant_id": "t_test",
                "action_id": f"act_{idx}",
                "object_id": f"inv_{idx}",
                "field": "paymentProbability7d",
                "current_value": 0.35 + (idx * 0.01),
                "predicted_value": 0.48 + (idx * 0.01),
                "delta_expected": 0.13,
                "delta_observed": 0.18 + (idx * 0.005),
                "confidence": 0.72,
                "matched": True,
                "observed_at": (base_observed_at + timedelta(hours=idx)).isoformat(),
                "objective_score": 0.8,
                "summary": {},
                "state": {
                    "amountCents": 100_000 + idx * 1_000,
                    "amountRemainingCents": 100_000 + idx * 1_000,
                    "amountPaidCents": 0,
                    "dueAt": (base_observed_at - timedelta(days=idx + 10)).isoformat(),
                    "status": "overdue",
                },
                "estimated": {
                    "disputeRisk": 0.15,
                    "urgency": 0.7,
                    "paymentProbability30d": 0.65,
                    "paymentReliability": 0.6,
                    "churnRisk": 0.2,
                },
            }
        )

    async def fake_get_pool():
        return object()

    async def fake_get_intervention_training_rows(pool, tenant_id, action_class, object_type, field, limit=1000):
        assert tenant_id == "t_test"
        assert action_class == "communicate.email"
        assert object_type == "invoice"
        assert field == "paymentProbability7d"
        return rows

    async def fake_get_intervention_comparison_rows(pool, tenant_id, object_type, field, limit=32):
        assert tenant_id == "t_test"
        assert object_type == "invoice"
        assert field == "paymentProbability7d"
        return [
            {
                "action_class": "communicate.email",
                "sample_count": 12,
                "avg_delta_observed": 0.205,
                "avg_confidence": 0.72,
                "match_rate": 0.9,
                "avg_objective_score": 0.8,
            },
            {
                "action_class": "task.create",
                "sample_count": 10,
                "avg_delta_observed": 0.11,
                "avg_confidence": 0.66,
                "match_rate": 0.82,
                "avg_objective_score": 0.74,
            },
        ]

    monkeypatch.setattr(server, "get_pool", fake_get_pool)
    monkeypatch.setattr(server, "get_intervention_training_rows", fake_get_intervention_training_rows)
    monkeypatch.setattr(server, "get_intervention_comparison_rows", fake_get_intervention_comparison_rows)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/interventions/estimate",
            json={
                "tenant_id": "t_test",
                "object_id": "inv_live",
                "object_type": "invoice",
                "action_class": "communicate.email",
                "state": {
                    "amountCents": 180000,
                    "amountRemainingCents": 180000,
                    "amountPaidCents": 0,
                    "dueAt": "2026-03-15T00:00:00+00:00",
                    "status": "overdue",
                },
                "estimated": {
                    "disputeRisk": 0.18,
                    "urgency": 0.73,
                    "paymentProbability30d": 0.69,
                    "paymentReliability": 0.77,
                    "churnRisk": 0.22,
                },
                "effects": [
                    {
                        "field": "paymentProbability7d",
                        "current_value": 0.41,
                        "predicted_value": 0.56,
                        "confidence": 0.7,
                        "label": "Collection payment likelihood",
                    }
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["model_type"] == "comparative_treatment_effect"
        assert data["sample_count"] == 12
        assert data["comparative_evidence_strength"] > 0
        assert len(data["estimates"]) == 1
        assert data["estimates"][0]["field"] == "paymentProbability7d"
        assert data["estimates"][0]["predicted_value"] > 0.56
        assert data["estimates"][0]["quality_score"] >= 0.45
        assert data["estimates"][0]["baseline_action_class"] == "task.create"
        assert data["estimates"][0]["comparative_lift"] > 0
        assert data["estimates"][0]["comparative_quality_score"] >= 0.45


@pytest.mark.asyncio
async def test_calibrate_returns_valid_response(monkeypatch):
    async def fake_get_pool():
        return None

    monkeypatch.setattr(server, "get_pool", fake_get_pool)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/calibrate",
            json={
                "model_id": "rule_inference",
                "prediction_type": "paymentProbability7d",
                "tenant_id": "t_test",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "method" in data
        assert "ece_before" in data
        assert "ece_after" in data


@pytest.mark.asyncio
async def test_drift_returns_valid_response(monkeypatch):
    async def fake_get_pool():
        return None

    monkeypatch.setattr(server, "get_pool", fake_get_pool)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/drift/t_test")
        assert resp.status_code == 200
        data = resp.json()
        assert "models" in data
        assert isinstance(data["models"], list)


@pytest.mark.anyio
async def test_uplift_train_endpoint(monkeypatch):
    install_release_store(monkeypatch)
    from tests.test_uplift import make_graded_outcomes
    outcomes = make_graded_outcomes(n_treatment=60, n_control=30)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/uplift/train", json={
            "tenant_id": "t_uplift_test",
            "action_class": "communicate.email",
            "outcomes": outcomes,
        })
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "trained"
    assert body["model_id"].startswith("uplift_")
    assert body["treatment_samples"] >= 30
    assert body["control_samples"] >= 15


@pytest.mark.anyio
async def test_uplift_predict_endpoint(monkeypatch):
    install_release_store(monkeypatch)
    from tests.test_uplift import make_graded_outcomes
    outcomes = make_graded_outcomes(n_treatment=60, n_control=30)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        train_resp = await client.post("/uplift/train", json={
            "tenant_id": "t_uplift_test",
            "action_class": "communicate.email",
            "outcomes": outcomes,
        })
        assert train_resp.status_code == 200

        predict_resp = await client.post("/uplift/predict", json={
            "tenant_id": "t_uplift_test",
            "action_class": "communicate.email",
            "features": {
                "amountCents": 150000, "amountRemainingCents": 150000, "amountPaidCents": 0,
                "amountRemainingRatio": 1.0, "amountPaidRatio": 0.0, "daysOverdue": 12.0,
                "isOverdue": 1.0, "isSent": 0.0, "isPartial": 0.0, "isPaid": 0.0,
                "isDisputed": 0.0, "disputeRisk": 0.1, "urgency": 0.5,
                "paymentProbability30d": 0.5, "paymentReliability": 0.6, "churnRisk": 0.2,
            },
        })
    assert predict_resp.status_code == 200
    body = predict_resp.json()
    assert "lift" in body
    assert "treatment_prob" in body
    assert "control_prob" in body
    assert "interval" in body
