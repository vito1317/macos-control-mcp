#!/usr/bin/env node
// macos-control-mcp — MCP Server for full macOS computer control
// Author: vito1317 <service@vito1317.com>

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { isHelperAvailable } from './utils/swift-bridge.js';
import { startWsBridge, stopWsBridge } from './utils/ws-bridge.js';

async function main() {
  // Check Swift helper availability
  if (!isHelperAvailable()) {
    console.error(
      '⚠️  Swift helper binary not found.\n' +
      '   Please run: npm run build:swift\n' +
      '   This compiles the native macOS control helper.\n'
    );
    // Continue anyway — some tools (terminal, screenshot) work without it
  }

  // Start WebSocket bridge for Chrome extension communication
  startWsBridge();

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    stopWsBridge();
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    stopWsBridge();
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
