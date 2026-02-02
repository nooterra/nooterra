# GovernancePolicy.v2

This document is the **explicit contract** for signer authorization in strict verification, with a mandatory governance-root signature.

## File location (bundles)

`governance/policy.json`

This file is included in the bundle manifest (i.e., it is part of the immutable payload), and it is intentionally **not** under `verify/**`.

## Schema

See `schemas/GovernancePolicy.v2.schema.json`.

## Semantics (v2)

`GovernancePolicy.v2` is the same conceptual policy as v1, but with two critical hardenings:

1. `allowedKeyIds` is an explicit allowlist (not nullable). Strict verification relies on explicit authorization, not “any governed key”.
2. The policy is signed by a governance root key (trusted out-of-band by the verifier).

The policy also binds to a `RevocationList.v1` snapshot via `revocationList.sha256`.

## Signing + trust (strict verification)

Strict verification MUST:

- verify `policyHash` and `signature`, and
- require `signerKeyId` to be trusted out-of-band as a governance root key.

