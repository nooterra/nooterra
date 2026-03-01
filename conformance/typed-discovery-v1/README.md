# Typed Discovery Conformance Pack v1

This pack defines deterministic adversarial vectors for typed agent-card discovery behavior:

- malformed ToolDescriptor input fails closed with `SCHEMA_INVALID`,
- capability namespace spam / invalid URI input fails closed deterministically,
- invalid attestation reference selection is excluded fail-closed with explicit reason codes,
- typed filter ordering remains deterministic across reruns.

## Files

- `vectors.json` - canonical typed-discovery vectors and expected deterministic outcomes.
- `run.mjs` - standalone runner using local `createApi` runtime setup.

## Runner

```bash
node conformance/typed-discovery-v1/run.mjs
node conformance/typed-discovery-v1/run.mjs --list
node conformance/typed-discovery-v1/run.mjs --case malformed_tool_descriptor_input_schema_invalid
node conformance/typed-discovery-v1/run.mjs --json-out /tmp/typed-discovery-conformance-report.json
```

Report output:

- `schemaVersion`: `TypedDiscoveryConformanceRunReport.v1`
- `reportCore.schemaVersion`: `TypedDiscoveryConformanceRunReportCore.v1`
- deterministic `reportHash` binding over canonical `reportCore`
- per-case `checks`, `blockingIssues`, and verdict counts

## Notes

- Cases are executed against a local in-memory API runtime (`createApi`) with fixed deterministic time.
- `reportCore` excludes nondeterministic timestamps.
- All adversarial inputs are asserted fail-closed.
