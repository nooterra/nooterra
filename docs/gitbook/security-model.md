# Security Model

Settld is designed to minimize trust assumptions in settlement outcomes.

## What Settld is built to protect

- tampering with recorded settlement artifacts
- ambiguous financial outcomes without explicit decision lineage
- unauthorized economic actions outside declared authority bounds
- silent drift between claimed and replayed decision outcomes

## Core security mechanisms

## 1) Signed artifacts + canonical hashing

Critical objects are signed and hash-bound to enforce integrity and replayability.

## 2) Authority-scoped execution

Authority grants constrain who can authorize spend and under which bounds.

## 3) Agreement/evidence binding

Agreement commitments (`callId`, `inputHash`, terms) must align with evidence and decision paths.

## 4) Deterministic/idempotent settlement effects

Deterministic IDs and uniqueness constraints prevent duplicate application of critical financial adjustments.

## 5) Dispute legitimacy

Dispute-open flows rely on explicit signer-bound envelopes for non-admin opens, reducing “server says so” risk.

## 6) Replay + offline verification

Replay-evaluate and closepack verification provide independent checks beyond dashboard/API trust.

## What Settld does not guarantee by itself

- business correctness beyond configured policy/verifier semantics
- safety after private key compromise
- immunity from bad policy design by operators
- legal/regulatory compliance by default in every jurisdiction

## Operational recommendations

- rotate keys and maintain signer inventory controls
- monitor replay mismatches and dispute queue lag as first-class alerts
- include closepack verification in release and incident workflows
- keep strict separation between test/demo tokens and production secrets

## Related references

- `SECURITY.md`
- `docs/THREAT_MODEL.md`
- `docs/spec/THREAT_MODEL.md`
- `docs/ALERTS.md`
- `docs/ONCALL_PLAYBOOK.md`
