#!/bin/bash
# ============================================================================
# Nooterra Database Migration Script
# ============================================================================
#
# Runs Drizzle migrations against Railway's PostgreSQL database.
#
# Usage:
#   ./migrate.sh              # Push schema changes
#   ./migrate.sh generate     # Generate new migration
#   ./migrate.sh studio       # Open Drizzle Studio
#
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }

cd "$PROJECT_ROOT"

case "${1:-push}" in
  generate)
    log_info "Generating new migration..."
    railway run --service nooterra-coordinator -- pnpm --filter @nooterra/coordinator db:generate
    log_success "Migration generated in apps/coordinator/drizzle/"
    ;;
  studio)
    log_info "Opening Drizzle Studio..."
    railway run --service nooterra-coordinator -- pnpm --filter @nooterra/coordinator db:studio
    ;;
  push|*)
    log_info "Pushing schema to database..."
    railway run --service nooterra-coordinator -- pnpm --filter @nooterra/coordinator db:push
    log_success "Schema pushed successfully"
    ;;
esac
