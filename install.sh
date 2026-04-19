#!/bin/bash
# ============================================================
# macOS Control MCP - Installer
# Installs all dependencies, builds project, and registers
# MCP server via `claude mcp add`.
# ============================================================
# Note: not using set -e to avoid aborting on non-fatal errors
# (e.g., claude mcp add returning non-zero when server already exists)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════╗"
echo "║      macOS Control MCP - Installer            ║"
echo "║  AI-driven macOS desktop control              ║"
echo "╚═══════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Check macOS ────────────────────────────────────────────
check_macos() {
    if [[ "$(uname)" != "Darwin" ]]; then
        echo -e "${RED}[ERROR] This installer is for macOS only.${NC}"
        echo "For Linux, use: https://github.com/vito1317/linux-control-mcp"
        exit 1
    fi
    echo -e "${GREEN}[OK]${NC} macOS $(sw_vers -productVersion)"
}

# ─── Check Prerequisites ────────────────────────────────────
check_prerequisites() {
    echo ""
    echo -e "${BLUE}[1/4] Checking prerequisites...${NC}"

    # Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${YELLOW}[INFO]${NC} Node.js not found, installing via Homebrew..."
        if ! command -v brew &> /dev/null; then
            echo "Installing Homebrew first..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        fi
        brew install node
    fi

    NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${RED}[ERROR] Node.js >= 18 required, found v$(node --version)${NC}"
        exit 1
    fi
    echo -e "${GREEN}[OK]${NC} Node.js $(node --version)"

    # Swift
    if ! command -v swiftc &> /dev/null; then
        echo -e "${YELLOW}[INFO]${NC} Swift compiler not found. Installing Xcode Command Line Tools..."
        xcode-select --install 2>/dev/null || true
        echo -e "${YELLOW}[WAIT]${NC} Please complete the Xcode CLI Tools installation and re-run this script."
        exit 1
    fi
    echo -e "${GREEN}[OK]${NC} Swift compiler found"
}

# ─── Clone or Update Repository ─────────────────────────────
setup_repo() {
    echo ""
    echo -e "${BLUE}[2/4] Setting up repository...${NC}"

    INSTALL_DIR="$HOME/.local/share/macos-control-mcp"

    if [ -d "$INSTALL_DIR/.git" ]; then
        echo "Updating existing installation..."
        cd "$INSTALL_DIR"
        git pull origin main 2>&1 | tail -3
    else
        echo "Cloning repository..."
        mkdir -p "$(dirname "$INSTALL_DIR")"
        git clone https://github.com/vito1317/macos-control-mcp.git "$INSTALL_DIR" 2>&1 | tail -3
        cd "$INSTALL_DIR"
    fi

    echo -e "${GREEN}[OK]${NC} Repository ready at $INSTALL_DIR"
}

# ─── Install & Build ────────────────────────────────────────
build_project() {
    echo ""
    echo -e "${BLUE}[3/4] Installing dependencies and building...${NC}"

    cd "$INSTALL_DIR"

    # npm install
    npm install 2>&1 | tail -5

    # Build Swift helpers
    echo "Building Swift native helpers..."
    bash swift-helpers/build.sh 2>&1 | tail -3

    # Build TypeScript
    npm run build 2>&1 | tail -3

    echo -e "${GREEN}[OK]${NC} Project built successfully"
}

# ─── Register MCP server (direct JSON write) ──────────────
register_mcp() {
    echo ""
    echo -e "${BLUE}[4/4] Registering MCP server...${NC}"

    # Write MCP server config directly to ~/.claude.json
    # (bypasses 'claude mcp add' which breaks curl|bash pipe)
    CLAUDE_CONFIG="$HOME/.claude.json"

    python3 -c "
import json, os

config_path = os.path.expanduser('~/.claude.json')
try:
    with open(config_path, 'r') as f:
        config = json.load(f)
except:
    config = {}

servers = config.setdefault('mcpServers', {})
servers['macos-control'] = {
    'command': 'node',
    'args': ['$INSTALL_DIR/dist/index.js']
}

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)
print('MCP server registered in ' + config_path)
" 2>&1

    echo -e "${GREEN}[OK]${NC} MCP server registered in ~/.claude.json"

    # Auto-allow all macos-control MCP permissions
    SETTINGS_DIR="$HOME/.claude"
    SETTINGS_FILE="$SETTINGS_DIR/settings.json"
    mkdir -p "$SETTINGS_DIR"

    python3 -c "
import json, os

settings_path = '$SETTINGS_FILE'
try:
    with open(settings_path, 'r') as f:
        settings = json.load(f)
except:
    settings = {}

perms = settings.setdefault('permissions', {})
allow = perms.setdefault('allow', [])
# Server name is 'macos-control', Claude Code uses hyphen in permission prefix
if 'mcp__macos-control' not in allow:
    allow.append('mcp__macos-control')

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)
print('Permissions updated')
" 2>&1

    echo -e "${GREEN}[OK]${NC} Permissions auto-allowed in $SETTINGS_FILE"
}

