#!/bin/bash
# ============================================================================
# Nooterra Railway Deployment Script
# ============================================================================
# 
# Prerequisites:
#   - Railway CLI installed: npm install -g @railway/cli
#   - Logged in: railway login
#   - Project linked: railway link (run once per project)
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

# Services to deploy (in order)
SERVICES=(
  "nooterra-coordinator"
  "nooterra-dispatcher"
  "nooterra-registry"
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
  railway run --service nooterra-coordinator -- pnpm --filter @nooterra/coordinator db:push
  
  log_success "Migrations completed"
}

# Deploy a single service
deploy_service() {
  local service=$1
  log_info "Deploying $service..."
  
  cd "$PROJECT_ROOT"
  
  # Railway will auto-detect the service from the linked project
  railway up --service "$service" --detach
  
  log_success "$service deployment triggered"
}

# Deploy all services
deploy_all() {
  log_info "Deploying all Nooterra services..."
  
  for service in "${SERVICES[@]}"; do
    deploy_service "$service"
    sleep 2  # Small delay between deploys
  done
  
  log_success "All deployments triggered!"
  log_info "Check status at: https://railway.app/dashboard"
}

# Show service status
show_status() {
  log_info "Checking service status..."
  railway status
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
  echo ""
}

main "$@"
