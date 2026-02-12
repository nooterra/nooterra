# Quickstart

This guide gets you from zero to a verified Kernel v0 flow quickly.

## Prerequisites

- Node.js 20+
- Docker Desktop / Docker Engine running
- Network access to pull images and install packages

## Path A: Installed CLI (recommended)

```bash
npx settld dev up
npx settld init capability my-capability
npx settld conformance kernel --ops-token tok_ops --json-out /tmp/kernel-report.json
```

## Path B: From repo checkout

```bash
./bin/settld.js dev up
./bin/settld.js init capability my-capability
./bin/settld.js conformance kernel --ops-token tok_ops --json-out /tmp/kernel-report.json
```

## Verify result

You should see conformance success output and a JSON report at:

- `/tmp/kernel-report.json`

## Export + verify offline

Use a known agreement hash from your run:

```bash
npx settld closepack export --agreement-hash <agreementHash> --out closepack.zip
npx settld closepack verify closepack.zip --json-out /tmp/closepack-verify.json
```

or from repo:

```bash
./bin/settld.js closepack export --agreement-hash <agreementHash> --out closepack.zip
./bin/settld.js closepack verify closepack.zip --json-out /tmp/closepack-verify.json
```

## Replay-evaluate check

For local API default:

```bash
curl -s "http://127.0.0.1:3000/ops/tool-calls/replay-evaluate?agreementHash=<agreementHash>" \
  -H "x-proxy-ops-token: tok_ops" | jq .
```

Expected: replay comparison fields indicate match/consistency.

## Common errors

### Docker not found

If CLI says docker is missing, install/start Docker and retry `dev up`.

### Node version too low

If CLI warns about engines, upgrade to Node 20+.

### Ops token permission errors

Use a token with `ops_read` (and `ops_write` where needed), or set local default token env used by your stack.

### Port conflicts

Stop local processes on the API port (default `3000`) or adjust runtime env.
