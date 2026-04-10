// Mouse control tools — move, click, drag, scroll, position tracking
// Author: vito1317 <service@vito1317.com>

import { z } from 'zod';
import { execSwift } from '../utils/swift-bridge.js';
import { showClickAnimation, showTrailAnimation, showScrollAnimation } from '../utils/overlay-bridge.js';

export const mouseTools = {
  mouse_move: {
    description: 'Move the mouse cursor to specified screen coordinates (x, y). Coordinates use top-left origin.',
    inputSchema: z.object({
      x: z.number().describe('X coordinate (pixels from left)'),
      y: z.number().describe('Y coordinate (pixels from top)'),
    }),
    handler: async (args: { x: number; y: number }) => {
      // Show trail animation from current position to target
      try {
        const pos = await execSwift('mouse', 'position');
        if (pos?.success) {
          const fromX = (pos as any).x ?? args.x;
          const fromY = (pos as any).y ?? args.y;
          const dx = args.x - fromX;
          const dy = args.y - fromY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > 20) {
            const steps = Math.min(Math.max(Math.round(distance / 30), 5), 20);
            const points: [number, number][] = [];
            for (let i = 0; i <= steps; i++) {
              const t = i / steps;
              const ease = 1 - Math.pow(1 - t, 3);
              points.push([fromX + dx * ease, fromY + dy * ease]);
            }
            showTrailAnimation(points, { color: '#34C759', duration: 0.5 });
          }
        }
      } catch { /* skip animation */ }
      const result = await execSwift('mouse', 'move', String(args.x), String(args.y));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  mouse_click: {
    description: 'Click the mouse at specified coordinates. Supports left/right/middle button and single/double/triple click. Defaults: button=left, clicks=1.',
    inputSchema: z.object({
      x: z.number().describe('X coordinate'),
      y: z.number().describe('Y coordinate'),
      button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default: left)'),
      clicks: z.number().min(1).max(3).optional().describe('Number of clicks: 1=single, 2=double, 3=triple (default: 1)'),
    }),
    handler: async (args: { x: number; y: number; button?: string; clicks?: number }) => {
      const button = args.button ?? 'left';
      const clicks = args.clicks ?? 1;
      const animButton = clicks >= 2 ? 'double' : button === 'right' ? 'right' : 'left';

      // Get current mouse position and show trail animation to target
      try {
        const pos = await execSwift('mouse', 'position');
        if (pos?.success) {
          const fromX = (pos as any).x ?? args.x;
          const fromY = (pos as any).y ?? args.y;
          const dx = args.x - fromX;
          const dy = args.y - fromY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          // Only show trail if mouse needs to move a significant distance
          if (distance > 30) {
            const steps = Math.min(Math.max(Math.round(distance / 30), 5), 20);
            const points: [number, number][] = [];
            for (let i = 0; i <= steps; i++) {
              const t = i / steps;
              // Ease-out curve for natural movement feel
              const ease = 1 - Math.pow(1 - t, 3);
              points.push([fromX + dx * ease, fromY + dy * ease]);
            }
            showTrailAnimation(points, { color: '#007AFF', duration: 0.4 });
          }
        }
      } catch { /* skip trail if position fails */ }

      // Show click ripple at target after a small delay for trail to arrive
      setTimeout(() => {
        showClickAnimation(args.x, args.y, { button: animButton as any });
      }, 300);

      const result = await execSwift('mouse', 'click', String(args.x), String(args.y), button, String(clicks));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  mouse_drag: {
    description: 'Drag the mouse from one position to another. Useful for drag-and-drop, selecting text, resizing windows.',
    inputSchema: z.object({
      fromX: z.number().describe('Start X coordinate'),
      fromY: z.number().describe('Start Y coordinate'),
      toX: z.number().describe('End X coordinate'),
      toY: z.number().describe('End Y coordinate'),
      duration: z.number().min(0.1).max(5).optional().describe('Duration of drag in seconds (default: 0.5)'),
    }),
    handler: async (args: { fromX: number; fromY: number; toX: number; toY: number; duration?: number }) => {
      const duration = args.duration ?? 0.5;
      // Show drag trail animation
      const steps = 10;
      const points: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        points.push([
          args.fromX + (args.toX - args.fromX) * t,
          args.fromY + (args.toY - args.fromY) * t,
        ]);
      }
      showTrailAnimation(points, { color: '#FF9500', duration: duration + 0.5 });
      const result = await execSwift('mouse', 'drag', String(args.fromX), String(args.fromY), String(args.toX), String(args.toY), String(duration));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  mouse_scroll: {
    description: 'Scroll at specified coordinates. Positive deltaY scrolls down, negative scrolls up. Positive deltaX scrolls right.',
    inputSchema: z.object({
      x: z.number().describe('X coordinate to scroll at'),
      y: z.number().describe('Y coordinate to scroll at'),
      deltaX: z.number().optional().describe('Horizontal scroll amount, positive=right (default: 0)'),
      deltaY: z.number().describe('Vertical scroll amount (positive=down, negative=up)'),
    }),
    handler: async (args: { x: number; y: number; deltaX?: number; deltaY: number }) => {
      const deltaX = args.deltaX ?? 0;
      // Show scroll animation
      showScrollAnimation(args.x, args.y, args.deltaY > 0 ? 'down' : 'up');
      const result = await execSwift('mouse', 'scroll', String(args.x), String(args.y), String(deltaX), String(args.deltaY));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  mouse_position: {
    description: 'Get the current mouse cursor position on screen. Returns both CoreGraphics (top-left origin) and AppKit (bottom-left origin) coordinates.',
    inputSchema: z.object({}),
    handler: async () => {
      const result = await execSwift('mouse', 'position');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },
};
