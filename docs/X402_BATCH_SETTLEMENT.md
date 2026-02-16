# X402 Batch Settlement Worker

This worker creates deterministic provider payout batches from paid MCP/x402 demo artifacts.

## Purpose

- Aggregate released x402 gates by provider and currency.
- Emit deterministic payout manifests and per-provider batch files.
- Persist idempotency state so reruns do not double-settle the same gate.

This is intentionally artifact-driven in Sprint 3 so it can run locally without live payout rails.

## Inputs

1. Artifact root with run directories (default `artifacts/mcp-paid-exa`).
2. Provider payout registry (`X402ProviderPayoutRegistry.v1`).
3. Worker state file (`X402BatchWorkerState.v1`).

Registry example: `docs/examples/x402-provider-payout-registry.example.json`

## Run

```bash
npm run settlement:x402:batch -- \
  --artifact-root artifacts/mcp-paid-exa \
  --registry docs/examples/x402-provider-payout-registry.example.json
```

Dry run (no state mutation):

```bash
npm run settlement:x402:batch -- \
  --artifact-root artifacts/mcp-paid-exa \
  --registry docs/examples/x402-provider-payout-registry.example.json \
  --dry-run
```

## Outputs

Each run writes:

- `payout-manifest.json`
- `payout-manifest.meta.json` (`manifestHash` + optional signature)
- `batches/<batchId>.json` for each provider batch

Default output root:

`artifacts/settlement/x402-batches/<timestamp>/`

## Idempotency

State file tracks processed gates by `gateId`:

- first run: eligible released gates are batched and recorded
- subsequent runs: previously processed gates are skipped

State path default:

`artifacts/settlement/x402-batch-state.json`

## Optional manifest signing

Set both env vars:

- `SETTLD_BATCH_SIGNER_PUBLIC_KEY_PEM`
- `SETTLD_BATCH_SIGNER_PRIVATE_KEY_PEM`

If present, the worker adds an Ed25519 signature to `payout-manifest.meta.json`.
