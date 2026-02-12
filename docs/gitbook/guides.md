# Guides

Use these implementation patterns to move from local proof to production deployment.

## 1) Local kernel proof flow

Goal: prove end-to-end lifecycle quickly.

- Start stack
- Run conformance
- Inspect artifacts
- Export + verify closepack
- Replay-evaluate sample agreement

Start with: [Quickstart](./quickstart.md)

## 2) Build a paid capability

Goal: turn a capability into an enforceable paid call.

- generate capability template
- publish signed manifest
- integrate evidence emission
- set settlement terms (including holdback/challenge window)
- run conformance

## 3) Integrate with existing app/backend

Goal: embed Settld in current agent or API architecture.

- choose SDK (JS/Python) or raw API
- map your call lifecycle to agreement/evidence/decision stages
- persist returned artifact IDs for auditability
- run replay checks in ops workflows

## 4) Enable disputes and holdback controls

Goal: operationalize contested outcomes safely.

- require signer-bound dispute open envelope flows
- enforce challenge window constraints
- ensure open case blocks auto-release
- verify verdict-to-adjustment determinism

## 5) Release and audit workflow

Goal: ship with machine-checkable confidence.

- run tests + conformance
- produce release artifacts/checksums
- include closepack verify evidence in release packet

## Integration references

- `docs/integrations/README.md`
- `docs/integrations/github-actions.md`
- `docs/RELEASING.md`
- `docs/RELEASE_CHECKLIST.md`

## Ops and hosted maturity references

- `docs/ops/HOSTED_BASELINE_R2.md`
- `docs/ops/PAYMENTS_ALPHA_R5.md`
- `docs/ALERTS.md`
- `docs/SLO.md`
