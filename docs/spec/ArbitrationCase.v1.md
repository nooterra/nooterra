# ArbitrationCase.v1

`ArbitrationCase.v1` defines the protocol object for a formal dispute arbitration case.

It is the canonical case container used by the arbitration layer to bind:

- the disputed run/settlement identifiers,
- participating parties and assigned arbiter,
- evidence references, and
- optional appeal lineage.

## Schema

See `schemas/ArbitrationCase.v1.schema.json`.

## Required fields

- `schemaVersion` (const: `ArbitrationCase.v1`)
- `caseId`
- `tenantId`
- `runId`
- `settlementId`
- `disputeId`
- `claimantAgentId`
- `respondentAgentId`
- `status` (`open|under_review|verdict_issued|closed`)
- `openedAt`
- `evidenceRefs` (deterministic, unique set)
- `revision`
- `createdAt`
- `updatedAt`

## Appeal references

Appeal lineage is represented with optional `appealRef`:

- `parentCaseId` (required when `appealRef` is present)
- `parentVerdictId` (optional)
- `reason` (optional summary)

This keeps appeal linkage explicit without mutating the parent case.

## Canonicalization and hashing

When hashed/signed by higher-level protocols:

- canonicalize JSON via RFC 8785 (JCS),
- hash canonical UTF-8 bytes using `sha256`,
- emit lowercase hex digests.
