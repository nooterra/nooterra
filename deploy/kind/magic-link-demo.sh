#!/usr/bin/env bash
set -euo pipefail

NAME="${KIND_CLUSTER_NAME:-settld-magic-link}"
NAMESPACE="${MAGIC_LINK_NAMESPACE:-magic-link-demo}"
RELEASE="${MAGIC_LINK_HELM_RELEASE:-magic-link}"
PORT_LOCAL="${MAGIC_LINK_LOCAL_PORT:-8787}"
HELM_TIMEOUT="${MAGIC_LINK_HELM_TIMEOUT:-10m}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing dependency: $1" >&2
    exit 1
  fi
}

need kind
need kubectl
need helm
need node
need docker

if ! kind get clusters | grep -qx "${NAME}"; then
  kind create cluster --name "${NAME}"
fi

echo "building docker image settld:kind (this may take a minute)..."
docker build -t settld:kind --build-arg SETTLD_VERSION=kind --build-arg GIT_SHA=kind .
kind load docker-image --name "${NAME}" settld:kind

kubectl get ns "${NAMESPACE}" >/dev/null 2>&1 || kubectl create ns "${NAMESPACE}"

API_KEY="${MAGIC_LINK_API_KEY:-dev_key}"
SETTINGS_KEY_HEX="${MAGIC_LINK_SETTINGS_KEY_HEX:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"

TRUST_JSON_PATH="${MAGIC_LINK_TRUST_JSON_PATH:-test/fixtures/bundles/v1/trust.json}"
GOV_ROOTS_JSON="$(node -e 'const j=require("./'"${TRUST_JSON_PATH}"'"); process.stdout.write(JSON.stringify(j.governanceRoots||{}));')"
PRICING_KEYS_JSON="$(node -e 'const j=require("./'"${TRUST_JSON_PATH}"'"); process.stdout.write(JSON.stringify(j.pricingSigners||{}));')"

kubectl -n "${NAMESPACE}" delete secret magic-link-secrets >/dev/null 2>&1 || true
kubectl -n "${NAMESPACE}" create secret generic magic-link-secrets \
  --from-literal=MAGIC_LINK_API_KEY="${API_KEY}" \
  --from-literal=MAGIC_LINK_SETTINGS_KEY_HEX="${SETTINGS_KEY_HEX}" \
  --from-literal=SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON="${GOV_ROOTS_JSON}" \
  --from-literal=SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON="${PRICING_KEYS_JSON}"

cat > /tmp/values.magic-link.kind.yaml <<'YAML'
image:
  repository: settld
  tag: kind
magicLink:
  env:
    MAGIC_LINK_HOST: "0.0.0.0"
    MAGIC_LINK_PORT: "8787"
    MAGIC_LINK_DATA_DIR: "/data"
    MAGIC_LINK_PUBLIC_BASE_URL: ""
    MAGIC_LINK_WEBHOOK_DELIVERY_MODE: "record"
    MAGIC_LINK_WEBHOOK_TIMEOUT_MS: "1000"
    MAGIC_LINK_VERIFY_TIMEOUT_MS: "60000"
    MAGIC_LINK_MAX_CONCURRENT_JOBS: "4"
    MAGIC_LINK_MAX_CONCURRENT_JOBS_PER_TENANT: "2"
    MAGIC_LINK_RATE_LIMIT_UPLOADS_PER_MINUTE: "120"
    MAGIC_LINK_MIGRATE_ON_STARTUP: "1"
    MAGIC_LINK_BUYER_OTP_DELIVERY_MODE: "log"
    MAGIC_LINK_DECISION_OTP_DELIVERY_MODE: "log"
  secretEnv:
    - name: MAGIC_LINK_API_KEY
      secretName: magic-link-secrets
      secretKey: MAGIC_LINK_API_KEY
    - name: MAGIC_LINK_SETTINGS_KEY_HEX
      secretName: magic-link-secrets
      secretKey: MAGIC_LINK_SETTINGS_KEY_HEX
    - name: SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON
      secretName: magic-link-secrets
      secretKey: SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON
    - name: SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON
      secretName: magic-link-secrets
      secretKey: SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON
YAML

if ! helm upgrade --install "${RELEASE}" deploy/helm/magic-link -n "${NAMESPACE}" -f /tmp/values.magic-link.kind.yaml --wait --timeout "${HELM_TIMEOUT}"; then
  echo "helm upgrade failed; collecting diagnostics..." >&2
  kubectl -n "${NAMESPACE}" get pods,pvc,svc || true
  kubectl -n "${NAMESPACE}" get events --sort-by=.lastTimestamp | tail -n 80 || true
  kubectl -n "${NAMESPACE}" describe deploy "${RELEASE}-settld-magic-link" || true
  kubectl -n "${NAMESPACE}" describe pods || true
  kubectl -n "${NAMESPACE}" logs "deploy/${RELEASE}-settld-magic-link" -c magic-link --tail=200 || true
  kubectl -n "${NAMESPACE}" logs "deploy/${RELEASE}-settld-magic-link" -c maintenance --tail=200 || true
  exit 1
fi

echo "port-forwarding svc/${RELEASE}-settld-magic-link to localhost:${PORT_LOCAL}..."
kubectl -n "${NAMESPACE}" port-forward "svc/${RELEASE}-settld-magic-link" "${PORT_LOCAL}:8787" >/tmp/magic-link.pf.log 2>&1 &
PF_PID=$!
trap 'kill "${PF_PID}" >/dev/null 2>&1 || true' EXIT

sleep 1

MAGIC_LINK_SMOKE_URL="http://127.0.0.1:${PORT_LOCAL}" \
MAGIC_LINK_SMOKE_API_KEY="${API_KEY}" \
MAGIC_LINK_SMOKE_TENANT_ID="${MAGIC_LINK_DEMO_TENANT_ID:-tenant_example}" \
MAGIC_LINK_SMOKE_BUYER_EMAIL="${MAGIC_LINK_DEMO_BUYER_EMAIL:-aiden@settld.work}" \
MAGIC_LINK_SMOKE_VENDOR_ID="${MAGIC_LINK_DEMO_VENDOR_ID:-vendor_a}" \
MAGIC_LINK_SMOKE_VENDOR_NAME="${MAGIC_LINK_DEMO_VENDOR_NAME:-Vendor A}" \
MAGIC_LINK_SMOKE_CONTRACT_ID="${MAGIC_LINK_DEMO_CONTRACT_ID:-contract_1}" \
MAGIC_LINK_SMOKE_NAMESPACE="${NAMESPACE}" \
MAGIC_LINK_SMOKE_HELM_RELEASE="${RELEASE}" \
  node scripts/demo/magic-link-kind-smoke.mjs

echo "demo complete: http://127.0.0.1:${PORT_LOCAL}"
