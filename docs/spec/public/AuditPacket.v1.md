# AuditPacket.v1

`AuditPacket.v1` is the deterministic machine-readable report emitted with the audit packet zip export.

Runtime status: implemented.

## Artifact set

For packet version `v1`, release assets include:

- `nooterra-audit-packet-v1.zip`
- `nooterra-audit-packet-v1.zip.sha256`
- `nooterra-audit-packet-v1.report.json` (`AuditPacket.v1`)

## Required top-level fields

- `schemaVersion` (const: `AuditPacket.v1`)
- `generatedAt` (fixed deterministic timestamp for reproducible builds)
- `packet`
- `manifest`
- `metadata`
- `signing`

## `packet` object

- `name`
- `version`
- `zipPath`
- `zipSha256`
- `zipSha256Path`

`zipSha256` must match both the zip bytes and the checksum sidecar.

## `manifest` object (`AuditPacketManifest.v1`)

- `schemaVersion` (const: `AuditPacketManifest.v1`)
- `hashAlgorithm` (const: `sha256`)
- `canonicalization` (const: `RFC8785`)
- `rootPath`
- `entryCount`
- `manifestSha256`
- `entries[]`

Each manifest entry is:

- `path` (zip-relative path)
- `sha256` (hex)
- `sizeBytes` (integer)

Determinism and integrity requirements:

- `entries` sorted by `path` ascending (strict, no duplicates)
- `manifestSha256 = sha256(canonical-json(entries))`
- `entries[]` must exactly match zip file contents byte-for-byte

## `metadata` object (`AuditPacketMetadata.v1`)

`metadata` is the explicit signing payload for the report and includes packet identity, zip hashes, and tool provenance.

`signing.messageSha256` must equal `sha256(canonical-json(metadata))`.

## Optional metadata signing (explicit, fail-closed)

Signing is optional and environment-driven:

- `NOOTERRA_AUDIT_PACKET_METADATA_SIGN=1`
- `NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_PRIVATE_KEY_PEM`
- `NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_KEY_ID`
- `NOOTERRA_AUDIT_PACKET_METADATA_SIGNING_PURPOSE` (optional)

Fail-closed rules:

- signing inputs without explicit opt-in fail
- explicit opt-in with missing/invalid key material fails
- declared `signing.keyId` must match the key id derived from the signing key

When signing is enabled:

- `signing.requested = true`
- `signing.signed = true`
- `signing.algorithm = ed25519-sha256`
- `signing.signatureBase64` verifies against `signing.messageSha256`

When signing is disabled:

- `signing.requested = false`
- `signing.signed = false`
- signature-specific fields are `null`

## Verification path

Release validation enforces this contract via:

- `node scripts/release/validate-release-assets.mjs --dir <release-assets-dir> --release-trust <trust-file>`
