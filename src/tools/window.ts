// Window management tools — list, focus, resize, minimize, close windows
// Author: vito1317 <service@vito1317.com>

import { z } from 'zod';
import { execSwift } from '../utils/swift-bridge.js';

export const windowTools = {
  window_list: {
    description: 'List all visible windows on screen with their app name, window title, position, size, and process ID. Useful for understanding what is currently open and finding window IDs for screenshots.',
    inputSchema: z.object({}),
    handler: async () => {
      const result = await execSwift('window', 'list');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  window_focus: {
    description: 'Bring an application to the foreground and focus it. Matches app name partially (case-insensitive).',
    inputSchema: z.object({
      appName: z.string().describe('Application name to focus (e.g., "Safari", "Terminal", "Visual Studio Code")'),
    }),
    handler: async (args: { appName: string }) => {
      const result = await execSwift('window', 'focus', args.appName);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  window_resize: {
    description: 'Move and resize an application window to specific coordinates and dimensions.',
    inputSchema: z.object({
      appName: z.string().describe('Application name'),
      x: z.number().describe('New X position'),
      y: z.number().describe('New Y position'),
      width: z.number().describe('New width'),
      height: z.number().describe('New height'),
    }),
    handler: async (args: { appName: string; x: number; y: number; width: number; height: number }) => {
      const result = await execSwift('window', 'resize', args.appName, String(args.x), String(args.y), String(args.width), String(args.height));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  window_minimize: {
    description: 'Minimize the front window of an application.',
    inputSchema: z.object({
      appName: z.string().describe('Application name'),
    }),
    handler: async (args: { appName: string }) => {
      const result = await execSwift('window', 'minimize', args.appName);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  window_close: {
    description: 'Close the front window of an application.',
    inputSchema: z.object({
      appName: z.string().describe('Application name'),
    }),
    handler: async (args: { appName: string }) => {
      const result = await execSwift('window', 'close', args.appName);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  apps_list: {
    description: 'List all running applications with their name, PID, bundle ID, and active/hidden status.',
    inputSchema: z.object({}),
    handler: async () => {
      const result = await execSwift('apps', 'list');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },
};
