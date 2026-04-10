// Visual animation tools — manual control of overlay effects
// These can be called independently for custom visual feedback
// Author: vito1317 <service@vito1317.com>

import { z } from 'zod';
import {
  showClickAnimation,
  showTrailAnimation,
  showTypeAnimation,
  showHighlightAnimation,
  showScrollAnimation,
} from '../utils/overlay-bridge.js';

export const animationTools = {
  animation_click: {
    description: 'Show a visual click ripple animation at the specified coordinates. Does NOT actually click — only shows the animation effect. Use for visual feedback.',
    inputSchema: z.object({
      x: z.number().describe('X coordinate'),
      y: z.number().describe('Y coordinate'),
      button: z.enum(['left', 'right', 'double']).optional().describe('Click style visual (default: left)'),
      color: z.string().optional().describe('Hex color (default: #007AFF)'),
    }),
    handler: async (args: { x: number; y: number; button?: string; color?: string }) => {
      showClickAnimation(args.x, args.y, {
        button: (args.button ?? 'left') as any,
        color: args.color,
      });
      return { content: [{ type: 'text' as const, text: `Click animation shown at (${args.x}, ${args.y})` }] };
    },
  },

  animation_trail: {
    description: 'Show a visual mouse movement trail animation along a path of coordinates. Does NOT actually move the mouse.',
    inputSchema: z.object({
      points: z.array(z.array(z.number()).length(2)).min(2).describe('Array of [x,y] coordinate pairs forming the path'),
      color: z.string().optional().describe('Hex color (default: #34C759)'),
      duration: z.number().optional().describe('Animation duration in seconds (default: 1.5)'),
    }),
    handler: async (args: { points: number[][]; color?: string; duration?: number }) => {
      showTrailAnimation(args.points as [number, number][], {
        color: args.color,
        duration: args.duration,
      });
      return { content: [{ type: 'text' as const, text: `Trail animation shown with ${args.points.length} points` }] };
    },
  },

  animation_type: {
    description: 'Show a visual typing indicator animation with text at specified coordinates. Does NOT actually type — only shows the animation.',
    inputSchema: z.object({
      x: z.number().describe('X coordinate'),
      y: z.number().describe('Y coordinate'),
      text: z.string().describe('Text to display in the typing animation'),
      color: z.string().optional().describe('Hex color (default: #AF52DE)'),
    }),
    handler: async (args: { x: number; y: number; text: string; color?: string }) => {
      showTypeAnimation(args.x, args.y, args.text, { color: args.color });
      return { content: [{ type: 'text' as const, text: `Type animation shown: "${args.text}"` }] };
    },
  },

  animation_highlight: {
    description: 'Highlight a rectangular region on screen with a pulsing border and optional label. Use to draw attention to UI elements.',
    inputSchema: z.object({
      x: z.number().describe('X coordinate of top-left corner'),
      y: z.number().describe('Y coordinate of top-left corner'),
      width: z.number().describe('Width of the highlight region'),
      height: z.number().describe('Height of the highlight region'),
      label: z.string().optional().describe('Label text to show above the highlight'),
      color: z.string().optional().describe('Hex color (default: #FF9500)'),
      duration: z.number().optional().describe('Duration in seconds (default: 2.0)'),
    }),
    handler: async (args: { x: number; y: number; width: number; height: number; label?: string; color?: string; duration?: number }) => {
      showHighlightAnimation(args.x, args.y, args.width, args.height, {
        label: args.label,
        color: args.color,
        duration: args.duration,
      });
      return { content: [{ type: 'text' as const, text: `Highlight animation shown at (${args.x},${args.y}) ${args.width}x${args.height}${args.label ? ` label="${args.label}"` : ''}` }] };
    },
  },

  animation_scroll: {
    description: 'Show a visual scroll direction indicator animation. Does NOT actually scroll.',
    inputSchema: z.object({
      x: z.number().describe('X coordinate'),
      y: z.number().describe('Y coordinate'),
      direction: z.enum(['up', 'down']).describe('Scroll direction'),
      color: z.string().optional().describe('Hex color (default: #5AC8FA)'),
    }),
    handler: async (args: { x: number; y: number; direction: 'up' | 'down'; color?: string }) => {
      showScrollAnimation(args.x, args.y, args.direction, { color: args.color });
      return { content: [{ type: 'text' as const, text: `Scroll ${args.direction} animation shown at (${args.x}, ${args.y})` }] };
    },
  },
};
