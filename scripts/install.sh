#!/usr/bin/env bash
# Nooterra CLI Installer
# Usage: curl -fsSL https://nooterra.ai/install.sh | bash
#
# This script detects your platform, downloads the appropriate binary,
# and installs it to /usr/local/bin (or ~/.local/bin if no permissions)

set -euo pipefail

REPO="nooterra/nooterra"
BINARY_NAME="nooterra"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() { printf "${BLUE}▸${NC} %s\n" "$1"; }
success() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
error() { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

# Detect platform
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Darwin) os="darwin" ;;
        Linux) os="linux" ;;
        MINGW*|MSYS*|CYGWIN*) os="windows" ;;
        *) error "Unsupported operating system: $(uname -s)" ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x64" ;;
        arm64|aarch64) arch="arm64" ;;
        *) error "Unsupported architecture: $(uname -m)" ;;
    esac

    echo "${os}-${arch}"
}

# Get latest version from GitHub
get_latest_version() {
    local version
    version=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
    
    if [[ -z "$version" ]]; then
        # Fallback to npm if GitHub releases don't exist yet
        version=$(npm view nooterra version 2>/dev/null || echo "0.2.8")
    fi
    
    echo "$version"
}

# Determine install directory
get_install_dir() {
    if [[ -w "/usr/local/bin" ]]; then
        echo "/usr/local/bin"
    elif [[ -d "$HOME/.local/bin" ]] || mkdir -p "$HOME/.local/bin" 2>/dev/null; then
        echo "$HOME/.local/bin"
    else
        error "Cannot find writable install directory. Try running with sudo."
    fi
}

# Main installation
main() {
    echo ""
    printf "${GREEN}"
    cat << 'EOF'
  _   _             _                      
 | \ | | ___   ___ | |_ ___ _ __ _ __ __ _ 
 |  \| |/ _ \ / _ \| __/ _ \ '__| '__/ _` |
 | |\  | (_) | (_) | ||  __/ |  | | | (_| |
 |_| \_|\___/ \___/ \__\___|_|  |_|  \__,_|
                                            
EOF
    printf "${NC}"
    echo "  Hire AI workers you can actually trust."
    echo ""

    local platform version install_dir download_url tmp_dir

    info "Detecting platform..."
    platform=$(detect_platform)
    success "Platform: $platform"

    info "Getting latest version..."
    version=$(get_latest_version)
    success "Version: v$version"

    install_dir=$(get_install_dir)
    info "Install directory: $install_dir"

    download_url="https://github.com/${REPO}/releases/download/v${version}/${BINARY_NAME}-${platform}.tar.gz"

    # Check if GitHub releases exist, otherwise use npm
    if ! curl -fsSL --head "$download_url" >/dev/null 2>&1; then
        warn "Binary release not available yet. Installing via npm..."
        
        if ! command -v npm &>/dev/null; then
            error "npm is required but not installed. Install Node.js first: https://nodejs.org"
        fi
        
        info "Installing nooterra globally via npm..."
        npm install -g nooterra
        success "Installed nooterra via npm"
        
        echo ""
        success "Installation complete!"
        echo ""
        info "To get started, run:"
        echo "    nooterra"
        echo ""
        return
    fi

    # Create temp directory
    tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT

    info "Downloading ${BINARY_NAME}..."
    curl -fsSL "$download_url" -o "$tmp_dir/${BINARY_NAME}.tar.gz"
    success "Downloaded"

    info "Extracting..."
    tar -xzf "$tmp_dir/${BINARY_NAME}.tar.gz" -C "$tmp_dir"
    success "Extracted"

    info "Installing to $install_dir..."
    mv "$tmp_dir/${BINARY_NAME}" "$install_dir/${BINARY_NAME}"
    chmod +x "$install_dir/${BINARY_NAME}"
    success "Installed"

    # Check if install_dir is in PATH
    if [[ ":$PATH:" != *":$install_dir:"* ]]; then
        warn "$install_dir is not in your PATH"
        echo ""
        echo "Add this to your shell config (~/.bashrc, ~/.zshrc, etc.):"
        echo "    export PATH=\"$install_dir:\$PATH\""
        echo ""
    fi

    echo ""
    success "Installation complete!"
    echo ""
    info "To get started, run:"
    echo "    nooterra"
    echo ""
    info "This will launch the TUI and guide you through:"
    echo "    1. Sign in to Nooterra"
    echo "    2. Connect your AI provider"
    echo "    3. Create your first worker"
    echo "    4. Run your first governed task"
    echo ""
    info "Documentation: https://nooterra.ai/docs"
    echo ""
}

main "$@"
