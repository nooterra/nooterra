# HumanApprovalDecision.v1

`HumanApprovalDecision.v1` captures explicit human authorization for high-risk actions in simulation and personal-agent ecosystem workflows.

## Required fields

- `schemaVersion`: `NooterraHumanApprovalDecision.v1`
- `decisionId`: stable decision identifier
- `actionId`: action identifier
- `actionSha256`: canonical-hash binding for the approved action
- `decidedBy`: approver identity
- `decidedAt`: ISO-8601 timestamp
- `approved`: boolean

## Optional fields

- `expiresAt`: ISO-8601 timestamp
- `evidenceRefs[]`: evidence links (ticket IDs, policy references, runbook IDs)

## Fail-closed requirements

Implementations MUST reject or block execution when:

1. High-risk action has no decision.
2. Decision `schemaVersion` is unsupported.
3. `actionId` or `actionSha256` do not match the evaluated action.
4. Decision is denied (`approved: false`).
5. Decision is expired (`expiresAt` before evaluation time).
6. Strict-evidence mode is enabled and `evidenceRefs` is empty.

## Determinism requirements

- Action hash uses `sha256(canonical-json(action))`.
- Decision payload must be canonicalizable without lossy conversion.
- Re-evaluating the same action and decision pair must yield the same result.

