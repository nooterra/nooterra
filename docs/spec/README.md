# Settld Protocol Specs

This directory freezes the **wire-format contracts** that Settld emits and verifies (bundles, manifests, attestations, and verification reports).

These specs are written so an independent implementer can build a verifier without reading Settld’s source.

## Canonicalization + hashing (global rules)

- **Canonical JSON**: JSON objects are canonicalized using RFC 8785 (JCS).
- **Hashing**: all hashes in these specs are `sha256` over UTF-8 bytes of canonical JSON (or raw file bytes, as specified), represented as lowercase hex.
- **Derived outputs**: bundle manifests intentionally **exclude** `verify/**` to avoid circular hashing; those files are verified out-of-band by signature and by binding to the `manifestHash`.

## Documents

- `CANONICAL_JSON.md` — canonical JSON rules used before hashing/signing.
- `ProofBundleManifest.v1.md` — JobProof/MonthProof manifest + hashing contract.
- `FinancePackBundleManifest.v1.md` — FinancePack manifest + hashing contract.
- `BundleHeadAttestation.v1.md` — signed head commitment for bundles.
- `GovernancePolicy.v1.md` — signer authorization policy (strict verification).
- `GovernancePolicy.v2.md` — signer authorization policy (signed by governance root).
- `RevocationList.v1.md` — prospective revocation/rotation list (signed by governance root).
- `TimestampProof.v1.md` — trustworthy signing time proof (for historical acceptance).
- `VerificationReport.v1.md` — signed, machine-ingestible strict verification report.
- `VerifyCliOutput.v1.md` — `settld-verify --format json` machine output contract.
- `WARNINGS.md` — warning codes (closed set) and semantics.
- `STRICTNESS.md` — strict vs non-strict verification contract.

## Schemas + examples

- `schemas/` contains JSON Schema for the on-disk JSON documents.
- `examples/` contains minimal example instances (illustrative, not authoritative vectors).
