#!/bin/bash
# ============================================================================
# Nooterra Railway SSH Helper
# ============================================================================
# Quick SSH access to any Railway service
#
# Usage:
#   ./ssh.sh coordinator    # SSH into coordinator
#   ./ssh.sh dispatcher     # SSH into dispatcher  
#   ./ssh.sh registry       # SSH into registry
#   ./ssh.sh postgres       # SSH into postgres
#   ./ssh.sh redis          # SSH into redis
#   ./ssh.sh qdrant         # SSH into qdrant
#
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "$1" ]; then
  echo -e "${YELLOW}Usage:${NC} ./ssh.sh <service>"
  echo ""
  echo "Available services:"
  for key in "${!SERVICE_IDS[@]}"; do
    echo "  - $key"
  done
  exit 1
fi

SERVICE=$1
SERVICE_ID="${SERVICE_IDS[$SERVICE]}"

if [ -z "$SERVICE_ID" ]; then
  echo -e "${RED}Error:${NC} Unknown service '$SERVICE'"
  echo ""
  echo "Available services:"
  for key in "${!SERVICE_IDS[@]}"; do
    echo "  - $key"
  done
  exit 1
fi

echo -e "${GREEN}Connecting to $SERVICE...${NC}"
railway ssh --project="$RAILWAY_PROJECT_ID" --environment="$RAILWAY_ENVIRONMENT_ID" --service="$SERVICE_ID"
