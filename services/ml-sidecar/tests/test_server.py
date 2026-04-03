import pytest
from httpx import ASGITransport, AsyncClient

from src.server import app


@pytest.mark.asyncio
async def test_health_returns_200():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"


@pytest.mark.asyncio
async def test_predict_returns_valid_response():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/predict",
            json={
                "tenant_id": "t_test",
                "object_id": "obj_1",
                "prediction_type": "paymentProbability7d",
                "features": {"amount_cents": 100000},
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "value" in data
        assert "confidence" in data
        assert "interval" in data
        assert data["interval"]["coverage"] == 0.90


@pytest.mark.asyncio
async def test_calibrate_returns_valid_response():
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
async def test_drift_returns_valid_response():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/drift/t_test")
        assert resp.status_code == 200
        data = resp.json()
        assert "models" in data
        assert len(data["models"]) > 0
        assert "drift_detected" in data["models"][0]
