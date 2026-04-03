# Sprint 1: Python ML Sidecar — Internal Engineering Spec

## What exists today

### Database tables (PostgreSQL, Railway)

**`world_predictions`**
- id, tenant_id, object_id, prediction_type, predicted_value, confidence, model_id, horizon, reasoning (jsonb), evidence (jsonb), calibration_score, predicted_at

**`world_prediction_outcomes`**
- prediction_id, tenant_id, object_id, prediction_type, outcome_value, outcome_at, calibration_error

### Current TypeScript code

**`src/world-model/calibration.ts`**
- `CalibrationTracker` computes MAE and `1 - MAE` as calibration score
- `recordPrediction()` writes to `world_predictions`
- `recordObjectOutcome()` writes to `world_prediction_outcomes`
- `getCalibrationReport()` returns MAE, bias, isCalibrated (score > 0.6 && outcomes >= 10)

**`src/world-model/ensemble.ts`**
- `predict()` returns hardcoded `confidence: 0.6` for all predictions
- `estimateIntervention()` uses `Math.min(1, currentPayProb + 0.15)` — literal magic number
- Prediction types: paymentProbability7d, paymentProbability30d, disputeRisk, churnRisk, urgency

**`src/state/estimator.ts`**
- `processEvents()` re-estimates affected objects when events arrive
- Calls rule-based inference for invoices and parties
- Persists beliefs and records predictions to calibration tracker
- Records outcomes when invoice status changes to paid/voided/disputed

### What's wrong

1. `confidence: 0.6` is hardcoded. It means nothing.
2. CalibrationTracker uses MAE which is not a proper calibration metric (no binning, no ECE).
3. `estimateIntervention()` uses magic numbers (+0.15 payment prob per email).
4. No prediction intervals. No drift detection. No OOD detection.

---

## What we're building

A Python HTTP service (`services/ml-sidecar/`) that connects to the same PostgreSQL database and provides:

1. **Conformal prediction intervals** (MAPIE)
2. **Post-hoc calibration** (temperature scaling + isotonic regression)
3. **Drift detection** (ADWIN via River)
4. **OOD detection** (feature distribution monitoring)

The TypeScript code calls the sidecar over HTTP. The sidecar reads from and writes to the same database tables.

---

## Architecture

```
                    ┌──────────────────┐
                    │  TypeScript      │
                    │  Runtime         │
                    │                  │
                    │  ensemble.ts     │──── HTTP ────┐
                    │  calibration.ts  │              │
                    │  estimator.ts    │              v
                    └──────────────────┘    ┌──────────────────┐
                             │             │  Python ML       │
                             │             │  Sidecar         │
                             │             │                  │
                             │             │  /predict        │
                             └─── PostgreSQL │  /calibrate     │
                                    │      │  /drift          │
                                    └──────│  /health         │
                                           └──────────────────┘
```

---

## File structure

```
services/ml-sidecar/
├── Dockerfile
├── requirements.txt
├── pyproject.toml
├── src/
│   ├── __init__.py
│   ├── server.py          # FastAPI app, routes
│   ├── db.py              # PostgreSQL connection (reads world_predictions, world_prediction_outcomes)
│   ├── conformal.py       # MAPIE wrapper — prediction intervals
│   ├── calibration.py     # Temperature scaling + isotonic regression
│   ├── drift.py           # ADWIN monitor per model per tenant
│   ├── ood.py             # Feature distribution monitoring (KL divergence)
│   └── models.py          # Pydantic models for request/response
├── tests/
│   ├── test_conformal.py
│   ├── test_calibration.py
│   ├── test_drift.py
│   └── test_ood.py
└── docker-compose.yml     # For local dev (connects to same Postgres)
```

---

## API Contract

### `POST /predict`

Called by `ensemble.ts` `predict()`. Takes a prediction request, returns enhanced prediction with conformal interval.

**Request:**
```json
{
  "tenant_id": "t_7f3a...",
  "object_id": "obj_123",
  "prediction_type": "paymentProbability7d",
  "features": {
    "amount_cents": 420000,
    "days_overdue": 14,
    "customer_total_invoices": 8,
    "customer_paid_on_time": 6,
    "last_contact_days_ago": 5,
    "mentioned_dispute": false,
    "mentioned_cash_flow": true
  }
}
```

**Response:**
```json
{
  "value": 0.34,
  "confidence": 0.82,
  "interval": {
    "lower": 0.22,
    "upper": 0.47,
    "coverage": 0.90
  },
  "model_id": "xgb_payment_7d_v1",
  "calibration": {
    "score": 0.78,
    "method": "isotonic",
    "ece": 0.04,
    "n_outcomes": 142
  },
  "drift": {
    "detected": false,
    "adwin_value": 0.02
  },
  "ood": {
    "in_distribution": true,
    "kl_divergence": 0.08
  }
}
```

### `POST /calibrate`

Refit calibration models for a given model_id and prediction_type. Called periodically or on demand.

