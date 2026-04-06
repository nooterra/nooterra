# Phase 2: Intervention Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The system estimates action lift well enough to choose better actions than the heuristic ranking — a two-model uplift baseline in shadow mode, with its own evaluation artifacts and promotion criteria, plus domain seam extraction of objectives and planner scanner.

**Architecture:** Uplift modeling uses a T-learner approach: a treatment model (outcome given action) and a control model (outcome given hold/no-action). The difference is the estimated lift. Models train in the ML sidecar, serve via a new `/uplift/predict` endpoint, and are consumed by the ensemble. Promotion uses the existing evaluation-report + rollout-gate framework with uplift-specific metrics. Domain seam moves 2-3 extract AR objectives and scanner logic from core files into `src/domains/ar/`.

**Tech Stack:** Python (scikit-learn, FastAPI), TypeScript (Node.js), PostgreSQL

**Spec:** `docs/superpowers/specs/2026-04-03-superhuman-ar-judgment-design.md` — Section 2.1, 3.1 (Layer 2), 3.2, 4.4 (moves 2-3), 5 (Phase 2)

---

## File Map

### New Files
- `services/ml-sidecar/src/uplift.py` — uplift model training (T-learner: treatment + control models)
- `services/ml-sidecar/tests/test_uplift.py` — uplift training and prediction tests
- `src/domains/ar/objectives.ts` — AR-specific objectives and constraints (extracted from `src/core/objectives-defaults.ts`)
- `src/domains/ar/scanner.ts` — AR-specific invoice scanning and variant generation (extracted from `src/planner/planner.ts`)
- `test/world-uplift-shadow.test.js` — ensemble uplift routing and shadow mode tests
- `test/world-ar-scanner.test.js` — AR scanner extraction tests

### Modified Files
- `services/ml-sidecar/src/server.py` — add `/uplift/train` and `/uplift/predict` endpoints
- `services/ml-sidecar/src/training.py` — import and wire uplift training
- `src/world-model/ensemble.ts` — add uplift shadow-mode routing in intervention estimation
- `src/eval/evaluation-reports.ts` — add uplift-quality evaluation report type
- `src/core/objectives-defaults.ts` — thin re-export from domain pack
- `src/core/objectives.ts` — import constraints from domain pack
- `src/planner/planner.ts` — import scanner from domain pack, planner core becomes domain-agnostic

---

## Task 1: Uplift Model Training (T-Learner)

**Files:**
- Create: `services/ml-sidecar/src/uplift.py`
- Create: `services/ml-sidecar/tests/test_uplift.py`

- [ ] **Step 1: Write failing test for uplift model training**

```python
# services/ml-sidecar/tests/test_uplift.py
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.uplift import fit_uplift_model, predict_uplift


def make_graded_outcomes(
    n_treatment: int = 60,
    n_control: int = 30,
) -> list[dict]:
    """Generate graded outcomes with treatment (email) and control (hold) groups."""
    rows = []
    base_time = datetime(2026, 4, 1, tzinfo=timezone.utc)

    for i in range(n_treatment):
        paid = 1.0 if i % 3 != 0 else 0.0  # ~67% payment rate for treatment
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
        paid = 1.0 if i % 5 != 0 else 0.0  # ~80% self-resolve rate for easy ones
        # But control should have LOWER payment rate overall — flip it
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
    model = fit_uplift_model(
        outcomes,
        tenant_id="t_test",
        action_class="communicate.email",
    )
    assert model is not None
    assert model.model_id.startswith("uplift_")
    assert model.treatment_sample_count >= 30
    assert model.control_sample_count >= 15
    assert model.scope == "tenant"


def test_fit_uplift_model_returns_none_with_insufficient_control():
    # Only treatment, no control group
    outcomes = make_graded_outcomes(n_treatment=60, n_control=0)
    model = fit_uplift_model(
        outcomes,
        tenant_id="t_test",
        action_class="communicate.email",
    )
    assert model is None


def test_predict_uplift_returns_lift_and_interval():
    outcomes = make_graded_outcomes(n_treatment=60, n_control=30)
    model = fit_uplift_model(
        outcomes,
        tenant_id="t_test",
        action_class="communicate.email",
    )
    assert model is not None

    features = {
        "amountCents": 150000,
        "amountRemainingCents": 150000,
        "amountPaidCents": 0,
        "amountRemainingRatio": 1.0,
        "amountPaidRatio": 0.0,
        "daysOverdue": 12.0,
        "isOverdue": 1.0,
        "isSent": 0.0,
        "isPartial": 0.0,
        "isPaid": 0.0,
        "isDisputed": 0.0,
        "disputeRisk": 0.1,
        "urgency": 0.5,
        "paymentProbability30d": 0.5,
        "paymentReliability": 0.6,
        "churnRisk": 0.2,
    }
    result = predict_uplift(model, features)
    assert "lift" in result
    assert "treatment_prob" in result
    assert "control_prob" in result
    assert "interval" in result
    assert isinstance(result["lift"], float)
    assert result["interval"]["lower"] <= result["lift"] <= result["interval"]["upper"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ml-sidecar && python -m pytest tests/test_uplift.py -v`
Expected: FAIL — `src.uplift` module does not exist.

- [ ] **Step 3: Implement uplift model training**

