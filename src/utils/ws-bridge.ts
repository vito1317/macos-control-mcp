// WebSocket bridge for Chrome extension ↔ MCP server communication
// The MCP server runs a tiny WS server; the Chrome extension connects as a client.
// When ai_screen_elements needs web page data, it sends a "scan" request
// and the extension replies with the element list.
//
// Author: vito1317 <service@vito1317.com>

import { WebSocketServer, WebSocket } from 'ws';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const WS_PORT = 18321;
const PORT_FILE = join(homedir(), '.macos-control-mcp-ws-port');

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
let pendingRequests = new Map<string, { resolve: (data: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

/**
 * Start the WebSocket server. Called once when MCP server starts.
 */
export function startWsBridge(): void {
  if (wss) return; // already running

  try {
    wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });

    wss.on('listening', async () => {
      // Write port file so the extension knows where to connect
      try {
        await writeFile(PORT_FILE, String(WS_PORT));
      } catch { /* ignore */ }
    });

    wss.on('connection', (ws, req) => {
      // Only accept connections from localhost
      const origin = req.headers.origin || '';
      if (origin && !origin.includes('chrome-extension://')) {
        // Allow chrome extensions and no-origin (Node.js clients)
        // In practice Chrome extensions send origin = chrome-extension://...
      }

      extensionSocket = ws;

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          // Response to a scan request
          if (msg.id && pendingRequests.has(msg.id)) {
            const pending = pendingRequests.get(msg.id)!;
            clearTimeout(pending.timer);
            pendingRequests.delete(msg.id);
            pending.resolve(msg);
          }
        } catch { /* ignore malformed messages */ }
      });

      ws.on('close', () => {
        if (extensionSocket === ws) {
          extensionSocket = null;
        }
      });

      ws.on('error', () => {
        if (extensionSocket === ws) {
          extensionSocket = null;
        }
      });
    });

    wss.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port already in use — another MCP instance may be running
        wss = null;
      }
    });
  } catch {
    wss = null;
  }
}

/**
 * Request a web element scan from the connected Chrome extension.
 * Returns null if no extension is connected or scan fails.
 */
export async function requestWebScan(): Promise<any | null> {
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    return null;
  }

  const id = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      resolve(null); // timeout — treat as unavailable, not error
    }, 5000);

    pendingRequests.set(id, { resolve, reject, timer });

    try {
      extensionSocket!.send(JSON.stringify({ id, action: 'scan' }));
    } catch {
      clearTimeout(timer);
      pendingRequests.delete(id);
      resolve(null);
    }
  });
}

/**
 * Check if the extension is connected.
 */
export function isExtensionConnected(): boolean {
  return extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN;
}

/**
 * Stop the WebSocket server.
 */
export function stopWsBridge(): void {
  if (wss) {
    wss.close();
    wss = null;
  }
  extensionSocket = null;
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Bridge shutting down'));
  }
  pendingRequests.clear();
}
