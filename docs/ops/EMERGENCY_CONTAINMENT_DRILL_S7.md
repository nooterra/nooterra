# Emergency Containment Drill (S7)

Objective: run a reproducible containment + recovery drill for compromised agents and signer keys, with machine-readable audit evidence.

## Command

```bash
BASE_URL=http://127.0.0.1:3000 \
OPS_TOKEN=ops_ci \
TENANT_ID=tenant_default \
EMERGENCY_CONTAINMENT_TARGET_MS=5000 \
EMERGENCY_RECOVERY_TARGET_MS=8000 \
EMERGENCY_SIGNER_REVOCATION_TARGET_MS=5000 \
node scripts/ci/run-emergency-containment-drill.mjs
```

## Output

- Report path: `artifacts/ops/emergency-containment-drill-summary.json`
- Report schema: `EmergencyContainmentDrillReport.v1`

## What It Verifies

- Compromised signer key revocation is enforced and bounded by target response window.
- Revoked signer cannot trigger emergency controls (fail-closed rejection).
- Agent-scope containment (`/ops/emergency/revoke`) activates and is reversible (`/ops/emergency/resume`) within configured windows.
- Tenant kill-switch containment (`/ops/emergency/kill-switch`) activates and is reversible (`/ops/emergency/resume`) within configured windows.
- Governance audit export is deterministic across repeated reads and includes containment action records.

## Required Artifact Checks

- `verdict.ok` must be `true`.
- `checks` must include successful:
  - `compromised_signer_revoked_within_target`
  - `revoked_signer_cannot_trigger_emergency_control`
  - `agent_containment_within_target`
  - `agent_recovery_within_target`
  - `killswitch_containment_within_target`
  - `killswitch_recovery_within_target`
  - `containment_actions_recorded_in_immutable_audit`
