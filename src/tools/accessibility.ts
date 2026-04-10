// Accessibility API tools — UI element detection, tree inspection, element interaction
// Author: vito1317 <service@vito1317.com>

import { z } from 'zod';
import { execSwift } from '../utils/swift-bridge.js';

export const accessibilityTools = {
  accessibility_check: {
    description: 'Check if Accessibility permissions are granted. Required for UI element detection and programmatic interaction. If not granted, provides instructions for enabling it.',
    inputSchema: z.object({}),
    handler: async () => {
      const result = await execSwift('accessibility', 'check');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  accessibility_tree: {
    description: `Get the accessibility UI element tree of an application. Returns a hierarchical tree of all UI elements (buttons, text fields, labels, etc.) with their role, title, value, position, size, and state. This is the primary way to understand what's on screen without relying on screenshots. Use maxDepth to control detail level.`,
    inputSchema: z.object({
      pid: z.number().optional().describe('Process ID of the app (omit for frontmost app)'),
      maxDepth: z.number().min(1).max(10).optional().describe('Maximum depth of the tree (1=shallow, 10=deep). Use 2-3 for overview, 5+ for detailed inspection. (default: 3)'),
    }),
    handler: async (args: { pid?: number; maxDepth?: number }) => {
      const maxDepth = args.maxDepth ?? 3;
      const cmdArgs = [];
      if (args.pid !== undefined) cmdArgs.push(String(args.pid));
      else cmdArgs.push('');
      cmdArgs.push(String(maxDepth));

      const result = await execSwift('accessibility', 'tree', ...cmdArgs);

      // Format summary for AI
      let summary = '';
      if (result.success && result.tree) {
        summary = formatAccessibilityTree(result.tree as any, 0);
      }

      return {
        content: [
          { type: 'text' as const, text: summary || JSON.stringify(result, null, 2) },
        ],
      };
    },
  },

  accessibility_element_at: {
    description: 'Get the UI element at a specific screen coordinate. Returns the element\'s role, title, value, position, and size. Useful for identifying what is under the mouse cursor or at a specific screen location.',
    inputSchema: z.object({
      x: z.number().describe('X coordinate on screen'),
      y: z.number().describe('Y coordinate on screen'),
    }),
    handler: async (args: { x: number; y: number }) => {
      const result = await execSwift('accessibility', 'element-at', String(args.x), String(args.y));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  accessibility_click: {
    description: 'Click a UI element by its accessibility role and optional title. This performs an accessibility "press" action, which is more reliable than coordinate-based clicking for buttons, menu items, etc.',
    inputSchema: z.object({
      role: z.string().describe('Accessibility role (e.g., "AXButton", "AXMenuItem", "AXTextField", "AXCheckBox", "AXLink")'),
      title: z.string().optional().describe('Element title to match (partial, case-insensitive)'),
      pid: z.number().optional().describe('Process ID of the app (omit for frontmost app)'),
    }),
    handler: async (args: { role: string; title?: string; pid?: number }) => {
      const cmdArgs = [args.role];
      if (args.title) cmdArgs.push(args.title);
      if (args.pid !== undefined) cmdArgs.push(String(args.pid));

      const result = await execSwift('accessibility', 'click', ...cmdArgs);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },
};

/**
 * Format accessibility tree into a readable indented text format for AI consumption
 */
function formatAccessibilityTree(node: any, depth: number): string {
  const indent = '  '.repeat(depth);
  const parts: string[] = [];

  // Role and title
  let line = `${indent}[${node.role || 'unknown'}]`;
  if (node.title) line += ` "${node.title}"`;
  if (node.value) line += ` value="${node.value}"`;
  if (node.description) line += ` desc="${node.description}"`;
  if (node.identifier) line += ` id="${node.identifier}"`;

  // Position and size
  if (node.position && node.size) {
    line += ` @(${Math.round(node.position.x)},${Math.round(node.position.y)}) ${Math.round(node.size.width)}x${Math.round(node.size.height)}`;
  }

  // State
  const states: string[] = [];
  if (node.focused) states.push('focused');
  if (node.enabled === false) states.push('disabled');
  if (states.length) line += ` [${states.join(',')}]`;

  parts.push(line);

  // Children
  if (node.children) {
    for (const child of node.children) {
      parts.push(formatAccessibilityTree(child, depth + 1));
    }
  }

  return parts.join('\n');
}
