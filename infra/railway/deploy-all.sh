#!/bin/bash
# ============================================================================
# Nooterra Railway Deployment Script
# ============================================================================
# 
# Prerequisites:
#   - Railway CLI installed: npm install -g @railway/cli
#   - Logged in: railway login
#
# Usage:
#   ./deploy-all.sh              # Deploy all services
#   ./deploy-all.sh coordinator  # Deploy single service
#   ./deploy-all.sh --migrate    # Run migrations before deploy
#
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root (assumes script is in infra/railway/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load Railway configuration (service IDs, project ID, etc.)
source "$SCRIPT_DIR/config.sh"

# Services to deploy (in order) - keys from SERVICE_IDS
DEPLOY_ORDER=(
  "coordinator"
  "dispatcher"
  "registry"
)

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check Railway CLI is installed
check_railway_cli() {
  if ! command -v railway &> /dev/null; then
    log_error "Railway CLI not found. Install with: npm install -g @railway/cli"
    exit 1
  fi
  log_success "Railway CLI found: $(railway --version)"
}

# Check we're logged in
check_railway_auth() {
  if ! railway whoami &> /dev/null; then
    log_error "Not logged in to Railway. Run: railway login"
    exit 1
  fi
  log_success "Logged in as: $(railway whoami)"
}

# Run database migrations
run_migrations() {
  log_info "Running database migrations..."
  cd "$PROJECT_ROOT"
  
  # Use Railway's environment to get DATABASE_URL
  railway run \
    --project="$RAILWAY_PROJECT_ID" \
    --environment="$RAILWAY_ENVIRONMENT_ID" \
    --service="${SERVICE_IDS[coordinator]}" \
    -- pnpm --filter @nooterra/coordinator db:push
  
  log_success "Migrations completed"
}

# Deploy a single service by key (coordinator, dispatcher, registry)
deploy_service() {
  local service_key=$1
  local service_id="${SERVICE_IDS[$service_key]}"
  local service_name="${SERVICE_NAMES[$service_key]:-$service_key}"
  
  if [ -z "$service_id" ]; then
    log_error "Unknown service: $service_key"
    log_info "Available services: ${!SERVICE_IDS[*]}"
    exit 1
  fi
  
  log_info "Deploying $service_name (ID: $service_id)..."
  
  cd "$PROJECT_ROOT"
  
  # Deploy using service ID for reliability
  railway up \
    --project="$RAILWAY_PROJECT_ID" \
    --environment="$RAILWAY_ENVIRONMENT_ID" \
    --service="$service_id" \
    --detach
  
  log_success "$service_name deployment triggered"
}

# Deploy all services
deploy_all() {
  log_info "Deploying all Nooterra services..."
  
  for service_key in "${DEPLOY_ORDER[@]}"; do
    deploy_service "$service_key"
    sleep 2  # Small delay between deploys
  done
  
  log_success "All deployments triggered!"
  log_info "Check status at: https://railway.app/project/$RAILWAY_PROJECT_ID"
}

# Show service status
show_status() {
  log_info "Checking service status..."
  railway status \
    --project="$RAILWAY_PROJECT_ID" \
    --environment="$RAILWAY_ENVIRONMENT_ID"
}

# Health check
health_check() {
  log_info "Running health checks..."
  
  echo ""
  log_info "Coordinator (https://coord.nooterra.ai/health):"
  curl -s https://coord.nooterra.ai/health | jq . || log_warn "Coordinator not responding"
  
  echo ""
  log_info "Registry (https://api.nooterra.ai/health):"
  curl -s https://api.nooterra.ai/health | jq . || log_warn "Registry not responding"
}

# Main
main() {
  echo ""
  echo "=========================================="
  echo "  Nooterra Railway Deployment"
  echo "=========================================="
  echo ""
  
  check_railway_cli
  check_railway_auth
  
  # Parse arguments
  MIGRATE=false
  SERVICE=""
  HEALTH=false
  
  while [[ $# -gt 0 ]]; do
    case $1 in
      --migrate|-m)
        MIGRATE=true
        shift
        ;;
      --status|-s)
        show_status
        exit 0
        ;;
      --health|-h)
        health_check
        exit 0
        ;;
      --help)
        echo "Usage: ./deploy-all.sh [options] [service]"
        echo ""
        echo "Services: coordinator, dispatcher, registry"
        echo ""
        echo "Options:"
        echo "  --migrate, -m    Run migrations before deploy"
        echo "  --status, -s     Show Railway status"
        echo "  --health, -h     Run health checks"
        echo "  --help           Show this help"
        exit 0
        ;;
      *)
        SERVICE="$1"
        shift
        ;;
    esac
  done
  
  # Run migrations if requested
  if [ "$MIGRATE" = true ]; then
    run_migrations
  fi
  
  # Deploy
  if [ -n "$SERVICE" ]; then
    deploy_service "$SERVICE"
  else
    deploy_all
  fi
  
  echo ""
  log_success "Deployment complete!"
  log_info "Project: https://railway.app/project/$RAILWAY_PROJECT_ID"
  echo ""
}

main "$@"
