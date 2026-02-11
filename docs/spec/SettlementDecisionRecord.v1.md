# SettlementDecisionRecord.v1

`SettlementDecisionRecord.v1` is the canonical decision artifact for an `AgentRunSettlement.v1` state transition.

It binds one settlement decision to:

- the settlement principal (`settlementId`, `runId`, `tenantId`),
- the governing policy/verifier references,
- and the execution lineage (`runLastEventId`, `runLastChainHash`, `resolutionEventId`).

## Purpose

- make settlement decisions replayable and attributable;
- bind payout/refund decisions to specific run/settlement lineage;
- provide a stable hash (`decisionHash`) for downstream receipt binding.

## Required fields

- `schemaVersion` (const: `SettlementDecisionRecord.v1`)
- `decisionId`
- `tenantId`
- `runId`
- `settlementId`
- `decisionStatus`
- `decisionMode`
- `policyRef`
- `verifierRef`
- `workRef`
- `decidedAt`
- `decisionHash`

Optional fields:

- `agreementId`
- `decisionReason`
- `verificationStatus`

## Canonicalization and hashing

`decisionHash` is computed over canonical JSON after removing `decisionHash` from the object:

1. canonicalize JSON with RFC 8785 (JCS),
2. hash canonical UTF-8 bytes using `sha256`,
3. encode as lowercase hex.

## Schema

See `schemas/SettlementDecisionRecord.v1.schema.json`.
