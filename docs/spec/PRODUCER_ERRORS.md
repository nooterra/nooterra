# Producer error codes (tooling contract)

These error codes are emitted by producer tooling such as `settld-produce` and `settld-trust` when generating bundles or initializing trust material.

These codes are a tooling/API surface (not protocol v1 bundle objects). Meanings are stable within major versions.

Canonical list: `docs/spec/producer-error-codes.v1.txt`.

## Safe details (`causeKind` / `causeCode`)

Producer machine output (`settld-produce --format json`) may include:

- `causeKind`: coarse category (`signer` | `plugin` | `verify` | `input` | `io` | `internal`)
- `causeCode`: stable internal failure class code (never raw exception text)

`causeCode` is best-effort and is intended for support triage, not strict automation.

## Codes

### `PRODUCE_FAILED`
Catch-all failure when a more specific code is not available.

### Signer/auth

- `SIGNER_AUTH_MISSING` — remote signer auth configured but token missing.
- `SIGNER_AUTH_FAILED` — remote signer returned 401/403.
- `SIGNER_TIMEOUT` — signer call timed out (HTTP or process).
- `SIGNER_UNREACHABLE` — signer could not be reached (network failure).
- `SIGNER_BAD_RESPONSE` — signer returned invalid JSON or missing required fields.
- `SIGNER_MESSAGE_TOO_LARGE` — signing request message exceeds max size.
- `SIGNER_RESPONSE_TOO_LARGE` — signer response exceeds max size.

### Plugin signer

- `SIGNER_PLUGIN_LOAD_FAILED` — plugin module could not be imported.
- `SIGNER_PLUGIN_MISSING_EXPORT` — requested export was missing.
- `SIGNER_PLUGIN_INIT_FAILED` — plugin factory threw during initialization.
- `SIGNER_PLUGIN_INVALID_PROVIDER` — plugin returned an invalid provider object.

### Post-produce verification

- `VERIFY_AFTER_FAILED` — `--verify-after` failed.
