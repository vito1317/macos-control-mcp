// Screenshot & screen analysis tools — capture, grid overlay, AI optimization
// Author: vito1317 <service@vito1317.com>

import { z } from 'zod';
import { execFile } from 'node:child_process';
import { readFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCoordinateGrid, optimizeForAI, cropRegion, annotatePoints } from '../utils/image.js';
import { execSwift } from '../utils/swift-bridge.js';

async function captureScreen(options: {
  region?: { x: number; y: number; width: number; height: number };
  windowId?: number;
  displayId?: number;
}): Promise<Buffer> {
  const tempFile = `/tmp/mcp-screenshot-${Date.now()}.png`;

  const args: string[] = ['-x']; // no sound

  if (options.windowId) {
    args.push('-l', String(options.windowId));
  } else if (options.region) {
    const { x, y, width, height } = options.region;
    args.push('-R', `${x},${y},${width},${height}`);
  } else if (options.displayId) {
    args.push('-D', String(options.displayId));
  }

  args.push(tempFile);

  await new Promise<void>((resolve, reject) => {
    execFile('/usr/sbin/screencapture', args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`screencapture failed: ${error.message} | stderr: ${stderr}`));
      else resolve();
    });
  });

  const buffer = await readFile(tempFile);
  await unlink(tempFile).catch(() => {}); // cleanup
  return buffer;
}

/**
 * Get the Retina scale factor for the main screen.
 */
async function getScaleFactor(): Promise<number> {
  try {
    const result = await execSwift('screen', 'info');
    const screens = result?.screens as any[] | undefined;
    const mainScreen = screens?.find((s: any) => s.isMain) || screens?.[0];
    return mainScreen?.scaleFactor || 1;
  } catch {
    return 1;
  }
}

export const screenshotTools = {
  screenshot: {
    description: `Take a screenshot of the entire screen or a specific region. Returns the image optimized for AI analysis. Options include coordinate grid overlay to help identify element positions, compression for faster transfer, and region cropping. NOTE: When reading element positions from the screenshot, aim for the vertical center or slightly below center of the target — AI visual perception tends to estimate Y coordinates a few pixels too high.`,
    inputSchema: z.object({
      region: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }).optional().describe('Capture specific region (x, y, width, height). Omit for full screen.'),
      windowId: z.number().optional().describe('Capture specific window by ID (from window_list)'),
      showGrid: z.boolean().optional().describe('Overlay coordinate grid to help AI identify positions (default: false)'),
      gridSpacing: z.number().optional().describe('Grid line spacing in pixels (default: 100)'),
      maxWidth: z.number().optional().describe('Max width for AI optimization (downscale if larger) (default: 1920)'),
      quality: z.number().min(1).max(100).optional().describe('Image quality (1-100) (default: 80)'),
      format: z.enum(['png', 'jpeg']).optional().describe('Output format (default: png)'),
    }),
    handler: async (args: {
      region?: { x: number; y: number; width: number; height: number };
      windowId?: number;
      showGrid?: boolean;
      gridSpacing?: number;
      maxWidth?: number;
      quality?: number;
      format?: 'png' | 'jpeg';
    }) => {
      const showGrid = args.showGrid ?? false;
      const gridSpacing = args.gridSpacing ?? 100;
      const maxWidth = args.maxWidth ?? 1920;
      const quality = args.quality ?? 80;
      const format = args.format ?? 'png';
      let imageBuffer = await captureScreen({
        region: args.region,
        windowId: args.windowId,
      });

      // Add coordinate grid — keep physical resolution, scale grid by scaleFactor
      // so labels show logical coordinates that match mouse_click / CGEvent
      if (showGrid) {
        const sf = await getScaleFactor();
        imageBuffer = await addCoordinateGrid(imageBuffer, {
          spacing: gridSpacing,
          showLabels: true,
        }, sf);
      }

      // Optimize for AI
      const optimized = await optimizeForAI(imageBuffer, {
        maxWidth: maxWidth,
        quality: quality,
        format: format,
      });

      const base64 = optimized.buffer.toString('base64');
      const sizeInfo = `${optimized.width}x${optimized.height}, ${(optimized.optimizedSize / 1024).toFixed(1)}KB (original: ${(optimized.originalSize / 1024).toFixed(1)}KB)`;

      return {
        content: [
          {
            type: 'image' as const,
            data: base64,
            mimeType: optimized.mimeType,
          },
          {
            type: 'text' as const,
            text: `Screenshot captured: ${sizeInfo}${showGrid ? ` | Grid: ${gridSpacing}px spacing (logical coordinates). IMPORTANT: When reading coordinates from the grid, aim for the vertical CENTER or slightly BELOW center of target elements — visual perception tends to bias upward by a few pixels.` : ''}`,
          },
        ],
      };
    },
  },

  screenshot_annotated: {
    description: 'Take a screenshot and annotate specific points with labels. Useful for marking UI elements, buttons, or areas of interest for AI reference.',
    inputSchema: z.object({
      points: z.array(z.object({
        x: z.number().describe('X coordinate of the point'),
        y: z.number().describe('Y coordinate of the point'),
        label: z.string().describe('Label text for this point'),
        color: z.string().optional().describe('Color of the marker (hex) (default: #FF0000)'),
      })).describe('Points to annotate on the screenshot'),
      maxWidth: z.number().optional().describe('Max width for optimization (default: 1920)'),
    }),
    handler: async (args: {
      points: Array<{ x: number; y: number; label: string; color?: string }>;
      maxWidth?: number;
    }) => {
      const maxWidthVal = args.maxWidth ?? 1920;
      // Ensure all points have a color
      const pointsWithColor = args.points.map(p => ({
        ...p,
        color: p.color ?? '#FF0000'
      }));

      let imageBuffer = await captureScreen({});
      // Keep physical resolution, scale annotations by scaleFactor
      const sf = await getScaleFactor();
      imageBuffer = await annotatePoints(imageBuffer, pointsWithColor, sf);

      const optimized = await optimizeForAI(imageBuffer, { maxWidth: maxWidthVal });
      const base64 = optimized.buffer.toString('base64');

      return {
        content: [
          { type: 'image' as const, data: base64, mimeType: optimized.mimeType },
          { type: 'text' as const, text: `Annotated screenshot: ${args.points.length} points marked` },
        ],
      };
    },
  },

  screen_info: {
    description: 'Get information about all connected displays/screens — resolution, position, scale factor, visible area.',
    inputSchema: z.object({}),
    handler: async () => {
      const result = await execSwift('screen', 'info');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },
};
