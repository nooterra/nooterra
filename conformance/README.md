# Conformance packs

Conformance packs are **language-agnostic test oracles** for Nooterra verification.

They are intended for:

- external verifier implementations (Go/Rust/etc.)
- auditors and partners who want “no guessing” reproducibility
- internal release gating (prevent protocol drift)

## Packs

- `conformance/v1/` — first conformance pack for protocol `v1` objects.
- `conformance/session-v1/` — session replay/transcript interoperability pack for third-party runtime adapters (deterministic artifacts + fail-closed ACL denial vectors).
- `conformance/session-stream-v1/` — session inbox stream semantics interoperability pack (cursor conflict, fail-closed cursor invalid, watermark progression, reconnect dedupe).
- `conformance/intent-negotiation-v1/` — intent negotiation handshake interoperability pack (propose/counter/accept transcript, hash-required fail-closed checks, tamper detection for event and bound intent contract hashes).
- `conformance/federation-v1/` — federation namespace routing, trust boundary, and replay/conflict fail-closed vectors.
- `conformance/typed-discovery-v1/` — typed discovery fail-closed vectors (tool descriptor schema invalid, capability namespace adversarial input, attestation exclusion reason codes, deterministic typed ordering).
- `conformance/signer-lifecycle-v1/` — key lifecycle conformance vectors for deterministic `validAt`/`validNow` signer continuity decisions (including `KEY_CHAIN_GAP` and historical-valid/current-invalid behavior).

Publication tooling:

- `scripts/conformance/publish-session-conformance-cert.mjs` — emits normalized hash-bound report/cert/publication artifacts for `session-v1`.
- `scripts/conformance/publish-session-stream-conformance-cert.mjs` — emits normalized hash-bound report/cert/publication artifacts for `session-stream-v1`.

Both publication scripts support third-party adapter packaging flags:

- `--adapter-arg <arg>` (repeatable) and `--adapter-cwd <dir>` passthrough to pack runners.
- `--generated-at <iso-8601>` deterministic artifact timestamp override.
