#!/bin/bash
# ============================================================================
# Nooterra Railway Configuration
# ============================================================================
# Service IDs and project configuration for Railway deployments
# ============================================================================

# Project & Environment
export RAILWAY_PROJECT_ID="702535a1-2f78-458b-8a4f-18bbeb8459b5"
export RAILWAY_ENVIRONMENT_ID="6198ea01-2f84-4cfd-a976-9ee4121fa1b9"

# Service IDs (mapped by name)
declare -A SERVICE_IDS=(
  ["coordinator"]="fd80cb66-9426-446c-be47-ab701ee55774"
  ["dispatcher"]="6bb2cae7-690e-47e9-bbe4-a51469181dfd"
  ["registry"]="39321649-d731-4899-acaa-357a6363e7df"
  ["qdrant"]="d84fb78c-c4a2-4155-9cdb-c7e125510f77"
  ["redis"]="f5003310-3dc4-4ceb-8da0-51eb45aa2fcd"
  ["postgres"]="aac4558c-b0e6-454e-b002-ced596e29839"
)

# Service names for Railway CLI (must match Railway service names)
declare -A SERVICE_NAMES=(
  ["coordinator"]="nooterra-coordinator"
  ["dispatcher"]="nooterra-dispatcher"
  ["registry"]="nooterra-registry"
)

# Domains
export COORDINATOR_DOMAIN="coord.nooterra.ai"
export REGISTRY_DOMAIN="api.nooterra.ai"
export CONSOLE_DOMAIN="console.nooterra.io"

# Helper: Get service ID by key
get_service_id() {
  echo "${SERVICE_IDS[$1]}"
}

# Helper: Get Railway CLI args for a service
railway_args() {
  local service=$1
  echo "--project=$RAILWAY_PROJECT_ID --environment=$RAILWAY_ENVIRONMENT_ID --service=${SERVICE_IDS[$service]}"
}

# Helper: Build SSH command for a service
railway_ssh_cmd() {
  local service=$1
  echo "railway ssh $(railway_args $service)"
}
