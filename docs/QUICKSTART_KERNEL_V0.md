# Kernel v0 Quickstart (Local)

Goal: run the full “economic loop” locally and inspect artifacts (holdback, disputes, deterministic adjustments, replay-evaluate).

## 1) Start The Dev Stack

Recommended (one command):

```sh
./bin/settld.js dev up
```

Equivalent (manual):

```sh
docker compose --profile app up -d --build
docker compose --profile init run --rm minio-init
```

Defaults:

- API: `http://127.0.0.1:3000`
- tenant: `tenant_default`
- ops token: `tok_ops`

## 2) Run Kernel Conformance

This will exercise:

- tool-call holdback disputes (freeze maintenance tick, issue verdict, deterministic adjustment)
- marketplace run replay-evaluate (`/runs/:runId/settlement/replay-evaluate`)

```sh
./bin/settld.js conformance kernel --ops-token tok_ops --json-out /tmp/settld-kernel-v0-report.json
```

The runner prints `INFO ...` lines with `agreementHash` and `runId`.

## 3) Open Kernel Explorer

Open:

`http://127.0.0.1:3000/ops/kernel/workspace?opsToken=tok_ops`

Then paste the `agreementHash` from conformance into the “Tool Call Agreement” panel.

## 4) Verify Replay Evaluate

Use the `runId` printed by conformance:

```sh
curl -sS "http://127.0.0.1:3000/runs/<runId>/settlement/replay-evaluate" \
  -H "x-proxy-tenant-id: tenant_default" \
  -H "x-proxy-ops-token: tok_ops" | jq
```

## Shutdown

```sh
./bin/settld.js dev down
```

To wipe volumes (fresh DB + buckets):

```sh
./bin/settld.js dev down --wipe
```

