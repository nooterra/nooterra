from __future__ import annotations

from datetime import datetime, timedelta, timezone

from src.uplift import fit_uplift_model, predict_uplift


def make_graded_outcomes(n_treatment=60, n_control=30):
    rows = []
    base_time = datetime(2026, 4, 1, tzinfo=timezone.utc)

    for i in range(n_treatment):
        paid = 1.0 if i % 3 != 0 else 0.0
        rows.append({
            "action_class": "communicate.email",
            "decision_type": "intervention",
            "variant_id": "email_friendly",
            "invoice_amount_cents": 100_000 + i * 5_000,
            "days_overdue": 5 + (i % 25),
            "predicted_payment_prob": 0.5,
            "objective_achieved": paid > 0.5,
            "objective_score": 0.7 if paid > 0.5 else 0.3,
            "delta_expected": 0.15,
            "delta_observed": 0.20 if paid > 0.5 else -0.10,
            "effect_matched": paid > 0.5,
            "action_at": (base_time + timedelta(hours=i)).isoformat(),
            "observed_at": (base_time + timedelta(days=7, hours=i)).isoformat(),
            "state": {
                "amountCents": 100_000 + i * 5_000,
                "amountRemainingCents": 100_000 + i * 5_000 if paid < 0.5 else 0,
                "dueAt": (base_time - timedelta(days=5 + i % 25)).isoformat(),
                "status": "overdue",
            },
            "estimated": {
                "disputeRisk": 0.1,
                "urgency": min(0.9, 0.3 + i * 0.01),
                "paymentProbability30d": 0.5,
                "paymentReliability": 0.6,
                "churnRisk": 0.2,
            },
        })

    for i in range(n_control):
        paid = 1.0 if i % 4 == 0 else 0.0  # ~25% self-resolve for control
        rows.append({
            "action_class": "strategic.hold",
            "decision_type": "strategic_hold",
            "variant_id": "strategic_hold",
            "invoice_amount_cents": 100_000 + i * 5_000,
            "days_overdue": 5 + (i % 25),
            "predicted_payment_prob": 0.5,
            "objective_achieved": paid > 0.5,
            "objective_score": 0.6 if paid > 0.5 else 0.2,
            "delta_expected": 0.0,
            "delta_observed": 0.0 if paid < 0.5 else 0.15,
            "effect_matched": True,
            "action_at": (base_time + timedelta(hours=i)).isoformat(),
            "observed_at": (base_time + timedelta(days=7, hours=i)).isoformat(),
            "state": {
                "amountCents": 100_000 + i * 5_000,
                "amountRemainingCents": 100_000 + i * 5_000 if paid < 0.5 else 0,
                "dueAt": (base_time - timedelta(days=5 + i % 25)).isoformat(),
                "status": "overdue",
            },
            "estimated": {
                "disputeRisk": 0.1,
                "urgency": min(0.9, 0.3 + i * 0.01),
                "paymentProbability30d": 0.5,
                "paymentReliability": 0.6,
                "churnRisk": 0.2,
            },
        })

    return rows


def test_fit_uplift_model_returns_model_with_sufficient_data():
    outcomes = make_graded_outcomes(n_treatment=60, n_control=30)
    model = fit_uplift_model(outcomes, tenant_id="t_test", action_class="communicate.email")
    assert model is not None
    assert model.model_id.startswith("uplift_")
    assert model.treatment_sample_count >= 30
    assert model.control_sample_count >= 15
    assert model.scope == "tenant"


def test_fit_uplift_model_returns_none_with_insufficient_control():
    outcomes = make_graded_outcomes(n_treatment=60, n_control=0)
    model = fit_uplift_model(outcomes, tenant_id="t_test", action_class="communicate.email")
    assert model is None


def test_predict_uplift_returns_lift_and_interval():
    outcomes = make_graded_outcomes(n_treatment=60, n_control=30)
    model = fit_uplift_model(outcomes, tenant_id="t_test", action_class="communicate.email")
    assert model is not None

    features = {
        "amountCents": 150000, "amountRemainingCents": 150000, "amountPaidCents": 0,
        "amountRemainingRatio": 1.0, "amountPaidRatio": 0.0, "daysOverdue": 12.0,
        "isOverdue": 1.0, "isSent": 0.0, "isPartial": 0.0, "isPaid": 0.0,
        "isDisputed": 0.0, "disputeRisk": 0.1, "urgency": 0.5,
        "paymentProbability30d": 0.5, "paymentReliability": 0.6, "churnRisk": 0.2,
    }
    result = predict_uplift(model, features)
    assert "lift" in result
    assert "treatment_prob" in result
    assert "control_prob" in result
    assert "interval" in result
    assert isinstance(result["lift"], float)
    assert result["interval"]["lower"] <= result["lift"] <= result["interval"]["upper"]
