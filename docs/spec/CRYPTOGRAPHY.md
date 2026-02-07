# Cryptography Inventory (v1)

This document is an explicit inventory of cryptographic primitives and byte-level rules used by the protocol/toolchain.

## Canonicalization (JSON)

- **Standard**: RFC 8785 (JCS).
- **Bytes hashed for JSON objects**: UTF-8 bytes of the canonical JSON string.
- Spec: `CANONICAL_JSON.md`
- Implementations:
  - Verifier canonicalization: `packages/artifact-verify/src/canonical-json.js`
  - Bundler canonicalization: `src/core/canonical-json.js`

## Hashing

- **Algorithm**: SHA-256.
- **Encoding**: lowercase hex.
- **Manifest file hashing**: raw file bytes (no normalization).
  - Verifier: `packages/artifact-verify/src/hash-file.js`
- **JSON object hashing**: SHA-256 over UTF-8 bytes of RFC 8785 canonical JSON.
  - Verifier helper: `packages/artifact-verify/src/crypto.js`
  - Bundler helper: `src/core/crypto.js`

## Signatures

### Governance-root signatures

Used to sign governance policy (v2) and revocation lists.

- **Algorithm**: Ed25519.
- **Signed message**: the hex SHA-256 digest of canonical JSON (see above), passed as bytes to Ed25519 verification.
- Verifier implementation: `packages/artifact-verify/src/crypto.js:16`

### Event signer / server signer signatures

Used for:

- bundle head attestation (`attestation/bundle_head_attestation.json`)
- strict verification report (`verify/verification_report.json`)
- timestamp proofs (optional, when present)

Algorithm and verification semantics are the same: Ed25519 over the hash digest bytes.

## Key formats

- **Public keys**: PEM-encoded public keys stored as strings (for verification).
- **Private keys**: PEM-encoded private keys used only by bundlers/signers (not shipped in bundles).
- Key IDs: stable string identifiers (e.g., `key_…`) used as lookup keys in policy/trust maps.

## Algorithm agility stance (v1)

For v1 protocol objects, supported signature algorithms are intentionally narrow:

- Governance policy declares allowed algorithms (currently `ed25519`).
- Verifiers MUST reject signatures/policies requiring algorithms they do not implement.

Adding new algorithms is a protocol change and should be introduced via:

- new protocol object versions (preferred), or
- an explicit versioned policy expansion plus conformance pack updates.

