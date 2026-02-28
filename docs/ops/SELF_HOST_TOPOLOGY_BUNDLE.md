# Self-Host Topology Bundle

This document defines the self-host topology bundle path for NOO-208 slice 2.

## Purpose

Use the self-host compose bundle to stand up a deterministic local/self-managed topology and validate it with a machine-readable gate report before promotion.

Bundle artifacts:

- `deploy/compose/nooterra-self-host.topology.yml`
- `deploy/compose/self-host.env.example`

## Required env file flow

Create a dedicated self-host env file from the example:

```bash
cp deploy/compose/self-host.env.example .env.selfhost
```

Set required values in `.env.selfhost` before starting the topology.

`NOOTERRA_GATEWAY_API_KEY` must be pre-minted. Missing or empty key material is fail-closed for this path.

## Compose startup

Start the bundle with the explicit env file:

```bash
docker compose \
  --env-file .env.selfhost \
  -f deploy/compose/nooterra-self-host.topology.yml \
  up -d
```

## Gate verification

Run the self-host topology bundle gate:

```bash
npm run -s test:ops:self-host-topology-bundle-gate
```

Expected machine-readable report path:

`artifacts/gates/self-host-topology-bundle-gate.json`
