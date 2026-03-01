# Serving Modes Boundary

This document defines the operational contract for `hosted`, `self-host`, and `local-dev` serving modes.

Normative machine-readable policy:

- `docs/kernel-compatible/serving-mode-boundary-policy.json` (`NooterraServingModeBoundaryPolicy.v1`)

## 1) Boundary rules (fail-closed)

1. `servingMode` must be explicitly declared as one of: `hosted`, `self-host`, `local-dev`.
2. Runtime/evidence must match the declared mode; mismatch is fail-closed.
3. Hosted UI/control plane is never the only judge; verification must be reproducible offline with explicit trust anchors.
4. `local-dev` is non-production only (no customer traffic, no production cutover decisions).

## 2) Trust boundary by mode

| Mode | Operator trust boundary | Customer traffic | Production cutover authority | Core trust claim |
|---|---|---|---|---|
| `hosted` | Nooterra operates control plane/runtime | Allowed | Allowed with hosted gates | Hosted output must replay/verify offline |
| `self-host` | Customer operates control plane/runtime | Allowed | Allowed with self-host gates | Customer runtime must preserve deterministic evidence + replayability |
| `local-dev` | Single developer workstation/runtime | Forbidden | Forbidden | Developer loop only; no production trust assertions |

## 3) Mode contracts

### `hosted`

Required runtime set:

- `nooterra-api`, `nooterra-magic-link`, `nooterra-maintenance`, `postgres`, `x402-gateway`, paid upstream tool API

Required evidence/gates:

- `HostedBaselineEvidence.v1`
- `ProductionCutoverGateReport.v1`

Fail-closed mismatch reason code families:

- `SERVING_MODE_HOSTED_*_REQUIRED`
- `SERVING_MODE_HOSTED_*_MISMATCH`

### `self-host`

Required runtime set (customer-operated):

- `nooterra-api`, `nooterra-magic-link`, `nooterra-maintenance`, `postgres`, `x402-gateway`, paid upstream tool API

Required evidence/gates:

- `SelfHostTopologyBundleGateReport.v1`
- `SelfHostUpgradeMigrationGateReport.v1`

Fail-closed mismatch reason code families:

- `SERVING_MODE_SELF_HOST_*_REQUIRED`
- `SERVING_MODE_SELF_HOST_*_MISMATCH`

### `local-dev`

Allowed scope:

- local testing, deterministic fixture generation, targeted development checks

Forbidden scope:

- customer traffic
- production cutover/release promotion decisions

Fail-closed mismatch reason code families:

- `SERVING_MODE_LOCAL_DEV_*_REQUIRED`
- `SERVING_MODE_LOCAL_DEV_*_MISMATCH`
- `SERVING_MODE_LOCAL_DEV_*_FORBIDDEN`

## 4) Parity matrix

| Control | `hosted` | `self-host` | `local-dev` | Primary artifact/runbook |
|---|---|---|---|---|
| Kernel conformance | Required | Required | Required | `./bin/nooterra.js conformance kernel --ops-token <token>` |
| Offline verify reproducibility | Required | Required | Required | closepack export + verify |
| Hosted baseline evidence | Required | N/A | N/A | `docs/ops/HOSTED_BASELINE_R2.md` |
| Self-host topology bundle gate | N/A | Required | N/A | `docs/ops/SELF_HOST_TOPOLOGY_BUNDLE.md` |
| Self-host upgrade/migration gate | N/A | Required | N/A | `docs/ops/SELF_HOST_UPGRADE_MIGRATION_PLAYBOOK.md` |
| Paid/high-risk customer traffic | Required | Required | Forbidden | production cutover gates |

## 5) Operational use

- Use `docs/DEVELOPMENT.md` for `local-dev` only.
- Use `docs/ops/MINIMUM_PRODUCTION_TOPOLOGY.md` for hosted/self-host production topology.
- If declared mode and evidence disagree, block promotion/deployment (fail-closed) and emit the policy reason codes.