```python
# services/ml-sidecar/src/uplift.py
"""
Two-model uplift baseline (T-learner).

Treatment model: P(paid | action taken, features)
Control model:   P(paid | hold/no-action, features)
Lift:            treatment_prob - control_prob

This is the simplest credible uplift estimator. It makes no causal claims —
it estimates the observed difference in outcomes between acted-on and held
invoices with similar features.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .training import build_invoice_feature_map, _to_float, _parse_datetime
from .conformal import compute_intervals_from_residuals


@dataclass
class TrainedUpliftModel:
    model_id: str
    tenant_id: str
    action_class: str
    scope: str
    feature_names: list[str]
    treatment_estimator: Pipeline
    control_estimator: Pipeline
    trained_at: str
    treatment_sample_count: int
    control_sample_count: int
    treatment_positive_rate: float
    control_positive_rate: float
    observed_lift: float
    residuals: list[float]
    metadata: dict[str, Any]


def _build_features_from_graded_outcome(row: dict[str, Any]) -> dict[str, float]:
    """Build feature map from a graded outcome row.

    Graded outcomes may carry inline state/estimated dicts or flat feature fields.
    """
    state = row.get("state") if isinstance(row.get("state"), dict) else {}
    estimated = row.get("estimated") if isinstance(row.get("estimated"), dict) else {}

    if state or estimated:
        return build_invoice_feature_map(
            state, estimated,
            reference_time=_parse_datetime(row.get("action_at")),
        )

    # Flat feature fallback from graded outcome fields
    return {
        "amountCents": _to_float(row.get("invoice_amount_cents")),
        "amountRemainingCents": _to_float(row.get("invoice_amount_cents")),
        "amountPaidCents": 0.0,
        "amountRemainingRatio": 1.0,
        "amountPaidRatio": 0.0,
        "daysOverdue": _to_float(row.get("days_overdue")),
        "isOverdue": 1.0,
        "isSent": 0.0,
        "isPartial": 0.0,
        "isPaid": 0.0,
        "isDisputed": 0.0,
        "disputeRisk": 0.0,
        "urgency": min(1.0, _to_float(row.get("days_overdue")) / 30.0),
        "paymentProbability30d": _to_float(row.get("predicted_payment_prob", 0.5)),
        "paymentReliability": 0.5,
        "churnRisk": 0.2,
    }


def fit_uplift_model(
    outcomes: list[dict[str, Any]],
    *,
    tenant_id: str,
    action_class: str,
    min_treatment: int = 30,
    min_control: int = 15,
) -> TrainedUpliftModel | None:
    """Fit a T-learner uplift model from graded outcomes.

    Requires at least min_treatment intervention outcomes and
    min_control strategic_hold/no-action outcomes.
    """
    treatment_rows = []
    control_rows = []

    for row in outcomes:
        decision = row.get("decision_type", "")
        ac = row.get("action_class", "")

        if decision == "strategic_hold" or ac == "strategic.hold":
            control_rows.append(row)
        elif decision == "intervention" or ac == action_class:
            treatment_rows.append(row)

    if len(treatment_rows) < min_treatment or len(control_rows) < min_control:
        return None

    # Build feature matrices
    treatment_features = [_build_features_from_graded_outcome(r) for r in treatment_rows]
    control_features = [_build_features_from_graded_outcome(r) for r in control_rows]

    feature_names = sorted(treatment_features[0].keys())

    def to_matrix(feature_rows: list[dict]) -> np.ndarray:
        return np.asarray(
            [[f.get(name, 0.0) for name in feature_names] for f in feature_rows],
            dtype=np.float64,
        )

    X_treat = to_matrix(treatment_features)
    y_treat = np.asarray(
        [1 if row.get("objective_achieved") else 0 for row in treatment_rows],
        dtype=np.int32,
    )

    X_ctrl = to_matrix(control_features)
    y_ctrl = np.asarray(
        [1 if row.get("objective_achieved") else 0 for row in control_rows],
        dtype=np.int32,
    )

    # Need class variance in both groups
    if len(set(y_treat.tolist())) < 2 or len(set(y_ctrl.tolist())) < 2:
        return None

    # Fit treatment model
    treatment_estimator = Pipeline([
        ("scaler", StandardScaler()),
        ("logreg", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=0)),
    ])
    treatment_estimator.fit(X_treat, y_treat)

    # Fit control model
    control_estimator = Pipeline([
        ("scaler", StandardScaler()),
        ("logreg", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=1)),
    ])
    control_estimator.fit(X_ctrl, y_ctrl)

    # Compute observed lift on all data
    all_features = treatment_features + control_features
    X_all = to_matrix(all_features)
    treatment_probs = treatment_estimator.predict_proba(X_all)[:, 1]
    control_probs = control_estimator.predict_proba(X_all)[:, 1]
    lifts = treatment_probs - control_probs

    # Residuals for conformal intervals: use treatment data actual outcomes
    treat_preds = treatment_estimator.predict_proba(X_treat)[:, 1]
    ctrl_preds_on_treat = control_estimator.predict_proba(X_treat)[:, 1]
    predicted_lifts_treat = treat_preds - ctrl_preds_on_treat
    actual_lifts_treat = y_treat.astype(float) - ctrl_preds_on_treat
    residuals = (predicted_lifts_treat - actual_lifts_treat).tolist()

    treatment_positive_rate = float(y_treat.mean())
    control_positive_rate = float(y_ctrl.mean())
    observed_lift = treatment_positive_rate - control_positive_rate

    model_id = f"uplift_tlearner_{action_class.replace('.', '_')}_v1"

    return TrainedUpliftModel(
        model_id=model_id,
        tenant_id=tenant_id,
        action_class=action_class,
        scope="tenant",
        feature_names=feature_names,
        treatment_estimator=treatment_estimator,
        control_estimator=control_estimator,
        trained_at=datetime.now(timezone.utc).isoformat(),
        treatment_sample_count=len(treatment_rows),
        control_sample_count=len(control_rows),
        treatment_positive_rate=treatment_positive_rate,
        control_positive_rate=control_positive_rate,
        observed_lift=observed_lift,
        residuals=residuals,
        metadata={
            "model_family": "t_learner",
            "treatment_action_class": action_class,
            "control_decision_type": "strategic_hold",
        },
    )


def predict_uplift(
    model: TrainedUpliftModel,
    features: dict[str, Any],
) -> dict[str, Any]:
    """Predict uplift (treatment effect) for a single observation."""
    vector = np.asarray(
        [[_to_float(features.get(name)) for name in model.feature_names]],
        dtype=np.float64,
    )

    treatment_prob = float(model.treatment_estimator.predict_proba(vector)[0][1])
    control_prob = float(model.control_estimator.predict_proba(vector)[0][1])
    lift = treatment_prob - control_prob

    interval = compute_intervals_from_residuals(
        model.residuals, lift, coverage=0.90,
    )

    return {
        "lift": float(np.clip(lift, -1.0, 1.0)),
        "treatment_prob": float(np.clip(treatment_prob, 0.0, 1.0)),
        "control_prob": float(np.clip(control_prob, 0.0, 1.0)),
        "interval": interval,
        "model_id": model.model_id,
        "treatment_samples": model.treatment_sample_count,
        "control_samples": model.control_sample_count,
        "observed_lift": model.observed_lift,
    }
```

