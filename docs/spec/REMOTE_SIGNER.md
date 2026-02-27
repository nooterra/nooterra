# Remote signer (tooling contract)

This document specifies the **RemoteSigner API** used by producer tooling (`nooterra-produce`) to obtain signatures without storing private keys on disk.

This is a tooling/config surface (not a bundle protocol object). Verifiers do not change: they still verify signatures using **public keys** and **trust anchors**.

## Goals

- Allow bundle production with **no private key material on disk** (CI-friendly).
- Ensure signing requests are **purpose-bound** (avoid turning the signer into a generic signing oracle).
- Keep requests deterministic and auditable via a stable request shape.

## Endpoints (v1)

### `GET /v1/public-key?keyId=<keyId>`

Return the public key PEM for the requested key id.

Response: `RemoteSignerPublicKeyResponse.v1` (see `docs/spec/schemas/RemoteSignerPublicKeyResponse.v1.schema.json`).

### `POST /v1/sign`

Sign the provided message bytes under a specific key and purpose.

Request: `RemoteSignerSignRequest.v1` (see `docs/spec/schemas/RemoteSignerSignRequest.v1.schema.json`).

Response: `RemoteSignerSignResponse.v1` (see `docs/spec/schemas/RemoteSignerSignResponse.v1.schema.json`).

## Purpose binding (required)

Remote signers **MUST** refuse signing requests with unknown `purpose` values.

Producer tools set `purpose` to one of:

- `event_payload`
- `governance_policy`
- `revocation_list`
- `timestamp_proof`
- `pricing_matrix`
- `bundle_head_attestation`
- `verification_report`
- `settlement_decision_report`

## Security notes

- The `messageBase64` value is **the exact bytes signed**. For Nooterra bundle objects this is typically `sha256(canonical_json)` represented as raw 32 bytes.
- Signers should log: `requestId`, `keyId`, `purpose`, and selected `context` fields for auditability.
- Remote signer endpoints should be protected with authentication/authorization (otherwise they are a signing oracle).

## Authentication (recommended)

For HTTP signers, producer tooling can attach a bearer token and custom headers:

- `--signer-auth bearer --signer-token-env NOOTERRA_SIGNER_TOKEN`
- `--signer-auth bearer --signer-token-file /path/to/token.txt`
- `--signer-header "X-Request-Source: ci"`

Tokens and secret header values are tooling-only; they must never be written into bundles or CLI JSON outputs.

## Local-process / stdio signers

Producer tooling also supports invoking a signer as a local process (no HTTP) where the signer reads a JSON request from stdin and prints JSON to stdout.

This mode is designed for CI environments where binding/listening to local sockets may be restricted, and for integrations where the signer itself talks to an HSM/KMS.

Note: some sandboxed CI environments disable piping stdin into child processes. The reference dev signer (`nooterra-signer-dev`) supports `--request-json-base64 <b64>` to avoid stdin piping in those environments.
