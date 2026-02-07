# RemoteSignerResponse.v1 (tooling contract)

This document defines the **stdio wrapper** response shape for delegated signing.

Schema: `docs/spec/schemas/RemoteSignerResponse.v1.schema.json`.

## Shape

- A `RemoteSignerResponse.v1` is one of:
  - `RemoteSignerPublicKeyResponse.v1` (for `op=publicKey` requests)
  - `RemoteSignerSignResponse.v1` (for `op=sign` requests)

## Notes

- Stdio signers should return a non-zero exit code on failure and write a concise error to stderr.
- Producers must not depend on stderr text for behavior; only structured JSON should be treated as a stable contract.
