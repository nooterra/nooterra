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

## Metadata conventions

`metadata` is intentionally schemaless to allow subject-specific conventions.

### Tool-call disputes (Sprint 21)

For tool-call holdback disputes, `metadata` MUST include:

- `caseType`: `"tool_call"`
- `agreementHash`: sha256 hex (lowercase)
- `receiptHash`: sha256 hex (lowercase)
- `holdHash`: sha256 hex (lowercase)

These fields are used to:

- freeze holdback auto-release while the case is not closed, and
- bind deterministic adjustments to the disputed economic subject.

## Canonicalization and hashing

When hashed/signed by higher-level protocols:

- canonicalize JSON via RFC 8785 (JCS),
- hash canonical UTF-8 bytes using `sha256`,
- emit lowercase hex digests.
