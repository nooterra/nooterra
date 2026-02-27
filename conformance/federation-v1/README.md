# Federation Conformance Pack v1

This pack defines deterministic federation control-plane vectors for:

- envelope schema and protocol-version validation,
- namespace DID routing,
- trusted peer allowlist enforcement,
- replay-safe idempotency and immutable conflict handling.

## Files

- `vectors.json` - canonical conformance vectors and expected deterministic reason codes.

## Notes

- All failures are fail-closed.
- Namespace routing is exact DID match only.
- Replay for identical envelope hashes is accepted as deterministic duplicate; hash drift on same envelope identity is conflict.