- [ ] **Step 4: Run tests**

Run: `cd services/ml-sidecar && python -m pytest tests/test_uplift.py -v`
Expected: All 3 tests PASS.

- [ ] **Step 5: Run existing sidecar tests for no regression**

Run: `cd services/ml-sidecar && python -m pytest tests/test_server.py -v`
Expected: All existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add services/ml-sidecar/src/uplift.py services/ml-sidecar/tests/test_uplift.py
git commit -m "feat: add T-learner uplift model training and prediction"
```

---

## Task 2: Sidecar Uplift Endpoints

**Files:**
- Modify: `services/ml-sidecar/src/server.py`
- Modify: `services/ml-sidecar/tests/test_server.py`

- [ ] **Step 1: Write failing test for uplift train endpoint**

Append to `services/ml-sidecar/tests/test_server.py`:

```python
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
        # Train first
        train_resp = await client.post("/uplift/train", json={
            "tenant_id": "t_uplift_test",
            "action_class": "communicate.email",
            "outcomes": outcomes,
        })
        assert train_resp.status_code == 200

        # Predict
        predict_resp = await client.post("/uplift/predict", json={
            "tenant_id": "t_uplift_test",
            "action_class": "communicate.email",
            "features": {
                "amountCents": 150000,
                "amountRemainingCents": 150000,
                "amountPaidCents": 0,
                "amountRemainingRatio": 1.0,
                "amountPaidRatio": 0.0,
                "daysOverdue": 12.0,
                "isOverdue": 1.0,
                "isSent": 0.0,
                "isPartial": 0.0,
                "isPaid": 0.0,
                "isDisputed": 0.0,
                "disputeRisk": 0.1,
                "urgency": 0.5,
                "paymentProbability30d": 0.5,
                "paymentReliability": 0.6,
                "churnRisk": 0.2,
            },
        })
    assert predict_resp.status_code == 200
    body = predict_resp.json()
    assert "lift" in body
    assert "treatment_prob" in body
    assert "control_prob" in body
    assert "interval" in body
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ml-sidecar && python -m pytest tests/test_server.py::test_uplift_train_endpoint -v`
Expected: FAIL — endpoint doesn't exist.

- [ ] **Step 3: Add uplift endpoints to sidecar server**

In `services/ml-sidecar/src/server.py`, add:

```python
from .uplift import fit_uplift_model, predict_uplift, TrainedUpliftModel

# In-memory uplift model cache (keyed by tenant_id:action_class)
_uplift_models: dict[str, TrainedUpliftModel] = {}


@app.post("/uplift/train")
async def train_uplift(request: Request):
    """Train an uplift model from graded outcomes."""
    body = await request.json()
    tenant_id = body.get("tenant_id")
    action_class = body.get("action_class", "communicate.email")
    outcomes = body.get("outcomes", [])

    if not tenant_id or len(outcomes) < 30:
        return JSONResponse({"status": "insufficient_data", "model_id": None}, status_code=200)

    model = fit_uplift_model(
        outcomes,
        tenant_id=tenant_id,
        action_class=action_class,
    )

    if model is None:
        return JSONResponse({"status": "insufficient_data", "model_id": None}, status_code=200)

    cache_key = f"{tenant_id}:{action_class}"
    _uplift_models[cache_key] = model

    return JSONResponse({
        "status": "trained",
        "model_id": model.model_id,
        "treatment_samples": model.treatment_sample_count,
        "control_samples": model.control_sample_count,
        "observed_lift": model.observed_lift,
        "treatment_positive_rate": model.treatment_positive_rate,
        "control_positive_rate": model.control_positive_rate,
    })


