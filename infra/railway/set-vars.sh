#!/bin/bash
# ============================================================================
# Nooterra Railway Variable Setup
# ============================================================================
# Sets all required environment variables for each service
#
# Usage:
#   ./set-vars.sh coordinator   # Set coordinator variables
#   ./set-vars.sh dispatcher    # Set dispatcher variables
#   ./set-vars.sh all           # Set all service variables
#
# Note: Run this once after creating services, or when updating config
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Helper to set a variable
set_var() {
  local service=$1
  local key=$2
  local value=$3
  railway variables set "$key=$value" \
    --project="$RAILWAY_PROJECT_ID" \
    --environment="$RAILWAY_ENVIRONMENT_ID" \
    --service="${SERVICE_IDS[$service]}"
}

# Coordinator variables
set_coordinator_vars() {
  log_info "Setting coordinator variables..."
  
  local service="coordinator"
  
  # Required
  set_var $service "NODE_ENV" "production"
  set_var $service "DATABASE_URL" "\${{Postgres.DATABASE_URL}}"
  set_var $service "REDIS_URL" "redis://default:AFwwxZHKMAAQAsvOizvViogMosEGGUHE@shinkansen.proxy.rlwy.net:44191"
  set_var $service "CORS_WHITELIST" "https://console.nooterra.io,https://nooterra.vercel.app"
  set_var $service "REGISTRY_URL" "https://api.nooterra.ai"
  
  # Optional with defaults
  set_var $service "DB_POOL_SIZE" "20"
  set_var $service "RATE_LIMIT_PER_MINUTE" "100"
  
  log_success "Coordinator variables set"
  log_warn "Don't forget to set JWT_SECRET manually (sensitive):"
  echo "  railway variables set JWT_SECRET=<your-secret> --project=$RAILWAY_PROJECT_ID --environment=$RAILWAY_ENVIRONMENT_ID --service=${SERVICE_IDS[$service]}"
}

# Dispatcher variables
set_dispatcher_vars() {
  log_info "Setting dispatcher variables..."
  
  local service="dispatcher"
  
  # Required
  set_var $service "NODE_ENV" "production"
  set_var $service "DATABASE_URL" "\${{Postgres.DATABASE_URL}}"
  set_var $service "REDIS_URL" "redis://default:AFwwxZHKMAAQAsvOizvViogMosEGGUHE@shinkansen.proxy.rlwy.net:44191"
  set_var $service "REGISTRY_URL" "https://api.nooterra.ai"
  
  # Dispatcher-specific
  set_var $service "DISPATCH_INTERVAL_MS" "1000"
  set_var $service "MAX_CONCURRENT_DISPATCHES" "10"
  set_var $service "AGENT_TIMEOUT_MS" "30000"
  set_var $service "MAX_DISPATCH_RETRIES" "3"
  set_var $service "WORKER_ID" "dispatcher-1"
  
  log_success "Dispatcher variables set"
}

# Registry variables
set_registry_vars() {
  log_info "Setting registry variables..."
  
  local service="registry"
  
  set_var $service "NODE_ENV" "production"
  set_var $service "DATABASE_URL" "\${{Postgres.DATABASE_URL}}"
  set_var $service "QDRANT_URL" "\${{qdrant.QDRANT_URL}}"
  set_var $service "COORDINATOR_URL" "https://coord.nooterra.ai"
  
  log_success "Registry variables set"
}

# Main
case "${1:-all}" in
  coordinator)
    set_coordinator_vars
    ;;
  dispatcher)
    set_dispatcher_vars
    ;;
  registry)
    set_registry_vars
    ;;
  all)
    set_coordinator_vars
    echo ""
    set_dispatcher_vars
    echo ""
    set_registry_vars
    ;;
  *)
    echo -e "${RED}Unknown service:${NC} $1"
    echo "Usage: ./set-vars.sh [coordinator|dispatcher|registry|all]"
    exit 1
    ;;
esac

echo ""
log_info "Variables set! Redeploy services to apply changes."
