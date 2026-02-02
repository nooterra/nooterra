# RevocationList.v1

This document provides **prospective** revocation and rotation semantics for signer keys, while preserving historical acceptance when a verifier can prove the signing time.

## File location (bundles)

`governance/revocations.json`

This file is included in the bundle manifest (i.e., it is part of the immutable payload), and it is intentionally **not** under `verify/**`.

## Schema

See `schemas/RevocationList.v1.schema.json`.

## Semantics (v1)

- `revocations[]` declares a key as revoked at `revokedAt`.
- `rotations[]` declares that an old key is superseded at `rotatedAt` and a new key becomes valid from that time.

Strict verification rule:

- A key revoked at time **T** is NOT acceptable for signatures made at or after **T**.
- A signature made before **T** remains acceptable **only if** the bundle contains a trustworthy signing time for that signature (see `TimestampProof.v1`).

## Signing + trust (strict verification)

`RevocationList.v1` is signed by a governance root key (trusted out-of-band by the verifier).