**Request:**
```json
{
  "model_id": "rule_inference",
  "prediction_type": "paymentProbability7d",
  "tenant_id": "t_7f3a..."
}
```

**Response:**
```json
{
  "method": "isotonic",
  "ece_before": 0.12,
  "ece_after": 0.04,
  "n_samples": 142,
  "temperature": null
}
```

### `GET /drift/{tenant_id}`

Returns drift status for all models for a tenant.

**Response:**
```json
{
  "models": [
    {
      "model_id": "rule_inference",
      "prediction_type": "paymentProbability7d",
      "drift_detected": false,
      "adwin_value": 0.02,
      "last_checked": "2026-04-02T12:00:00Z"
    }
  ]
}
```

### `GET /health`

Health check.

---

## Task breakdown for parallel agents

### Task 1: Scaffold the Python service
**Files:** `services/ml-sidecar/` (everything except conformal.py, calibration.py, drift.py, ood.py)
**What to build:**
- FastAPI app with routes matching the API contract above
- PostgreSQL connection using asyncpg, reading DATABASE_URL from env
- `db.py` with functions: `get_predictions(tenant_id, model_id, prediction_type)`, `get_outcomes(tenant_id, model_id, prediction_type)`, `get_features(tenant_id, object_id)`
- Dockerfile (python:3.12-slim, pip install from requirements.txt)
- docker-compose.yml that connects to the existing Postgres
- requirements.txt: fastapi, uvicorn, asyncpg, numpy, scikit-learn, mapie, river, pydantic
- Pydantic models in models.py matching the API contract
- Health endpoint
- Basic tests that the server starts and responds to /health
**Does NOT depend on:** any other task
**Acceptance:** `docker compose up` starts the service, `curl localhost:8100/health` returns 200

### Task 2: MAPIE conformal prediction
**Files:** `services/ml-sidecar/src/conformal.py`, `tests/test_conformal.py`
**What to build:**
- Function `compute_intervals(predictions, outcomes, new_prediction, coverage=0.90)` that:
  - Takes historical (predicted_value, outcome_value) pairs from the DB
  - Fits a MAPIE MapieRegressor or MapieClassifier on them
  - Returns prediction interval [lower, upper] for the new prediction
  - Falls back to +/- 2*MAE if insufficient data (< 20 outcomes)
- Uses `sklearn.linear_model.LogisticRegression` as base estimator for probability targets
- Tests: verify coverage guarantee on synthetic data, verify fallback behavior
**Does NOT depend on:** Task 1 (can be developed and tested independently)
**Acceptance:** Given 100 synthetic prediction-outcome pairs, the 90% interval contains the true value at least 90% of the time

### Task 3: Calibration (temperature scaling + isotonic regression)
**Files:** `services/ml-sidecar/src/calibration.py`, `tests/test_calibration.py`
**What to build:**
- Function `fit_calibrator(predictions, outcomes)` that:
  - Fits both temperature scaling and isotonic regression
  - Computes ECE (Expected Calibration Error) for both
  - Returns the method with lower ECE
- Function `calibrate(raw_prediction, calibrator)` that applies the fitted calibrator
- Temperature scaling: learn scalar T that minimizes NLL on calibration set. `calibrated = sigmoid(logit(raw) / T)`
- Isotonic: `sklearn.isotonic.IsotonicRegression(out_of_bounds='clip')`
- ECE: 10-bin histogram, `sum(|bin_accuracy - bin_confidence| * bin_count / total)`
- Tests: verify ECE decreases after calibration on overconfident synthetic predictions
**Does NOT depend on:** Task 1
**Acceptance:** ECE on synthetic overconfident predictions drops by at least 50% after calibration

### Task 4: ADWIN drift detection
**Files:** `services/ml-sidecar/src/drift.py`, `tests/test_drift.py`
**What to build:**
- Class `DriftMonitor` that:
  - Maintains an ADWIN instance (from `river.drift`) per (model_id, prediction_type, tenant_id)
  - Processes new prediction-outcome pairs: `monitor.update(residual)` where residual = predicted - actual
  - Returns `drift_detected: bool` and `adwin_value: float`
  - Stores state in memory (rebuilt from DB on service restart)
- Function `check_all_models(tenant_id)` that queries recent outcomes and returns drift status per model
- Tests: feed stationary residuals (no drift), then inject mean shift, verify drift detected
**Does NOT depend on:** Task 1
**Acceptance:** Drift detected within 50 samples of a mean shift of 0.2 on synthetic data

### Task 5: OOD detection
**Files:** `services/ml-sidecar/src/ood.py`, `tests/test_ood.py`
**What to build:**
- Class `DistributionMonitor` that:
  - Stores training feature distributions as histograms (per feature, 50 bins)
  - Computes KL divergence between new feature vector and training distribution
  - Returns `in_distribution: bool` (KL < threshold) and `kl_divergence: float`
  - Threshold default: 0.5 (configurable)
