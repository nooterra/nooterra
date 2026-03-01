# Nooterra Helm Chart

This chart deploys:

- `nooterra-api` (HTTP API + `/metrics`)
- `nooterra-maintenance` (retention cleanup runner; separate process)
- optional `nooterra-receiver` (verify-on-receipt webhook consumer)

## Quick start

1) Create required secrets:

```bash
kubectl create secret generic nooterra-db --from-literal=DATABASE_URL='postgres://...'
kubectl create secret generic nooterra-evidence-s3 \
  --from-literal=ACCESS_KEY_ID='...' \
  --from-literal=SECRET_ACCESS_KEY='...'
```

2) Install:

```bash
helm upgrade --install nooterra deploy/helm/nooterra \
  -f deploy/helm/nooterra/values-prod-example.yaml \
  --set store.databaseUrlSecret.name=nooterra-db
```

## Evidence store (API)

`evidenceStore` config controls where API evidence/artifact bytes are stored.

- `mode: fs`: local filesystem under the API pod.
- `mode: s3`: API uses S3 via:
  - `evidenceStore.s3.endpoint`
  - `evidenceStore.s3.region`
  - `evidenceStore.s3.bucket`
  - `evidenceStore.s3.forcePathStyle`
  - `evidenceStore.s3.accessKeyIdSecret.{name,key}`
  - `evidenceStore.s3.secretAccessKeySecret.{name,key}`

Fail-closed render behavior: when `evidenceStore.mode=s3`, chart rendering fails if required S3 values are missing (`endpoint`, `bucket`, `accessKeyIdSecret.name`, `secretAccessKeySecret.name`).

## Export destinations + file secret refs

`PROXY_EXPORT_DESTINATIONS` is typically provided via the chart ConfigMap and should contain only **secret refs** (never inline secrets in production).

Mount secrets via `extraSecretMounts` and reference them using `file:/...` paths in `exportDestinationsJson`.

## Security defaults

Pods run with:

- non-root user
- dropped capabilities
- `readOnlyRootFilesystem: true`
- explicit `emptyDir` mounts for `/tmp` (and `/data` where needed)

## Probe configuration

API and receiver deployments expose configurable probe settings:

- `api.readinessProbe`, `api.livenessProbe`, `api.startupProbe`
- `receiver.readinessProbe`, `receiver.livenessProbe`, `receiver.startupProbe`

Each probe supports:

- `path`
- `initialDelaySeconds`
- `periodSeconds`
- `timeoutSeconds`
- `failureThreshold`
- readiness probes also support `successThreshold`

Defaults preserve existing readiness/liveness timings and add an explicit startup probe for safer cold-start behavior.
