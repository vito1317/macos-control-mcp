// MCP Server setup — registers all tools and handles the protocol
// Author: vito1317 <service@vito1317.com>

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mouseTools } from './tools/mouse.js';
import { keyboardTools } from './tools/keyboard.js';
import { screenshotTools } from './tools/screenshot.js';
import { terminalTools } from './tools/terminal.js';
import { windowTools } from './tools/window.js';
import { accessibilityTools } from './tools/accessibility.js';
import { aiOptimizeTools } from './tools/ai-optimize.js';
import { animationTools } from './tools/animation.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'macos-control-mcp',
    version: '1.0.0',
  });

  // Register all tool groups
  const allTools = {
    ...mouseTools,
    ...keyboardTools,
    ...screenshotTools,
    ...terminalTools,
    ...windowTools,
    ...accessibilityTools,
    ...aiOptimizeTools,
    ...animationTools,
  };

  for (const [name, tool] of Object.entries(allTools)) {
    const t = tool as any;
    // MCP SDK expects ZodRawShape (.shape), not the full z.object()
    const schema = t.inputSchema?.shape ?? t.inputSchema ?? {};
    server.tool(
      name,
      t.description,
      schema,
      async (args: any) => {
        try {
          return await t.handler(args);
        } catch (error: any) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error in ${name}: ${error.message}\n\nStack: ${error.stack}`,
            }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}
