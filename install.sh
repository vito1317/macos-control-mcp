#!/bin/bash
# Install script for macos-control-mcp
# Author: vito1317 <service@vito1317.com>

set -e

echo "🚀 Installing macos-control-mcp..."
echo ""

# Check prerequisites
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required. Install via: brew install node"
    exit 1
fi

if ! command -v swiftc &> /dev/null; then
    echo "❌ Swift compiler is required. Install Xcode Command Line Tools: xcode-select --install"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Current: $(node -v)"
    exit 1
fi

echo "✅ Prerequisites OK (Node $(node -v), Swift $(swiftc --version 2>&1 | head -1))"
echo ""

# Install npm dependencies
echo "📦 Installing dependencies..."
npm install

# Build Swift helper
echo ""
echo "🔨 Building Swift native helper..."
bash swift-helpers/build.sh

# Build TypeScript
echo ""
echo "📝 Building TypeScript..."
npm run build

echo ""
echo "============================================"
echo "✅ Installation complete!"
echo "============================================"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Grant Accessibility permissions:"
echo "   System Settings > Privacy & Security > Accessibility"
echo "   Add your terminal app (Terminal.app / iTerm2 / etc.)"
echo ""
echo "2. Add to your MCP client config (e.g., Claude Desktop):"
echo ""
echo '   {'
echo '     "mcpServers": {'
echo '       "macos-control": {'
echo '         "command": "node",'
echo "         \"args\": [\"$(pwd)/dist/index.js\"]"
echo '       }'
echo '     }'
echo '   }'
echo ""
echo "3. Or run directly: npm start"
echo ""
