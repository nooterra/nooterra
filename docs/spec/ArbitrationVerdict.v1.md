# ArbitrationVerdict.v1

`ArbitrationVerdict.v1` defines the signed verdict artifact for an `ArbitrationCase.v1`.

It records deterministic decision output from an arbiter, including:

- final outcome (`accepted|rejected|partial`),
- settlement release partition hint (`releaseRatePct`),
- rationale and cited evidence references,
- signature material, and
- optional appeal linkage.

## Schema

See `schemas/ArbitrationVerdict.v1.schema.json`.

## Required fields

- `schemaVersion` (const: `ArbitrationVerdict.v1`)
- `verdictId`
- `caseId`
- `tenantId`
- `runId`
- `settlementId`
- `disputeId`
- `arbiterAgentId`
- `outcome` (`accepted|rejected|partial`)
- `releaseRatePct` (integer `0..100`)
- `rationale`
- `evidenceRefs`
- `issuedAt`
- `signature` (deterministic signing envelope)
- `revision`
- `createdAt`
- `updatedAt`

## Signature envelope

`signature` includes:

- `algorithm` (`ed25519`)
- `signerKeyId`
- `verdictHash` (hash of canonical verdict core)
- `signature` (base64 signature)

## Appeal references

If this verdict participates in an appeal chain, include optional `appealRef`:

- `appealCaseId`
- `parentVerdictId`
- `reason` (optional)

## Canonicalization and hashing

When hashed/signed by higher-level protocols:

- canonicalize JSON via RFC 8785 (JCS),
- hash canonical UTF-8 bytes using `sha256`,
- emit lowercase hex digests.
