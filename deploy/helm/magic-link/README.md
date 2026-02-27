# Nooterra Magic Link Helm Chart

This chart deploys **Verify Cloud (Magic Link)**:

- Bundle zip ingestion (`POST /v1/upload` and `POST /v1/ingest/:tenant`)
- Buyer inbox + exports
- Persistent on-disk state under `MAGIC_LINK_DATA_DIR` (PVC by default)

## Quick start (kind / dev cluster)

Use the repo helper:

```bash
bash deploy/kind/magic-link-demo.sh
```

## Install (generic Kubernetes)

1) Create secrets (example):

```bash
kubectl create secret generic magic-link-secrets \
  --from-literal=MAGIC_LINK_API_KEY='replace_me' \
  --from-literal=MAGIC_LINK_SETTINGS_KEY_HEX='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' \
  --from-literal=MAGIC_LINK_SMTP_HOST='smtp.example.com' \
  --from-literal=MAGIC_LINK_SMTP_USER='smtp_user' \
  --from-literal=MAGIC_LINK_SMTP_PASS='smtp_pass' \
  --from-literal=MAGIC_LINK_SMTP_FROM='noreply@example.com'
```

2) Install:

```bash
helm upgrade --install magic-link deploy/helm/magic-link \
  --set image.repository=ghcr.io/nooterra/nooterra \
  --set image.tag=0.0.0 \
  --set magicLink.secretEnv[0].name=MAGIC_LINK_API_KEY \
  --set magicLink.secretEnv[0].secretName=magic-link-secrets \
  --set magicLink.secretEnv[0].secretKey=MAGIC_LINK_API_KEY \
  --set magicLink.secretEnv[1].name=MAGIC_LINK_SETTINGS_KEY_HEX \
  --set magicLink.secretEnv[1].secretName=magic-link-secrets \
  --set magicLink.secretEnv[1].secretKey=MAGIC_LINK_SETTINGS_KEY_HEX
```

## OTP delivery (SMTP)

To send buyer login and decision OTP codes via email, set:

- `MAGIC_LINK_BUYER_OTP_DELIVERY_MODE=smtp`
- `MAGIC_LINK_DECISION_OTP_DELIVERY_MODE=smtp`

…and provide SMTP env vars (typically via `magicLink.secretEnv`):

- `MAGIC_LINK_SMTP_HOST`, `MAGIC_LINK_SMTP_PORT` (default `587`)
- `MAGIC_LINK_SMTP_SECURE=1|0` (default `0`)
- `MAGIC_LINK_SMTP_STARTTLS=1|0` (default `1`)
- `MAGIC_LINK_SMTP_USER`, `MAGIC_LINK_SMTP_PASS` (optional)
- `MAGIC_LINK_SMTP_FROM` (required)

## Persistence

By default, the chart provisions a PVC and mounts it at `/data`, and sets:

- `MAGIC_LINK_DATA_DIR=/data`

To use an existing claim, set `magicLink.persistence.existingClaim`.
