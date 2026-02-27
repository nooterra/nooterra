# Development

Prereqs:

- Node.js 20.x (`.nvmrc` / `.node-version`)
- Docker (optional; for Postgres/MinIO local stack)

## Install

```sh
nvm use
npm ci
```

## Start The API (In-Memory Store)

```sh
PROXY_OPS_TOKEN=tok_ops npm run dev:api
```

## Local Dev Stack (Postgres + MinIO + Services)

Start the full local dev stack (Postgres + MinIO + API + receiver + finance sink):

```sh
./bin/nooterra.js dev up
```

Developer helper flow (recommended for local Neon/PG usage):

```sh
npm run dev:env:init
# edit .env.dev once (DATABASE_URL, etc.)
npm run dev:start
```

Optional: start local Postgres + MinIO only (for `STORE=pg` and S3-style evidence storage):

```sh
docker compose up -d
```

Run the full stack (API + maintenance + receiver + finance sink) via compose profile:

```sh
docker compose --profile app up --build
```

Initialize MinIO buckets (optional; required for S3/MinIO-backed evidence/artifact demos):

```sh
docker compose --profile init run --rm minio-init
```

Run the API backed by Postgres:

```sh
export STORE=pg
export DATABASE_URL=postgres://proxy:proxy@localhost:5432/proxy
npm run dev:api
```

Use MinIO for evidence objects (S3-compatible, via presigned URLs):

```sh
export PROXY_EVIDENCE_STORE=minio
export PROXY_EVIDENCE_S3_ENDPOINT=http://localhost:9000
export PROXY_EVIDENCE_S3_REGION=us-east-1
export PROXY_EVIDENCE_S3_BUCKET=proxy-evidence
export PROXY_EVIDENCE_S3_ACCESS_KEY_ID=proxy
export PROXY_EVIDENCE_S3_SECRET_ACCESS_KEY=proxysecret
export PROXY_EVIDENCE_S3_FORCE_PATH_STYLE=1
```

## Run The Agent Simulator

Registers an executor and runs a sample job lifecycle:

```sh
npm run agent:sim
```

## OpenAPI

Regenerate the OpenAPI spec and ensure no drift:

```sh
npm run -s openapi:write
git diff --exit-code -- openapi/nooterra.openapi.json
```

## Tests

```sh
npm run -s lint
npm test
```

## Conformance

Bundle verification oracle:

```sh
./bin/nooterra.js conformance test
```

Kernel control plane (disputes + holdback):

```sh
./bin/nooterra.js conformance kernel --ops-token tok_ops
```

