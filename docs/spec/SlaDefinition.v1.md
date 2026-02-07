# SlaDefinition.v1

`SlaDefinition.v1` defines a deterministic, offline-evaluable set of SLA rules for a JobProof-derived job stream.

In ClosePack bundles, it is stored at `sla/sla_definition.json`.

## Rules (v1)

Rules are a bounded DSL; each rule has:

- `ruleId` — stable identifier (string).
- `kind` — one of:
  - `MUST_START_WITHIN_WINDOW`
  - `MAX_EXECUTION_MS`
  - `MAX_STALL_MS`
  - `PROOF_ZONE_COVERAGE_MIN_PCT`

Rule semantics are evaluated over:

- the embedded JobProof event stream (via the embedded Invoice bundle)
- the derived job state / proof result emitted in the stream (`PROOF_EVALUATED`), when present

No network fetches and no evidence bytes are required.

