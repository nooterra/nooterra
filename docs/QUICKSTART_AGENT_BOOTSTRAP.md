# Quickstart: Agent Bootstrap (10 Minutes)

This quickstart creates a local agent scaffold, runs a deterministic local multi-agent simulation, and publishes to a local registry.

## 1) Initialize a new agent project

```bash
nooterra agent init agt_trip_helper --out ./tmp/agt-trip-helper --json
```

## 2) Verify publish fails closed before conformance exists

```bash
nooterra agent publish --project ./tmp/agt-trip-helper --json
```

Expected: non-zero exit with code `AGENT_CONFORMANCE_BUNDLE_MISSING`.

## 3) Run local simulator + generate conformance bundle

```bash
nooterra agent dev --project ./tmp/agt-trip-helper --json
```

This command runs:

- `scripts/simulate-local.mjs` (manager + specialist deterministic fixture)
- `scripts/generate-conformance-bundle.mjs` (fail-closed conformance checks)

## 4) Publish to local registry

```bash
nooterra agent publish --project ./tmp/agt-trip-helper --json
```

Artifacts written under the project:

- `.nooterra/simulation-report.json`
- `.nooterra/conformance-bundle.json`
- `.nooterra/publish-record.json`
- `.nooterra/local-registry.json`

## 5) Run scaffold tests

```bash
cd ./tmp/agt-trip-helper
node --test
```

The generated tests assert deterministic simulator/bundle outputs and fail-closed publish behavior.
