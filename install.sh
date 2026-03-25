#!/bin/sh
# Nooterra installer
# Usage: curl -fsSL https://nooterra.com/install.sh | sh
set -e

REPO="nooterra/nooterra"
INSTALL_DIR="/usr/local/bin"

# Detect platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  linux)  OS="linux" ;;
  darwin) OS="darwin" ;;
  *)
    echo "Error: Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Error: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# Check for Node.js (required)
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js is required but not installed."
  echo ""
  echo "Install Node.js 20.x first:"
  echo "  macOS:  brew install node@20"
  echo "  Linux:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo "  Or:     https://nodejs.org/en/download"
  echo ""
  echo "Then re-run this installer."
  exit 1
fi

NODE_VERSION="$(node -v | cut -d. -f1 | tr -d 'v')"
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Error: Node.js 20.x or later is required (found v$NODE_VERSION)"
  exit 1
fi

echo ""
echo "  Installing Nooterra..."
echo ""

# Install via npm (most reliable cross-platform method)
npm install -g nooterra

echo ""
echo "  Nooterra installed successfully!"
echo ""
echo "  Get started:"
echo "    nooterra"
echo ""
echo "  Documentation: https://docs.nooterra.com"
echo ""