@app.post("/uplift/predict")
async def predict_uplift_endpoint(request: Request):
    """Predict uplift for a single observation."""
    body = await request.json()
    tenant_id = body.get("tenant_id")
    action_class = body.get("action_class", "communicate.email")
    features = body.get("features", {})

    cache_key = f"{tenant_id}:{action_class}"
    model = _uplift_models.get(cache_key)

    if model is None:
        return JSONResponse({"error": "no_model", "lift": None}, status_code=200)

    result = predict_uplift(model, features)
    return JSONResponse(result)
```

- [ ] **Step 4: Run tests**

Run: `cd services/ml-sidecar && python -m pytest tests/test_server.py -v`
Expected: All tests PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add services/ml-sidecar/src/server.py services/ml-sidecar/tests/test_server.py
git commit -m "feat: add uplift train and predict sidecar endpoints"
```

---

## Task 3: Ensemble Uplift Shadow Mode

**Files:**
- Modify: `src/world-model/ensemble.ts`
- Create: `test/world-uplift-shadow.test.js`

- [ ] **Step 1: Write failing test for uplift shadow data in intervention response**

```js
// test/world-uplift-shadow.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

test('InterventionResult type includes optional upliftShadow field', async () => {
  const { estimateIntervention } = await import('../src/world-model/ensemble.ts');
  assert.equal(typeof estimateIntervention, 'function');

  // Type contract: an intervention result with shadow data
  const exampleWithShadow = {
    predictedEffect: [],
    defaultConfidence: 0.55,
    modelId: 'rule_inference',
    upliftShadow: {
      lift: 0.12,
      treatmentProb: 0.65,
      controlProb: 0.53,
      interval: { lower: 0.03, upper: 0.21, coverage: 0.9 },
      modelId: 'uplift_tlearner_communicate_email_v1',
      treatmentSamples: 80,
      controlSamples: 35,
    },
  };

  assert.ok(exampleWithShadow.upliftShadow);
  assert.equal(typeof exampleWithShadow.upliftShadow.lift, 'number');
  assert.ok(exampleWithShadow.upliftShadow.interval);
});
```

- [ ] **Step 2: Run test**

Run: `npx tsx --test test/world-uplift-shadow.test.js`
Expected: PASS (contract test).

- [ ] **Step 3: Add uplift shadow call to ensemble**

In `src/world-model/ensemble.ts`, add:

a) A new interface for uplift sidecar responses (near the other sidecar interfaces):

```ts
interface SidecarUpliftResponse {
  lift: number;
  treatment_prob: number;
  control_prob: number;
  interval: { lower: number; upper: number; coverage: number };
  model_id: string;
  treatment_samples: number;
  control_samples: number;
  observed_lift: number;
}
```

b) A function to call the uplift sidecar:

```ts
async function callUpliftSidecar(input: {
  tenantId: string;
  actionClass: string;
  features: Record<string, number>;
}): Promise<SidecarUpliftResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ML_SIDECAR_URL}/uplift/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        action_class: input.actionClass,
        features: input.features,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error || json.lift == null) return null;
    return json as SidecarUpliftResponse;
  } catch {
    return null;
  }
}
```

c) Add `upliftShadow` to the `InterventionResult` interface:

```ts
  upliftShadow?: {
    lift: number;
    treatmentProb: number;
    controlProb: number;
    interval: { lower: number; upper: number; coverage: number };
    modelId: string;
    treatmentSamples: number;
    controlSamples: number;
  } | null;
```

d) In the `estimateIntervention` function, after computing the main result but before returning, add a shadow uplift call. Find the return statement and add before it:

```ts
  // Shadow uplift: call uplift sidecar, log result, do NOT influence decision
  let upliftShadow: InterventionResult['upliftShadow'] = null;
  if (actionType?.externalEffect) {
    const estimated = (target?.estimated ?? {}) as Record<string, number>;
    const state = (target?.state ?? {}) as Record<string, unknown>;
    const features: Record<string, number> = {};
    for (const [key, val] of Object.entries(estimated)) {
      if (typeof val === 'number') features[key] = val;
    }
    if (typeof state.amountCents === 'number') features.amountCents = state.amountCents;

    const upliftResponse = await callUpliftSidecar({
      tenantId: request.tenantId,
      actionClass: request.actionClass,
      features,
    });

    if (upliftResponse) {
      upliftShadow = {
        lift: upliftResponse.lift,
        treatmentProb: upliftResponse.treatment_prob,
        controlProb: upliftResponse.control_prob,
        interval: upliftResponse.interval,
        modelId: upliftResponse.model_id,
        treatmentSamples: upliftResponse.treatment_samples,
        controlSamples: upliftResponse.control_samples,
      };
    }
  }
```

Then include `upliftShadow` in the returned object.

- [ ] **Step 4: Run tests**

Run: `npx tsx --test test/world-uplift-shadow.test.js`
Expected: PASS.

- [ ] **Step 5: Run existing ensemble/planner tests for no regression**

