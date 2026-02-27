# Federation Conformance Pack v1

This pack defines deterministic federation control-plane vectors for:

- envelope schema and protocol-version validation,
- namespace DID routing,
- trusted peer allowlist enforcement,
- replay-safe idempotency and immutable conflict handling.

## Files

- `vectors.json` - canonical conformance vectors and expected deterministic reason codes.
- `run.mjs` - standalone runner for policy/trust/routing/replay deterministic checks.

## Runner

```bash
node conformance/federation-v1/run.mjs
node conformance/federation-v1/run.mjs --list
node conformance/federation-v1/run.mjs --case invoke_replay_duplicate_deterministic
node conformance/federation-v1/run.mjs --json-out /tmp/federation-conformance-report.json
```

Report output:
- `schemaVersion`: `FederationConformanceRunReport.v1`
- `reportCore.schemaVersion`: `FederationConformanceRunReportCore.v1`
- deterministic `reportHash` binding over canonical `reportCore`
- per-case `checks`, `blockingIssues`, and verdict counts

## Notes

- All failures are fail-closed.
- Namespace routing is exact DID match only.
- Replay for identical envelope hashes is accepted as deterministic duplicate; hash drift on same envelope identity is conflict.
