# Conformance packs

Conformance packs are **language-agnostic test oracles** for Nooterra verification.

They are intended for:

- external verifier implementations (Go/Rust/etc.)
- auditors and partners who want “no guessing” reproducibility
- internal release gating (prevent protocol drift)

## Packs

- `conformance/v1/` — first conformance pack for protocol `v1` objects.
- `conformance/session-v1/` — session replay/transcript interoperability pack for third-party runtime adapters.
- `conformance/session-stream-v1/` — session inbox stream semantics interoperability pack (cursor conflict, fail-closed cursor invalid, watermark progression, reconnect dedupe).
