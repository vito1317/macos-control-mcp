#!/bin/bash
# Build the Swift native helper for macos-control-mcp
# Author: vito1317 <service@vito1317.com>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../bin"

mkdir -p "$OUTPUT_DIR"

echo "🔨 Compiling MacControl Swift helper..."
swiftc \
    -O \
    -framework Cocoa \
    -framework CoreGraphics \
    -framework ApplicationServices \
    "$SCRIPT_DIR/MacControl.swift" \
    -o "$OUTPUT_DIR/mac-control"

chmod +x "$OUTPUT_DIR/mac-control"

echo "✅ Built: $OUTPUT_DIR/mac-control"

echo ""
echo "🔨 Compiling Overlay Swift helper..."
swiftc \
    -O \
    -framework Cocoa \
    -framework CoreGraphics \
    "$SCRIPT_DIR/Overlay.swift" \
    -o "$OUTPUT_DIR/overlay"

chmod +x "$OUTPUT_DIR/overlay"

echo "✅ Built: $OUTPUT_DIR/overlay"
echo ""
echo "Note: You may need to grant Accessibility permissions:"
echo "  System Settings > Privacy & Security > Accessibility"
echo "  Add Terminal.app (or your terminal of choice)"