Run: `npx tsx --test test/world-planner-control.test.js`
Expected: All tests PASS. (The shadow call will fail silently in tests since no sidecar is running — which is correct behavior.)

- [ ] **Step 6: Commit**

```bash
git add src/world-model/ensemble.ts test/world-uplift-shadow.test.js
git commit -m "feat: add uplift shadow mode to ensemble intervention estimation"
```

---

## Task 4: Uplift Evaluation Artifact and Promotion Criteria

**Files:**
- Modify: `src/eval/evaluation-reports.ts`
- Create: `test/world-uplift-evaluation.test.js`

- [ ] **Step 1: Write test for uplift quality report**

```js
// test/world-uplift-evaluation.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

test('uplift evaluation report type contract', () => {
  // The uplift_quality report must carry these metrics
  const report = {
    reportType: 'uplift_quality',
    subjectType: 'uplift_model',
    subjectId: 'uplift_tlearner_communicate_email_v1',
    status: 'candidate',
    metrics: {
      treatmentSamples: 80,
      controlSamples: 35,
      observedLift: 0.15,
      modelLift: 0.12,
      liftStability: 0.85,
      confidenceIntervalWidth: 0.18,
      heuristicBaselineLift: 0.08,
      beatsHeuristic: true,
    },
    artifact: {
      assessment: {
        eligible: true,
        reason: 'Model lift exceeds heuristic baseline by 4pp with stable intervals',
        rolloutEligibility: 'eligible',
      },
    },
  };

  assert.equal(report.reportType, 'uplift_quality');
  assert.ok(report.metrics.treatmentSamples >= 30);
  assert.ok(report.metrics.controlSamples >= 15);
  assert.equal(typeof report.metrics.observedLift, 'number');
  assert.equal(typeof report.metrics.beatsHeuristic, 'boolean');
});
```

- [ ] **Step 2: Run test**

Run: `npx tsx --test test/world-uplift-evaluation.test.js`
Expected: PASS (contract test).

- [ ] **Step 3: Add uplift quality report upsert function**

In `src/eval/evaluation-reports.ts`, add a function following the pattern of the existing `upsertModelReleaseEvaluationReport`:

```ts
export async function upsertUpliftQualityEvaluationReport(
  pool: pg.Pool,
  tenantId: string,
  input: {
    modelId: string;
    actionClass: string;
    treatmentSamples: number;
    controlSamples: number;
    observedLift: number;
    modelLift: number;
    liftStability: number;
    confidenceIntervalWidth: number;
    heuristicBaselineLift: number;
  },
): Promise<{ reportId: string; status: string; eligible: boolean }> {
  const beatsHeuristic = input.modelLift > input.heuristicBaselineLift;
  const stableEnough = input.liftStability >= 0.7;
  const narrowEnough = input.confidenceIntervalWidth <= 0.30;
  const eligible = beatsHeuristic && stableEnough && narrowEnough;

  const status = eligible ? 'approved' : 'pending';
  const reason = !beatsHeuristic
    ? `Model lift ${input.modelLift.toFixed(3)} does not exceed heuristic baseline ${input.heuristicBaselineLift.toFixed(3)}`
    : !stableEnough
      ? `Lift stability ${input.liftStability.toFixed(2)} below threshold 0.70`
      : !narrowEnough
        ? `Confidence interval width ${input.confidenceIntervalWidth.toFixed(2)} exceeds threshold 0.30`
        : `Model lift exceeds heuristic baseline by ${((input.modelLift - input.heuristicBaselineLift) * 100).toFixed(0)}pp with stable intervals`;

  const reportId = ulid();
  await upsertEvaluationReport(pool, {
    reportId,
    tenantId,
    reportType: 'uplift_quality',
    subjectType: 'uplift_model',
    subjectId: input.modelId,
    status,
    schemaVersion: 1,
    metrics: {
      treatmentSamples: input.treatmentSamples,
      controlSamples: input.controlSamples,
      observedLift: input.observedLift,
      modelLift: input.modelLift,
      liftStability: input.liftStability,
      confidenceIntervalWidth: input.confidenceIntervalWidth,
      heuristicBaselineLift: input.heuristicBaselineLift,
      beatsHeuristic,
    },
    artifact: {
      assessment: {
        eligible,
        reason,
        rolloutEligibility: eligible ? 'eligible' : 'blocked',
      },
    },
  });

  return { reportId, status, eligible };
}
```

Note: `upsertEvaluationReport` and `ulid` are already available in the file.

- [ ] **Step 4: Write test verifying function exists**

Append to `test/world-uplift-evaluation.test.js`:

```js
test('upsertUpliftQualityEvaluationReport is exported', async () => {
  const { upsertUpliftQualityEvaluationReport } = await import('../src/eval/evaluation-reports.ts');
  assert.equal(typeof upsertUpliftQualityEvaluationReport, 'function');
});
```

- [ ] **Step 5: Run tests**

