# RemoteSignerRequest.v1 (tooling contract)

This document defines the **stdio wrapper** request shape for delegated signing.

It is a tooling contract used when invoking a signer as a local process (stdin/stdout). HTTP signers use the endpoint-specific request/response schemas referenced in `REMOTE_SIGNER.md`.

Schema: `docs/spec/schemas/RemoteSignerRequest.v1.schema.json`.

## Shape

- `schemaVersion` (optional): `"RemoteSignerRequest.v1"`
- `op`: `"publicKey"` or `"sign"`
- If `op === "publicKey"`:
  - `keyId`: string
- If `op === "sign"`:
  - `body`: `RemoteSignerSignRequest.v1`

## Determinism + safety

- Requests must be **purpose-bound** (see `RemoteSignerSignRequest.v1`).
- Producers must treat this as a pure signing oracle interface; secrets must never be embedded in bundles.