- Function `fit_from_db(tenant_id, prediction_type)` that builds histograms from historical features
- Tests: in-distribution features return low KL, shifted features return high KL
**Does NOT depend on:** Task 1
**Acceptance:** KL divergence > 0.5 when feature distribution shifts by 2 standard deviations

### Task 6: Batch belief persistence (perf fix)
**Files:** `src/state/estimator.ts`, `src/state/beliefs.ts`, `src/world-model/calibration.ts`
**What to fix:**
- `persistDerivedBeliefs()` in `estimator.ts:32` loops through beliefs calling `persistBelief()` and `recordPrediction()` one at a time. N beliefs = 2N DB round trips. Under load this thrashes the connection pool.
- Refactor to batch: collect all beliefs into arrays, then do a single `INSERT INTO world_beliefs ... VALUES ($1), ($2), ...` and a single `INSERT INTO world_predictions ... VALUES ($1), ($2), ...`
- Same fix for `persistObservedOutcomes()` which does up to 3 individual `recordObjectOutcome()` calls per invoice.
- Add helper: `batchRecordPredictions(pool, predictions[])` and `batchPersistBeliefs(pool, tenantId, beliefs[])`
- Tests: verify batch produces identical DB state as sequential. Verify N beliefs = 2 queries (not 2N).
**Does NOT depend on:** any other task
**Acceptance:** `persistDerivedBeliefs` for 50 beliefs makes 2 DB queries, not 100. All existing tests pass.

### Task 7: TypeScript integration
**Files:** `src/world-model/ensemble.ts`, `src/world-model/calibration.ts`, `src/state/estimator.ts`
**What to change:**
- Add `ML_SIDECAR_URL` env var (default: `http://localhost:8100`)
- In `ensemble.ts` `predict()`: call `POST /predict` on the sidecar. If sidecar is unavailable, fall back to current behavior (hardcoded confidence: 0.6). Add `interval` field to `PredictionResult`.
- In `ensemble.ts` `estimateIntervention()`: call sidecar for causal estimates when available. Fall back to current heuristics if unavailable.
- Update `PredictionResult` interface:
  ```typescript
  interface PredictionResult {
    objectId: string;
    predictionType: string;
    value: number;
    confidence: number;
    interval?: { lower: number; upper: number; coverage: number };
    modelId: string;
    reasoning: string[];
    calibrationScore: number;
    driftDetected?: boolean;
    inDistribution?: boolean;
  }
  ```
- Add new test: verify fallback works when sidecar is down
**Depends on:** Task 1 (needs the API contract finalized)
**Acceptance:** When sidecar is running, predictions include intervals. When sidecar is down, existing behavior is unchanged. All 253 existing tests still pass.

---

## Integration test

After all tasks are complete:

1. Start PostgreSQL (local or Railway)
2. Start the ML sidecar: `cd services/ml-sidecar && docker compose up`
3. Start the TypeScript runtime: `npm run dev`
4. Trigger a Stripe webhook (invoice.payment_failed)
5. Verify:
   - Event recorded in ledger
   - Object graph updated
   - Prediction returned with interval (not just hardcoded 0.6)
   - Drift status available at GET /drift/{tenant_id}
   - Calibration report shows ECE

---

## Agent assignment plan

| Task | Agent | Isolation | Est. time |
|------|-------|-----------|-----------|
| Task 1: Scaffold | Claude Code subagent (worktree) | Yes | 1-2 hours |
| Task 2: MAPIE | Claude Code subagent (worktree) | Yes | 1-2 hours |
| Task 3: Calibration | Claude Code subagent (worktree) | Yes | 1-2 hours |
| Task 4: ADWIN | Claude Code subagent (worktree) | Yes | 1 hour |
| Task 5: OOD | Claude Code subagent (worktree) | Yes | 1 hour |
| Task 6: Batch perf fix | Claude Code subagent (worktree) | Yes | 1 hour |
| Task 7: TS integration | Main Claude Code session | No (touches existing files) | 1-2 hours |

Tasks 1-6 run in parallel. Task 7 runs after Task 1 is merged (needs the API contract).

Tasks 2-5 are pure Python with no dependencies on the rest of the codebase. They can be developed and tested in complete isolation. Each produces a single .py file and a test file.

Task 1 creates the service scaffold that Tasks 2-5 plug into.
Task 6 wires everything together in the TypeScript codebase.

---

## Environment variables

```
ML_SIDECAR_URL=http://localhost:8100    # TypeScript runtime uses this
DATABASE_URL=postgresql://...            # Same Postgres as the main app
ML_SIDECAR_PORT=8100                     # Python service listens on this
```

---

## Definition of done

- [ ] Python service starts and responds to /health
- [ ] /predict returns intervals with coverage guarantee
- [ ] /calibrate reduces ECE on test data
- [ ] /drift detects distribution shift on synthetic data
- [ ] OOD detection flags shifted feature distributions
- [ ] TypeScript ensemble.ts calls sidecar when available, falls back when not
- [ ] All 253 existing TypeScript tests pass
- [ ] Python tests pass (pytest)
- [ ] Docker Compose starts the full stack locally
