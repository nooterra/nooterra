# GovernancePolicy.v1

This document is the **explicit contract** for signer authorization.

It exists so authorization is not inferred from “whatever code happens to do today”. A strict verifier MUST be able to load a policy, apply it deterministically, and fail with a crisp reason when the signer is not authorized.

## Status

`GovernancePolicy.v1` is a legacy/compat surface. In strict mode, verifiers require `GovernancePolicy.v2` (signed by a governance root trusted out-of-band).

## File location (bundles)

`governance/policy.json`

This file is included in the bundle manifest (i.e., it is part of the immutable payload), and it is intentionally **not** under `verify/**`.

## Schema

See `schemas/GovernancePolicy.v1.schema.json`.

## Semantics (v1)

- `algorithms` is a declared allowlist of acceptable signature algorithms for governed signatures. v1 supports `ed25519`.
- `verificationReportSigners` governs who may sign `verify/verification_report.json` (`VerificationReport.v1`) for each `subjectType` (e.g. `JobProofBundle.v1`).
- `bundleHeadAttestationSigners` governs who may sign `attestation/bundle_head_attestation.json` (`BundleHeadAttestation.v1`) for each `subjectType`.

Rule application:

- The verifier selects the rule whose `subjectType` matches the bundle being verified.
- `allowedKeyIds = null` means “no explicit key allowlist; any key that satisfies the other rule constraints may sign”.
- If `allowedKeyIds` is a non-null array, the signer key id MUST be present in that list.
- `allowedScopes` is enforced against the signed document’s declared signer scope (`global` vs `tenant`) when present.
- `requireGoverned = true` means the signer must be governed by the included governance streams (i.e., the key lifecycle is declared by governance events).
- `requiredPurpose = server` means the signer key must be a server signer key.
