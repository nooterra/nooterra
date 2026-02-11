# ToolManifest.v1

`ToolManifest.v1` describes a payable capability (a tool) as a signed, portable contract that can be pinned by hash.

This object is intentionally small: it exists to make third-party discovery and replay possible without “server configuration context”.

## Fields

Required:

- `schemaVersion` (const: `ToolManifest.v1`)
- `toolId` (string; stable identifier)
- `toolVersion` (string; SemVer)
- `endpoints[]` (non-empty array)
  - `kind` (const: `http`)
  - `baseUrl` (string)
  - `callPath` (string)
  - `manifestPath` (string)
- `inputSchemaHash` (sha256 hex; hash of the canonical JSON input schema)
- `outputSchemaHash` (sha256 hex; hash of the canonical JSON output schema)
- `createdAt` (ISO 8601)
- `signature` (required)
  - `algorithm` (const: `ed25519`)
  - `signerKeyId` (string)
  - `manifestHash` (sha256 hex)
  - `signature` (base64)
  - `signerPublicKeyPem` (optional; PEM string)

Optional:

- `verifierHints` (object or `null`): non-binding hints for consumers about how to evaluate/verify outputs (e.g. deterministic verifier).

## Canonicalization + hashing

1. Canonicalize using RFC 8785 (JCS).
2. The `manifestHash` is `sha256` over UTF-8 bytes of canonical JSON of the **manifest core**:
   - the full `ToolManifest.v1` object **excluding** the `signature` field.

## Signing

- The `signature.signature` value is an Ed25519 signature over `manifestHash` (the hex hash string), using the private key corresponding to `signerKeyId`.
- Consumers may verify using `signature.signerPublicKeyPem` when present, or via an external key registry for `signerKeyId`.

## Schema

See `docs/spec/schemas/ToolManifest.v1.schema.json`.

