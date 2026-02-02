# TimestampProof.v1

This document defines a **trustworthy signing time** proof that can be embedded inside signed protocol documents (e.g. `BundleHeadAttestation.v1` and `VerificationReport.v1`).

## Semantics

`TimestampProof.v1` is an **independent attestation of time** over a specific message hash. It exists so strict verification can support “historical acceptance” under prospective revocation rules without trusting a signer-controlled timestamp field.

v1 supports one proof kind:

- `kind = "ed25519_time_authority"` — an Ed25519 signature by a trusted time authority key.

Fields:

- `timestamp`: the asserted timestamp (RFC3339 / ISO string).
- `messageHash`: `sha256` hex of the canonical JSON bytes of the signed document’s **core payload**, computed **without** the `timestampProof` field.
- `signerKeyId` / `signature`: the time authority signature.

## Trust model (strict verification)

Strict verification MUST treat the time as trustworthy only if:

- the proof verifies cryptographically, and
- the proof’s signer key is trusted out-of-band by the verifier (a “time authority” trust anchor).