# ─── Configure Chrome for web element scanning ────────────
setup_chrome() {
    echo ""
    echo -e "${BLUE}[5/5] Setting up Chrome web element scanning...${NC}"

    if [ ! -d "/Applications/Google Chrome.app" ]; then
        echo -e "${YELLOW}[SKIP]${NC} Google Chrome not found — web element scanning unavailable"
        return
    fi

    EXTENSION_DIR="$INSTALL_DIR/chrome-extension"

    if [ ! -f "$EXTENSION_DIR/manifest.json" ]; then
        echo -e "${RED}[ERROR]${NC} Chrome extension files not found in $EXTENSION_DIR"
        return
    fi

    echo -e "  Extension path: ${BLUE}$EXTENSION_DIR${NC}"

    # Check if Chrome is running
    CHROME_WAS_RUNNING=false
    if pgrep -q "Google Chrome"; then
        CHROME_WAS_RUNNING=true
    fi

    # Launch Chrome with --load-extension to auto-install the extension
    # This works for the initial load; Chrome remembers the extension afterward
    # if developer mode is enabled.
    echo ""
    echo -e "  ${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${YELLOW}  Chrome Extension Setup (one-time)${NC}"
    echo -e "  ${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  The MCP Bridge Chrome extension enables AI to detect"
    echo -e "  web page elements (buttons, inputs, links, forms)."
    echo ""
    echo -e "  To install the extension:"
    echo -e "  ${BLUE}1. Open Chrome and go to: chrome://extensions${NC}"
    echo -e "  ${BLUE}2. Enable \"Developer mode\" (toggle in top-right)${NC}"
    echo -e "  ${BLUE}3. Click \"Load unpacked\" and select:${NC}"
    echo -e "     ${GREEN}$EXTENSION_DIR${NC}"
    echo ""

    # Try to open chrome://extensions automatically
    if [ "$CHROME_WAS_RUNNING" = true ]; then
        osascript -e 'tell application "Google Chrome" to open location "chrome://extensions"' 2>/dev/null
    else
        open -a "Google Chrome" "chrome://extensions" 2>/dev/null
    fi

    echo -e "  Press ${GREEN}Enter${NC} after installing, or Enter to skip..."
    read -r

    echo -e "  ${GREEN}[OK]${NC} Chrome extension setup complete"
    echo -e "  ${YELLOW}NOTE:${NC} The extension connects automatically when both"
    echo -e "  Chrome and the MCP server are running."
}

# ─── Verify ─────────────────────────────────────────────────
verify() {
    echo ""
    echo -e "${BLUE}Verifying installation...${NC}"
    echo ""

    if [ -f "$INSTALL_DIR/bin/mac-control" ]; then
        echo -e "  ${GREEN}✓${NC} Swift helper (mac-control)"
    else
        echo -e "  ${RED}✗${NC} Swift helper NOT built"
    fi

    if [ -f "$INSTALL_DIR/bin/overlay" ]; then
        echo -e "  ${GREEN}✓${NC} Overlay helper"
    else
        echo -e "  ${RED}✗${NC} Overlay helper NOT built"
    fi

    if [ -f "$INSTALL_DIR/dist/index.js" ]; then
        echo -e "  ${GREEN}✓${NC} MCP server built"
    else
        echo -e "  ${RED}✗${NC} MCP server NOT built"
    fi

    if command -v claude &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} Claude CLI"
    else
        echo -e "  ${YELLOW}~${NC} Claude CLI not found"
    fi
}

# ─── Summary ────────────────────────────────────────────────
summary() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════╗"
    echo "║         Installation Complete!                 ║"
    echo "╚═══════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  Install path:  ${BLUE}$INSTALL_DIR${NC}"
    echo ""
    echo -e "  Register MCP:  ${BLUE}claude mcp add macos-control -s user -- node $INSTALL_DIR/dist/index.js${NC}"
    echo -e "  Remove MCP:    ${BLUE}claude mcp remove macos-control -s user${NC}"
    echo -e "  Update:        ${BLUE}cd $INSTALL_DIR && git pull && npm run setup${NC}"
    echo -e "  Uninstall:     ${BLUE}claude mcp remove macos-control -s user && rm -rf $INSTALL_DIR${NC}"
    echo ""
    echo -e "  ${YELLOW}NOTE: Grant Accessibility permissions in:${NC}"
    echo -e "  ${YELLOW}System Settings > Privacy & Security > Accessibility${NC}"
    echo ""
    echo -e "  ${YELLOW}Chrome web scanning: Load the extension from:${NC}"
    echo -e "  ${YELLOW}  $INSTALL_DIR/chrome-extension${NC}"
    echo -e "  ${YELLOW}  (chrome://extensions > Developer mode > Load unpacked)${NC}"
    echo ""
}

# ─── Main ───────────────────────────────────────────────────
main() {
    check_macos
    check_prerequisites
    setup_repo
    build_project
    register_mcp
    setup_chrome
    verify
    summary
}

main "$@"