Run: `npx tsx --test test/world-uplift-evaluation.test.js`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/eval/evaluation-reports.ts test/world-uplift-evaluation.test.js
git commit -m "feat: add uplift quality evaluation report with promotion criteria"
```

---

## Task 5: Extract AR Objectives into Domain Pack (Seam 2/4)

**Files:**
- Create: `src/domains/ar/objectives.ts`
- Modify: `src/core/objectives-defaults.ts`
- Modify: `src/core/objectives.ts`
- Create: `test/world-ar-objectives-seam.test.js`

- [ ] **Step 1: Write seam regression test**

```js
// test/world-ar-objectives-seam.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('objectives-defaults.ts re-exports from domain pack', () => {
  const source = readFileSync('src/core/objectives-defaults.ts', 'utf8');
  assert.ok(
    source.includes("from '../domains/ar/objectives.js'") || source.includes("from '../domains/ar/objectives.ts'"),
    'objectives-defaults.ts must import from domain pack',
  );
});

test('AR domain pack exports objectives and constraints', async () => {
  const mod = await import('../src/domains/ar/objectives.ts');
  assert.ok(mod.DEFAULT_AR_OBJECTIVES, 'must export DEFAULT_AR_OBJECTIVES');
  assert.ok(mod.SUPPORTED_OBJECTIVE_CONSTRAINTS, 'must export SUPPORTED_OBJECTIVE_CONSTRAINTS');
  assert.ok(mod.createDefaultArObjectives, 'must export createDefaultArObjectives');

  assert.equal(mod.DEFAULT_AR_OBJECTIVES.length, 5);
  assert.equal(mod.SUPPORTED_OBJECTIVE_CONSTRAINTS.length, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/world-ar-objectives-seam.test.js`
Expected: FAIL — domain pack file doesn't exist.

- [ ] **Step 3: Create `src/domains/ar/objectives.ts`**

Move the content of `src/core/objectives-defaults.ts` into `src/domains/ar/objectives.ts`. The imports change to reference `../../core/objectives.js`:

```ts
// src/domains/ar/objectives.ts
//
// AR-specific objective definitions and constraint definitions.

import type { ObjectiveConstraintDefinition, TenantObjectives, WeightedObjective } from '../../core/objectives.js';

export const DEFAULT_AR_OBJECTIVES: WeightedObjective[] = [
  {
    id: 'cash_acceleration',
    name: 'Cash acceleration',
    metric: 'projected_collection_30d',
    weight: 0.4,
    direction: 'maximize',
  },
  {
    id: 'dispute_minimization',
    name: 'Dispute minimization',
    metric: 'dispute_rate',
    weight: 0.2,
    direction: 'minimize',
  },
  {
    id: 'churn_minimization',
    name: 'Churn minimization',
    metric: 'customer_attrition_risk',
    weight: 0.2,
    direction: 'minimize',
  },
  {
    id: 'review_load_minimization',
    name: 'Review load minimization',
    metric: 'approval_queue_load',
    weight: 0.1,
    direction: 'minimize',
  },
  {
    id: 'relationship_preservation',
    name: 'Relationship preservation',
    metric: 'customer_goodwill_risk',
    weight: 0.1,
    direction: 'minimize',
  },
];

export const SUPPORTED_OBJECTIVE_CONSTRAINTS: ObjectiveConstraintDefinition[] = [
  {
    id: 'no_active_dispute_outreach',
    name: 'No active dispute outreach',
    type: 'relationship',
    enforcement: 'deny',
    description: 'Customer outreach is blocked when the invoice is disputed or dispute signals are present.',
  },
  {
    id: 'require_primary_billing_contact',
    name: 'Require primary billing contact',
    type: 'relationship',
    enforcement: 'deny',
    description: 'External outreach requires a primary billing contact before the action can proceed.',
  },
  {
    id: 'high_value_escalates_to_approval',
    name: 'High-value approval gate',
    type: 'budget',
    enforcement: 'require_approval',
    description: 'Higher-value collections outreach must be reviewed by a human operator.',
  },
  {
    id: 'collections_outreach_cooldown',
    name: 'Collections outreach cooldown',
    type: 'timing',
    enforcement: 'require_approval',
    description: 'Repeated collections outreach inside the configured cooldown window requires human review.',
  },
  {
    id: 'outside_business_hours_requires_approval',
    name: 'Outside business hours review',
    type: 'timing',
    enforcement: 'require_approval',
    description: 'Customer outreach outside business hours must be reviewed by a human operator.',
  },
];

export function createDefaultArObjectives(tenantId: string): TenantObjectives {
  return {
    tenantId,
    objectives: DEFAULT_AR_OBJECTIVES.map((objective) => ({ ...objective })),
    constraints: SUPPORTED_OBJECTIVE_CONSTRAINTS.map(({ id }) => id),
  };
}
```

- [ ] **Step 4: Replace `src/core/objectives-defaults.ts` with re-export**

```ts
// src/core/objectives-defaults.ts
//
// Re-exports AR objectives from domain pack for backward compatibility.
// When domain #2 arrives, this file merges objectives from multiple packs.

export {
  DEFAULT_AR_OBJECTIVES,
  SUPPORTED_OBJECTIVE_CONSTRAINTS,
  createDefaultArObjectives,
} from '../domains/ar/objectives.js';
```

- [ ] **Step 5: Run seam test**

Run: `npx tsx --test test/world-ar-objectives-seam.test.js`
Expected: All tests PASS.

- [ ] **Step 6: Run existing objective-dependent tests**

Run: `npx tsx --test test/world-planner-control.test.js test/world-effect-tracker.test.js`
Expected: All tests PASS — no behavioral change.

- [ ] **Step 7: Commit**

```bash
git add src/domains/ar/objectives.ts src/core/objectives-defaults.ts test/world-ar-objectives-seam.test.js
git commit -m "refactor: extract AR objectives into src/domains/ar/objectives.ts (seam 2/4)"
```

---

## Task 6: Extract AR Scanner from Planner (Seam 3/4)

**Files:**
- Create: `src/domains/ar/scanner.ts`
- Modify: `src/planner/planner.ts`
- Create: `test/world-ar-scanner.test.js`

- [ ] **Step 1: Write seam test**

```js
// test/world-ar-scanner.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('planner.ts does not contain AR-specific invoice scanning logic', () => {
  const source = readFileSync('src/planner/planner.ts', 'utf8');

  // These strings indicate AR-specific scanning logic
  const arIndicators = [
    'Friendly reminder:',
    'Formal notice:',
    'Stage 1',
    'Stage 2',
    'Stage 3',
    'email_friendly',
    'email_formal',
    'task_escalation',
    'strategic_hold',
    'disputeRisk > 0.5',
    'daysOverdue > 30',
    'daysOverdue > 14',
  ];

  for (const indicator of arIndicators) {
    assert.equal(
      source.includes(indicator),
      false,
      `planner.ts must not contain AR-specific scanning indicator: "${indicator}". AR scanning belongs in src/domains/ar/scanner.ts`,
    );
  }
});

test('planner.ts imports scanner from domain pack', () => {
  const source = readFileSync('src/planner/planner.ts', 'utf8');
  assert.ok(
    source.includes("from '../domains/ar/scanner.js'") || source.includes("from '../domains/ar/scanner.ts'"),
    'planner.ts must import AR scanner from domain pack',
  );
});

test('AR scanner exports buildComparativeActionVariants', async () => {
  const mod = await import('../src/domains/ar/scanner.ts');
  assert.equal(typeof mod.buildComparativeActionVariants, 'function');
});

test('AR scanner exports inferCollectionsVariantId', async () => {
  const mod = await import('../src/domains/ar/scanner.ts');
  assert.equal(typeof mod.inferCollectionsVariantId, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/world-ar-scanner.test.js`
Expected: FAIL — planner still contains AR scanning logic.

- [ ] **Step 3: Create `src/domains/ar/scanner.ts`**

Extract these functions from `src/planner/planner.ts`:
- `inferCollectionsVariantId`
- `buildComparativeActionVariants`
- `transitionDelayDays`
- `nextSequenceOptions`

These are all AR-specific functions that know about email_friendly, email_formal, task_escalation, strategic_hold, and collections domain logic.

```ts
// src/domains/ar/scanner.ts
//
// AR-specific scanning, variant generation, and sequence logic.
// Extracted from planner.ts — the planner core calls these functions
// to get AR-specific candidates and transition rules.

import type { ComparativeReplayCandidate } from '../../planner/planner.js';

export function inferCollectionsVariantId(actionClass: string, daysOverdue: number): string | null {
  if (actionClass === 'strategic.hold') return 'strategic_hold';
  if (actionClass !== 'communicate.email') return null;
  return daysOverdue > 14 ? 'email_formal' : 'email_friendly';
}

export function buildComparativeActionVariants(
  amountCents: number,
  invoiceNumber: string,
  daysOverdue: number,
): Array<{ variantId: string; actionClass: string; description: string }> {
  return [
    {
      variantId: 'strategic_hold',
      actionClass: 'strategic.hold',
      description: `Strategic hold: Invoice ${invoiceNumber} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue, deliberate wait`,
    },
    {
      variantId: 'email_friendly',
      actionClass: 'communicate.email',
      description: `Friendly reminder: Invoice ${invoiceNumber} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
    },
    {
      variantId: 'email_formal',
      actionClass: 'communicate.email',
      description: `Formal notice: Invoice ${invoiceNumber} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
    },
    {
      variantId: 'task_escalation',
      actionClass: 'task.create',
      description: `Escalate: Invoice ${invoiceNumber} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
    },
  ];
}

export function transitionDelayDays(from: ComparativeReplayCandidate, to: ComparativeReplayCandidate): number {
  if (from.variantId === 'email_friendly' && to.variantId === 'email_formal') return 4;
  if (from.variantId === 'email_formal' && to.variantId === 'email_friendly') return 2;
  if (from.actionClass === 'communicate.email' && to.actionClass === 'task.create') return 3;
  return 2;
}

export function nextSequenceOptions(
  candidate: ComparativeReplayCandidate,
  candidates: ComparativeReplayCandidate[] | null,
  usedVariantIds: Set<string>,
): ComparativeReplayCandidate[] {
  if (!candidates?.length || candidate.actionClass === 'task.create') return [];
  return candidates.filter((option) =>
    !option.blocked
    && option.variantId !== candidate.variantId
    && !usedVariantIds.has(option.variantId)
    && (
      option.actionClass === 'task.create'
      || (candidate.actionClass === 'communicate.email' && option.actionClass === 'communicate.email')
    ),
  );
}

/**
 * Determine the AR collection stage and action class for an overdue invoice.
 */
export function determineCollectionAction(
  daysOverdue: number,
  disputeRisk: number,
  invoiceNumber: string,
  invoiceId: string,
  amountCents: number,
): { actionClass: string; description: string; reasoning: string; stage: number } {
  if (disputeRisk > 0.5) {
    return {
      actionClass: 'task.create',
      description: `Escalate: Invoice ${invoiceNumber || invoiceId} ($${(amountCents / 100).toFixed(2)}) — high dispute risk (${(disputeRisk * 100).toFixed(0)}%)`,
      reasoning: `Dispute risk ${(disputeRisk * 100).toFixed(0)}% exceeds threshold`,
      stage: 3,
    };
  }
  if (daysOverdue > 30) {
    return {
      actionClass: 'task.create',
      description: `Escalate: Invoice ${invoiceNumber || invoiceId} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
      reasoning: `${Math.round(daysOverdue)} days overdue (Stage 3)`,
      stage: 3,
    };
  }
  if (daysOverdue > 14) {
    return {
      actionClass: 'communicate.email',
      description: `Formal notice: Invoice ${invoiceNumber || invoiceId} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
      reasoning: `${Math.round(daysOverdue)} days overdue (Stage 2)`,
      stage: 2,
    };
  }
  return {
    actionClass: 'communicate.email',
    description: `Friendly reminder: Invoice ${invoiceNumber || invoiceId} ($${(amountCents / 100).toFixed(2)}) — ${Math.round(daysOverdue)} days overdue`,
    reasoning: `${Math.round(daysOverdue)} days overdue (Stage 1)`,
    stage: 1,
  };
}
```

- [ ] **Step 4: Update `src/planner/planner.ts` to import from scanner**

Remove `inferCollectionsVariantId`, `buildComparativeActionVariants`, `transitionDelayDays`, `nextSequenceOptions` from `planner.ts`. Replace with imports:

```ts
import {
  inferCollectionsVariantId,
  buildComparativeActionVariants,
  transitionDelayDays,
  nextSequenceOptions,
  determineCollectionAction,
} from '../domains/ar/scanner.js';
```

In `generateReactivePlan`, replace the inline stage-determination logic (the `if (disputeRisk > 0.5) ... else if (daysOverdue > 30) ...` block) with a call to `determineCollectionAction`:

```ts
    const { actionClass, description, reasoning: stageReasoning, stage } = determineCollectionAction(
      daysOverdue,
      disputeRisk,
      String(state.number ?? ''),
      invoice.id,
      amountCents,
    );
    const reasoning: string[] = [stageReasoning];
```

CRITICAL: This is a large refactor. Read planner.ts carefully to identify every usage of the extracted functions. The behavior must be identical. Run all tests after.

- [ ] **Step 5: Run seam test**

Run: `npx tsx --test test/world-ar-scanner.test.js`
Expected: All tests PASS.

- [ ] **Step 6: Run ALL existing tests for regression**

Run: `npx tsx --test test/world-planner-control.test.js test/world-strategic-hold.test.js test/world-portfolio-context.test.js test/world-action-registry.test.js test/world-domain-seam-regression.test.js`
Expected: All tests PASS.

- [ ] **Step 7: Verify readability test — planner core has no invoice knowledge**

Read `src/planner/planner.ts` and verify: no mentions of "Friendly reminder", "Formal notice", "email_friendly", "email_formal", "task_escalation", "strategic_hold", "Stage 1/2/3". All AR-specific logic lives in `src/domains/ar/scanner.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/domains/ar/scanner.ts src/planner/planner.ts test/world-ar-scanner.test.js
git commit -m "refactor: extract AR scanner into src/domains/ar/scanner.ts (seam 3/4)"
```

---

## Exit Criteria Verification

After all 6 tasks are complete, verify Phase 2 exit criteria:

- [ ] **Uplift model trained:** T-learner trains on graded outcomes with treatment/control separation. Tests pass with synthetic data.

- [ ] **Uplift sidecar endpoints live:** `/uplift/train` and `/uplift/predict` serve uplift predictions.

- [ ] **Shadow mode wired:** Ensemble calls uplift sidecar during intervention estimation, logs result as `upliftShadow`, does NOT influence decisions.

- [ ] **Uplift evaluation artifact:** `upsertUpliftQualityEvaluationReport` creates reports with promotion criteria (lift stability, interval width, beats heuristic).

- [ ] **AR objectives extracted (seam 2/4):** Objectives and constraints in `src/domains/ar/objectives.ts`. Core re-exports for backward compatibility.

- [ ] **AR scanner extracted (seam 3/4):** Variant generation, stage determination, and transition logic in `src/domains/ar/scanner.ts`. Planner core is readable without invoice knowledge.

- [ ] **No regression:** All existing tests pass.

Run full verification:
```bash
npx tsx --test test/world-action-registry.test.js test/world-strategic-hold.test.js test/world-portfolio-context.test.js test/world-outcome-graded-pipeline.test.js test/world-operator-scorecard.test.js test/world-planner-control.test.js test/world-effect-tracker.test.js test/world-domain-seam-regression.test.js test/world-uplift-shadow.test.js test/world-uplift-evaluation.test.js test/world-ar-objectives-seam.test.js test/world-ar-scanner.test.js
```

**Note on patience model:** Per spec, patience modeling is Phase 2 only if strategic hold data is sufficient (100+ hold outcomes). Since this is a new system without production hold data yet, patience modeling is deferred to Phase 3. This is documented, not a gap.
