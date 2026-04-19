// AI information optimization tools — enhanced context for AI decision-making
// Combines screenshot, accessibility, and coordinate data for optimal AI input
// Author: vito1317 <service@vito1317.com>

import { z } from 'zod';
import { execSwift } from '../utils/swift-bridge.js';
import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { addCoordinateGrid, optimizeForAI, annotatePoints } from '../utils/image.js';
import WebSocket from 'ws';

async function captureScreenBuffer(): Promise<Buffer> {
  const tempFile = `/tmp/mcp-capture-${Date.now()}.png`;

  await new Promise<void>((resolve, reject) => {
    execFile('/usr/sbin/screencapture', ['-x', tempFile], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`screencapture failed: ${error.message} | stderr: ${stderr} | stdout: ${stdout}`));
      else resolve();
    });
  });

  const buffer = await readFile(tempFile);
  await unlink(tempFile).catch(() => {});
  return buffer;
}

/**
 * Get the Retina scale factor for the main screen.
 * On Retina displays this is typically 2, on non-Retina it's 1.
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

/**
 * Try to scan web page elements via Chrome DevTools Protocol.
 * Returns null if CDP is not available (Chrome not running with --remote-debugging-port).
 * Non-throwing — silently returns null on any failure.
 */
async function tryGetWebElements(cdpPort: number = 9222): Promise<{
  elements: Array<{ kind: string; label: string; cx: number; cy: number; w: number; h: number; tag: string; href?: string; type?: string }>;
  title: string;
  url: string;
  windowOffsetX: number;
  windowOffsetY: number;
} | null> {
  try {
    const http = await import('node:http');

    // Quick check if CDP is available (500ms timeout)
    const cdpAvailable = await new Promise<boolean>((resolve) => {
      const req = http.get(`http://127.0.0.1:${cdpPort}/json/version`, (res) => {
        let d = '';
        res.on('data', (c: Buffer) => d += c);
        res.on('end', () => resolve(d.includes('Chrome')));
      });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => { req.destroy(); resolve(false); });
    });

    if (!cdpAvailable) return null;

    // Get tabs
    const tabsJson = await new Promise<string>((resolve, reject) => {
      http.get(`http://127.0.0.1:${cdpPort}/json`, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    const tabs = JSON.parse(tabsJson).filter((t: any) => t.type === 'page');
    if (tabs.length === 0) return null;

    const wsUrl = tabs[0].webSocketDebuggerUrl;
    if (!wsUrl) return null;

    // Inject JS to get all interactive elements
    const jsCode = `
(function() {
  const selectors = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
    '[role="combobox"]', '[role="listbox"]', '[role="option"]',
    '[role="slider"]', '[role="textbox"]',
    '[onclick]', '[tabindex]', 'summary', 'details', 'label[for]',
    '[contenteditable="true"]',
  ];
  const allElements = document.querySelectorAll(selectors.join(','));
  const results = [];
  const seen = new Set();
  for (const el of allElements) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight ||
        rect.right < 0 || rect.left > window.innerWidth) continue;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    const key = Math.round(rect.left) + ',' + Math.round(rect.top) + ',' + Math.round(rect.width);
    if (seen.has(key)) continue;
    seen.add(key);
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    const role = el.getAttribute('role') || '';
    const text = (el.textContent || '').trim().substring(0, 60);
    const ariaLabel = el.getAttribute('aria-label') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const href = el.getAttribute('href') || '';
    const name = el.getAttribute('name') || '';
    const id = el.getAttribute('id') || '';
    let kind = tag;
    if (tag === 'input') kind = 'input[' + (type || 'text') + ']';
    if (role) kind = role;
    if (tag === 'a') kind = 'link';
    const label = ariaLabel || placeholder || text || name || id || href?.substring(0, 40) || '(no label)';
    results.push({
      kind, label: label.substring(0, 60),
      cx: Math.round(rect.left + rect.width / 2),
      cy: Math.round(rect.top + rect.height / 2),
      w: Math.round(rect.width), h: Math.round(rect.height),
      tag, ...(href ? { href: href.substring(0, 80) } : {}), ...(type ? { type } : {}),
    });
  }
  return JSON.stringify({
    success: true, url: location.href, title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    count: results.length, elements: results
  });
})()`;

    const result = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 5000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: jsCode, returnByValue: true } }));
      });
      ws.on('message', (data: WebSocket.Data) => {
        clearTimeout(timeout);
        const resp = JSON.parse(data.toString());
        if (resp.id === 1) {
          ws.close();
          const val = resp.result?.result?.value;
          if (val) resolve(val);
          else reject(new Error('JS eval failed'));
        }
      });
      ws.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
    });

    const parsed = JSON.parse(result);
    if (!parsed.success) return null;

    // Get Chrome window bounds for screen coordinate conversion
    let windowOffsetX = 0;
    let windowOffsetY = 0;
    try {
      const boundsResult = await new Promise<string>((resolve, reject) => {
        execFile('/usr/bin/osascript', ['-e', 'tell application "Google Chrome" to get bounds of front window'], { timeout: 3000 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout.trim());
        });
      });
      const bounds = boundsResult.split(',').map(s => parseInt(s.trim()));
      if (bounds.length >= 2) {
        windowOffsetX = bounds[0];
        windowOffsetY = bounds[1] + 90; // Chrome toolbar+tabs height
      }
    } catch {
      windowOffsetX = 0;
      windowOffsetY = 120;
    }

    return {
      elements: parsed.elements,
      title: parsed.title,
      url: parsed.url,
      windowOffsetX,
      windowOffsetY,
    };
  } catch {
    return null;
  }
}

export const aiOptimizeTools = {
  ai_screen_context: {
    description: `[AI-Optimized] Capture a comprehensive snapshot of the current screen state for AI analysis. Returns: 1) Screenshot with coordinate grid overlay, 2) Accessibility tree of the frontmost app (interactive elements with positions), 3) Current mouse position, 4) Frontmost app info. Good for understanding screen context. For CLICKING elements, prefer ai_screen_elements which gives precise coordinates.`,
    inputSchema: z.object({
      gridSpacing: z.number().optional().describe('Coordinate grid spacing in pixels (default: 100)'),
      maxDepth: z.number().min(1).max(5).optional().describe('Accessibility tree depth (default: 3)'),
      maxWidth: z.number().optional().describe('Max screenshot width (smaller = faster) (default: 1280)'),
      includeScreenshot: z.boolean().optional().describe('Include screenshot image (default: true)'),
      includeAccessibility: z.boolean().optional().describe('Include accessibility tree (default: true)'),
    }),
    handler: async (args: {
      gridSpacing?: number;
      maxDepth?: number;
      maxWidth?: number;
      includeScreenshot?: boolean;
      includeAccessibility?: boolean;
    }) => {
      const gridSpacing = args.gridSpacing ?? 100;
      const maxDepth = args.maxDepth ?? 3;
      const maxWidth = args.maxWidth ?? 1280;
      const includeScreenshot = args.includeScreenshot ?? true;
      const includeAccessibility = args.includeAccessibility ?? true;

      const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];

      // Gather all info in parallel
      const promises: Promise<any>[] = [];

      // 1. Screenshot with grid (keep physical resolution, scale grid to match logical coords)
      if (includeScreenshot) {
        promises.push(
          (async () => {
            const [imgBuffer, sf] = await Promise.all([captureScreenBuffer(), getScaleFactor()]);
            const gridded = await addCoordinateGrid(imgBuffer, { spacing: gridSpacing }, sf);
            return optimizeForAI(gridded, { maxWidth: maxWidth, format: 'jpeg', quality: 75 });
          })()
        );
      } else {
        promises.push(Promise.resolve(null));
      }

      // 2. Accessibility tree
      if (includeAccessibility) {
        promises.push(execSwift('accessibility', 'tree', '', String(maxDepth)));
      } else {
        promises.push(Promise.resolve(null));
      }

      // 3. Mouse position
      promises.push(execSwift('mouse', 'position'));

      // 4. Screen info
      promises.push(execSwift('screen', 'info'));

      const [screenshot, accTree, mousePos, screenInfo] = await Promise.all(promises);

      // Build response
      if (screenshot) {
        content.push({
          type: 'image',
          data: screenshot.buffer.toString('base64'),
          mimeType: screenshot.mimeType,
        });
      }

      // Build text context
      const textParts: string[] = [];
      textParts.push('=== Screen Context for AI ===\n');

      // Mouse position
      if (mousePos?.success) {
        textParts.push(`📍 Mouse position: (${Math.round(mousePos.x)}, ${Math.round(mousePos.y)})`);
      }

      // Screen info
      if (screenInfo?.success && screenInfo.screens) {
        const screens = screenInfo.screens as any[];
        const mainScreen = screens.find((s: any) => s.isMain) || screens[0];
        if (mainScreen) {
          textParts.push(`🖥️ Screen: ${mainScreen.frame.width}x${mainScreen.frame.height} @${mainScreen.scaleFactor}x`);
        }
      }

      // Screenshot info
      if (screenshot) {
        textParts.push(`📸 Screenshot: ${screenshot.width}x${screenshot.height} (grid: ${gridSpacing}px)`);
      }

      // Accessibility tree
      if (accTree?.success) {
        textParts.push(`\n🌲 Accessibility Tree (${accTree.app || 'frontmost app'}):`);
        if (accTree.tree) {
          textParts.push(formatCompactTree(accTree.tree, 0));
        }
      }

      textParts.push('\n💡 Tip: Use coordinate grid lines on the screenshot to identify element positions. IMPORTANT: When estimating Y coordinates from the screenshot, aim for the vertical CENTER or slightly BELOW center of the target element — visual perception tends to bias upward by a few pixels. Use accessibility_element_at to inspect specific coordinates for precision.');

      content.push({ type: 'text', text: textParts.join('\n') });

      return { content };
    },
  },

  ai_find_element: {
    description: `[AI-Optimized] Find a UI element by description in natural language. Searches the accessibility tree of the frontmost app and returns matching elements with their exact coordinates. Use this to locate buttons, text fields, menu items, etc.`,
    inputSchema: z.object({
      description: z.string().describe('Natural language description of the element to find (e.g., "the Save button", "search text field", "close button")'),
      pid: z.number().optional().describe('Process ID of the app (omit for frontmost app)'),
    }),
    handler: async (args: { description: string; pid?: number }) => {
      const treeArgs = args.pid !== undefined ? [String(args.pid), '6'] : ['', '6'];
      const result = await execSwift('accessibility', 'tree', ...treeArgs);

      if (!result.success || !result.tree) {
        return {
          content: [{ type: 'text' as const, text: 'Failed to get accessibility tree: ' + (result.error || 'unknown error') }],
          isError: true,
        };
      }

      // Search the tree for matching elements
      const searchTerms = args.description.toLowerCase().split(/\s+/);
      const matches = searchTree(result.tree as any, searchTerms, []);

      if (matches.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `No elements found matching "${args.description}". Try a different description or use accessibility_tree to browse all elements.`,
          }],
        };
      }

      const formatted = matches.slice(0, 10).map((m, i) => {
        const pos = m.position ? `@(${Math.round(m.position.x)},${Math.round(m.position.y)})` : '';
        const size = m.size ? `${Math.round(m.size.width)}x${Math.round(m.size.height)}` : '';
        const center = m.position && m.size
          ? `center=(${Math.round(m.position.x + m.size.width / 2)},${Math.round(m.position.y + m.size.height / 2) + 4})`
          : '';
        return `${i + 1}. [${m.role}] "${m.title || m.value || m.description || ''}" ${pos} ${size} ${center}`;
      });

      return {
        content: [{
          type: 'text' as const,
          text: `Found ${matches.length} matching element(s) for "${args.description}":\n\n${formatted.join('\n')}\n\n💡 Use the center coordinates with mouse_click to interact with these elements.`,
        }],
      };
    },
  },

  ai_ocr_region: {
    description: `[AI-Optimized] Extract text from a screen region using macOS Vision framework OCR. Returns recognized text with positions. Useful for reading text that isn't accessible via the accessibility API.`,
    inputSchema: z.object({
      x: z.number().describe('Region X coordinate'),
      y: z.number().describe('Region Y coordinate'),
      width: z.number().describe('Region width'),
      height: z.number().describe('Region height'),
    }),
    handler: async (args: { x: number; y: number; width: number; height: number }) => {
      // Use macOS built-in shortcuts/Vision framework via AppleScript
      // First capture the region
      const tempDir = `/tmp/mcp-ocr-${Date.now()}`;
      const { mkdir } = await import('node:fs/promises');
      await mkdir(tempDir, { recursive: true });
      const tempFile = join(tempDir, 'ocr-region.png');

      await new Promise<void>((resolve, reject) => {
        execFile('/usr/sbin/screencapture', [
          '-x', '-R', `${args.x},${args.y},${args.width},${args.height}`, tempFile
        ], { timeout: 30000 }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      // Use Swift's Vision framework via a mini Swift script
      const ocrScript = `
import Vision
import Foundation
import AppKit

let imagePath = "${tempFile}"
guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("{\\"success\\": false, \\"error\\": \\"Failed to load image\\"}")
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hant", "zh-Hans", "en-US", "ja-JP"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])

var results: [[String: Any]] = []
for observation in request.results ?? [] {
    if let candidate = observation.topCandidates(1).first {
        let box = observation.boundingBox
        results.append([
            "text": candidate.string,
            "confidence": candidate.confidence,
            "bounds": [
                "x": box.origin.x,
                "y": box.origin.y,
                "width": box.width,
                "height": box.height
            ]
        ])
    }
}

let output: [String: Any] = ["success": true, "texts": results, "count": results.count]
if let data = try? JSONSerialization.data(withJSONObject: output, options: []),
   let str = String(data: data, encoding: .utf8) {
    print(str)
}
`;
      const swiftFile = join(tempDir, 'ocr.swift');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(swiftFile, ocrScript);

      try {
        const ocrResult = await new Promise<string>((resolve, reject) => {
          execFile('/usr/bin/swift', [swiftFile], {
            timeout: 30000,
            maxBuffer: 5 * 1024 * 1024,
          }, (error, stdout, stderr) => {
            if (error) reject(new Error(`OCR failed: ${stderr || error.message}`));
            else resolve(stdout.trim());
          });
        });

        const parsed = JSON.parse(ocrResult);
        let textOutput = `OCR Results (region ${args.x},${args.y} ${args.width}x${args.height}):\n\n`;

        if (parsed.texts && parsed.texts.length > 0) {
          for (const t of parsed.texts) {
            textOutput += `• "${t.text}" (confidence: ${(t.confidence * 100).toFixed(1)}%)\n`;
          }
        } else {
          textOutput += '(No text recognized in this region)';
        }

        return { content: [{ type: 'text' as const, text: textOutput }] };
      } catch (error: any) {
        // Fallback: return the screenshot of the region for AI to read directly
        const imgBuffer = await readFile(tempFile);
        const optimized = await optimizeForAI(imgBuffer, { maxWidth: 800, format: 'png' });

        return {
          content: [
            { type: 'image', data: optimized.buffer.toString('base64'), mimeType: 'image/png' },
            { type: 'text' as const, text: `OCR engine unavailable. Here is the captured region image for visual inspection. Error: ${error.message}` },
          ],
        };
      } finally {
        await unlink(tempFile).catch(() => {});
      }
    },
  },

  ai_screen_elements: {
    description: `🎯 PREFERRED — Use this FIRST when you need to click or interact with UI elements. Auto-detects ALL interactive elements (buttons, fields, links, etc.) with precise center coordinates. Uses accessibility tree for native apps, AND automatically scans web page elements via Chrome DevTools Protocol when a browser is frontmost. Returns: 1) Annotated screenshot with numbered markers on every element, 2) Element list with [number] role "title" center=(x,y). Web elements are prefixed with "web:" (e.g. web:input, web:button, web:link). These coordinates are MORE ACCURATE than manually reading positions from a plain screenshot. Always prefer this over screenshot+manual coordinate guessing.`,
    inputSchema: z.object({
      pid: z.number().optional().describe('Process ID of app to analyze (omit for frontmost app)'),
      maxWidth: z.number().optional().describe('Max screenshot width (default: 1440)'),
    }),
    handler: async (args: { pid?: number; maxWidth?: number }) => {
      const maxWidth = args.maxWidth ?? 1440;

      // 1. Get accessibility tree (deep) to find all interactive elements
      // Keep physical resolution, scale annotations by scaleFactor
      const treeArgs = args.pid !== undefined ? [String(args.pid), '8'] : ['', '8'];
      const [treeResult, imgBuffer, sf] = await Promise.all([
        execSwift('accessibility', 'tree', ...treeArgs),
        captureScreenBuffer(),
        getScaleFactor(),
      ]);

      if (!treeResult.success || !treeResult.tree) {
        // Fallback: just return screenshot with grid
        const optimized = await optimizeForAI(
          await addCoordinateGrid(imgBuffer, { spacing: 100 }),
          { maxWidth, format: 'jpeg', quality: 75 }
        );
        return {
          content: [
            { type: 'image' as const, data: optimized.buffer.toString('base64'), mimeType: optimized.mimeType },
            { type: 'text' as const, text: 'Accessibility tree unavailable. Showing grid screenshot instead.' },
          ],
        };
      }

      // 2. Extract all interactive/visible elements with positions
      const interactiveRoles = new Set([
        'AXButton', 'AXTextField', 'AXTextArea', 'AXCheckBox', 'AXRadioButton',
        'AXPopUpButton', 'AXComboBox', 'AXSlider', 'AXLink', 'AXMenuItem',
        'AXMenuBarItem', 'AXTab', 'AXTabGroup', 'AXToolbar', 'AXImage',
        'AXStaticText', 'AXCell', 'AXRow', 'AXList', 'AXTable',
        'AXScrollBar', 'AXSplitter', 'AXIncrementor', 'AXColorWell',
        'AXMenu', 'AXMenuButton', 'AXDisclosureTriangle', 'AXOutline',
      ]);

      const elements: Array<{
        index: number;
        role: string;
        title: string;
        cx: number;
        cy: number;
        x: number;
        y: number;
        width: number;
        height: number;
      }> = [];

      function collectElements(node: any) {
        if (node.position && node.size && node.size.width > 2 && node.size.height > 2) {
          const hasContent = node.title || node.value || node.description || node.identifier;
          const isInteractive = interactiveRoles.has(node.role);

          if (isInteractive || hasContent) {
            const cx = Math.round(node.position.x + node.size.width / 2);
            // +4 compensates for AI vision model's systematic upward bias when
            // determining click targets from screenshots
            const cy = Math.round(node.position.y + node.size.height / 2) + 4;
            // Filter off-screen and duplicates
            if (cx > 0 && cy > 0 && cx < 3000 && cy < 2000) {
              elements.push({
                index: elements.length + 1,
                role: node.role,
                title: node.title || node.value || node.description || node.identifier || '',
                cx, cy,
                x: Math.round(node.position.x),
                y: Math.round(node.position.y),
                width: Math.round(node.size.width),
                height: Math.round(node.size.height),
              });
            }
          }
        }
        if (node.children) {
          for (const child of node.children) {
            collectElements(child);
          }
        }
      }

      collectElements(treeResult.tree);

      // 2.5. If frontmost app is a browser, also scan web page elements via CDP
      const appName = (String(treeResult.app || '')).toLowerCase();
      const isBrowser = appName.includes('chrome') || appName.includes('chromium') ||
                        appName.includes('brave') || appName.includes('edge') ||
                        appName.includes('arc') || appName.includes('opera');
      let webElementsNote = '';

      if (isBrowser) {
        const webResult = await tryGetWebElements();
        if (webResult && webResult.elements.length > 0) {
          // Add web elements with screen coordinates, continuing the index sequence
          for (const webEl of webResult.elements) {
            const screenX = webEl.cx + webResult.windowOffsetX;
            const screenY = webEl.cy + webResult.windowOffsetY;
            if (screenX > 0 && screenY > 0 && screenX < 3000 && screenY < 2000) {
              elements.push({
                index: elements.length + 1,
                role: `web:${webEl.kind}`,
                title: webEl.label,
                cx: screenX,
                cy: screenY,
                x: webEl.cx + webResult.windowOffsetX - Math.round(webEl.w / 2),
                y: webEl.cy + webResult.windowOffsetY - Math.round(webEl.h / 2),
                width: webEl.w,
                height: webEl.h,
              });
            }
          }
          webElementsNote = ` (includes ${webResult.elements.length} web page elements via CDP)`;
        }
      }

      // 3. Annotate screenshot with numbered markers
      const colors = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55'];
      const annotationPoints = elements.map((el, i) => ({
        x: el.cx,
        y: el.cy,
        label: `${el.index}`,
        color: colors[i % colors.length],
      }));

      let annotatedImg = imgBuffer;
      if (annotationPoints.length > 0) {
        annotatedImg = await annotatePoints(imgBuffer, annotationPoints, sf);
      }

      const optimized = await optimizeForAI(annotatedImg, { maxWidth, format: 'jpeg', quality: 80 });

      // 4. Build element list text
      const textParts: string[] = [];
      textParts.push(`=== Screen Elements (${elements.length} detected${webElementsNote}) ===`);
      textParts.push(`App: ${treeResult.app || 'frontmost'}\n`);

      for (const el of elements) {
        const label = el.title ? `"${el.title.substring(0, 40)}"` : '(no label)';
        textParts.push(`[${el.index}] ${el.role} ${label} center=(${el.cx},${el.cy}) ${el.width}x${el.height}`);
      }

      textParts.push(`\n💡 To click element #N, use mouse_click with its center=(x,y) coordinates.`);
      textParts.push(`💡 Elements are numbered on the screenshot with colored markers.`);

      return {
        content: [
          { type: 'image' as const, data: optimized.buffer.toString('base64'), mimeType: optimized.mimeType },
          { type: 'text' as const, text: textParts.join('\n') },
        ],
      };
    },
  },

  clipboard_read: {
    description: 'Read the current text content from the macOS clipboard/pasteboard.',
    inputSchema: z.object({}),
    handler: async () => {
      const result = await execSwift('clipboard', 'read');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  clipboard_write: {
    description: 'Write text content to the macOS clipboard/pasteboard.',
    inputSchema: z.object({
      text: z.string().describe('Text to copy to clipboard'),
    }),
    handler: async (args: { text: string }) => {
      const result = await execSwift('clipboard', 'write', args.text);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  ai_web_elements: {
    description: `[AI-Optimized] Scan ALL interactive elements on a web page via Chrome DevTools Protocol. Auto-launches a CDP-enabled Chrome if needed. Provide a URL to navigate to, or omit to scan the current page. Detects every button, link, input, select, textarea, and clickable element with screen coordinates for mouse_click.`,
    inputSchema: z.object({
      url: z.string().optional().describe('URL to navigate to and scan. Omit to scan current page.'),
      cdpPort: z.number().optional().describe('Chrome DevTools Protocol port (default: 9222)'),
      includeText: z.boolean().optional().describe('Include visible static text elements like headings and paragraphs (default: false)'),
      visibleOnly: z.boolean().optional().describe('Only return elements visible in viewport (default: true)'),
      tabIndex: z.number().optional().describe('Tab index to scan (default: 0 = first page tab)'),
    }),
    handler: async (args: { url?: string; cdpPort?: number; includeText?: boolean; visibleOnly?: boolean; tabIndex?: number }) => {
      const cdpPort = args.cdpPort ?? 9222;
      const includeText = args.includeText ?? false;
      const visibleOnly = args.visibleOnly ?? true;
      const tabIndex = args.tabIndex ?? 0;

      // JavaScript to inject into the web page
      const jsCode = `
(function() {
  const includeText = ${includeText};
  const visibleOnly = ${visibleOnly};

  const interactiveSelectors = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
    '[role="combobox"]', '[role="listbox"]', '[role="option"]',
    '[role="slider"]', '[role="textbox"]',
    '[onclick]', '[tabindex]', 'summary', 'details', 'label[for]',
    '[contenteditable="true"]',
  ];

  const textSelectors = includeText ? ['h1','h2','h3','h4','h5','h6','p','span','li','td','th','label','legend'] : [];

  const allSelectors = [...interactiveSelectors, ...textSelectors].join(',');
  const allElements = document.querySelectorAll(allSelectors);

  const results = [];
  const seen = new Set();

  for (const el of allElements) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) continue;
    if (visibleOnly) {
      if (rect.bottom < 0 || rect.top > window.innerHeight ||
          rect.right < 0 || rect.left > window.innerWidth) continue;
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

    const key = Math.round(rect.left) + ',' + Math.round(rect.top) + ',' + Math.round(rect.width);
    if (seen.has(key)) continue;
    seen.add(key);

    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    const role = el.getAttribute('role') || '';
    const text = (el.textContent || '').trim().substring(0, 60);
    const ariaLabel = el.getAttribute('aria-label') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const href = el.getAttribute('href') || '';
    const name = el.getAttribute('name') || '';
    const id = el.getAttribute('id') || '';

    let kind = tag;
    if (tag === 'input') kind = 'input[' + (type || 'text') + ']';
    if (role) kind = role;
    if (tag === 'a') kind = 'link';

    const label = ariaLabel || placeholder || text || name || id || href?.substring(0, 40) || '(no label)';

    results.push({
      kind, label: label.substring(0, 60),
      cx: Math.round(rect.left + rect.width / 2),
      cy: Math.round(rect.top + rect.height / 2),
      w: Math.round(rect.width), h: Math.round(rect.height),
      tag, ...(href ? { href: href.substring(0, 80) } : {}), ...(type ? { type } : {}),
    });
  }

  return JSON.stringify({
    success: true, url: location.href, title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollY: Math.round(window.scrollY), count: results.length, elements: results
  });
})()`;

      try {
        // 0. Check if CDP is available, auto-launch if not
        const http = await import('node:http');
        const { spawn } = await import('node:child_process');

        const checkCDP = () => new Promise<boolean>((resolve) => {
          http.get(`http://127.0.0.1:${cdpPort}/json/version`, (res) => {
            let d = '';
            res.on('data', (c: Buffer) => d += c);
            res.on('end', () => resolve(d.includes('Chrome')));
          }).on('error', () => resolve(false));
        });

        let cdpReady = await checkCDP();

        if (!cdpReady) {
          // Auto-launch Chrome with CDP using a dedicated profile
          const cdpProfileDir = `/tmp/chrome-cdp-profile`;
          const chromeArgs = [
            `--remote-debugging-port=${cdpPort}`,
            '--remote-allow-origins=*',
            `--user-data-dir=${cdpProfileDir}`,
            '--no-first-run',
            '--no-default-browser-check',
          ];
          if (args.url) chromeArgs.push(args.url);

          const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', chromeArgs, {
            detached: true,
            stdio: 'ignore',
          });
          chrome.unref();

          // Wait for CDP to become available (up to 15s)
          for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 1000));
            cdpReady = await checkCDP();
            if (cdpReady) break;
          }

          if (!cdpReady) {
            return {
              content: [{ type: 'text' as const, text: `Failed to auto-launch Chrome with CDP on port ${cdpPort}. Please launch Chrome manually with:\n/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${cdpPort} --user-data-dir=/tmp/chrome-cdp-profile` }],
              isError: true,
            };
          }
        }

        // 1. Get list of tabs from CDP
        const tabsJson = await new Promise<string>((resolve, reject) => {
          http.get(`http://127.0.0.1:${cdpPort}/json`, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => data += chunk);
            res.on('end', () => resolve(data));
          }).on('error', reject);
        });

        const tabs = JSON.parse(tabsJson).filter((t: any) => t.type === 'page');
        if (tabs.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No page tabs found in Chrome. Make sure Chrome has at least one tab open.' }],
            isError: true,
          };
        }

        const targetTab = tabs[Math.min(tabIndex, tabs.length - 1)];
        const wsUrl = targetTab.webSocketDebuggerUrl;

        if (!wsUrl) {
          return {
            content: [{ type: 'text' as const, text: 'Cannot connect to tab WebSocket. Tab may be in use by another debugger.' }],
            isError: true,
          };
        }

        // 1.5. Navigate to URL if provided
        if (args.url) {
          await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            const timeout = setTimeout(() => { ws.close(); reject(new Error('Navigation timeout')); }, 15000);
            ws.on('open', () => {
              ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: args.url } }));
            });
            ws.on('message', (data: WebSocket.Data) => {
              const resp = JSON.parse(data.toString());
              if (resp.id === 1) {
                // Wait a bit for page to load
                setTimeout(() => { clearTimeout(timeout); ws.close(); resolve(); }, 3000);
              }
            });
            ws.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
          });
          // Re-fetch tabs as wsUrl may have changed
          const newTabsJson = await new Promise<string>((resolve, reject) => {
            http.get(`http://127.0.0.1:${cdpPort}/json`, (res) => {
              let data = '';
              res.on('data', (chunk: Buffer) => data += chunk);
              res.on('end', () => resolve(data));
            }).on('error', reject);
          });
          const newTabs = JSON.parse(newTabsJson).filter((t: any) => t.type === 'page');
          const newTarget = newTabs[Math.min(tabIndex, newTabs.length - 1)];
          if (newTarget?.webSocketDebuggerUrl) {
            // Update wsUrl - but CDP won't give new ws URL for same page, so keep using existing
          }
        }

        // 2. Connect via WebSocket and evaluate JS
        const result = await new Promise<string>((resolve, reject) => {
          const ws = new WebSocket(wsUrl);
          const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 10000);

          ws.on('open', () => {
            ws.send(JSON.stringify({
              id: 1,
              method: 'Runtime.evaluate',
              params: { expression: jsCode, returnByValue: true },
            }));
          });

          ws.on('message', (data: WebSocket.Data) => {
            clearTimeout(timeout);
            const resp = JSON.parse(data.toString());
            if (resp.id === 1) {
              ws.close();
              const val = resp.result?.result?.value;
              if (val) resolve(val);
              else reject(new Error('JS evaluation failed: ' + JSON.stringify(resp.result?.exceptionDetails || resp)));
            }
          });

          ws.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
        });

        const parsed = JSON.parse(result);

        if (!parsed.success) {
          return {
            content: [{ type: 'text' as const, text: 'Failed to scan web elements: ' + JSON.stringify(parsed) }],
            isError: true,
          };
        }

        // 3. Get Chrome window bounds for screen coordinate conversion
        let windowOffsetX = 0;
        let windowOffsetY = 0;

        try {
          const boundsResult = await new Promise<string>((resolve, reject) => {
            execFile('/usr/bin/osascript', ['-e', 'tell application "Google Chrome" to get bounds of front window'], { timeout: 5000 }, (error, stdout) => {
              if (error) reject(error);
              else resolve(stdout.trim());
            });
          });
          const bounds = boundsResult.split(',').map(s => parseInt(s.trim()));
          if (bounds.length >= 2) {
            windowOffsetX = bounds[0];
            windowOffsetY = bounds[1] + 90; // ~90px for Chrome toolbar+tabs
          }
        } catch {
          windowOffsetX = 0;
          windowOffsetY = 120;
        }

        // 4. Build response
        const elements = parsed.elements as Array<{
          kind: string; label: string; cx: number; cy: number; w: number; h: number;
          tag: string; href?: string; type?: string;
        }>;

        const textParts: string[] = [];
        textParts.push(`=== Web Page Elements (${elements.length} detected) ===`);
        textParts.push(`Page: ${parsed.title}`);
        textParts.push(`URL: ${parsed.url}`);
        textParts.push(`Viewport: ${parsed.viewport.width}x${parsed.viewport.height} | Scroll: ${parsed.scrollY}px`);
        textParts.push(`Window offset: +${windowOffsetX},+${windowOffsetY} (screen coords = viewport coords + offset)\n`);

        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          const screenX = el.cx + windowOffsetX;
          const screenY = el.cy + windowOffsetY;
          const label = el.label ? `"${el.label}"` : '(no label)';
          const extra = el.href ? ` → ${el.href.substring(0, 50)}` : '';
          textParts.push(`[${i + 1}] ${el.kind} ${label} screen=(${screenX},${screenY}) ${el.w}x${el.h}${extra}`);
        }

        textParts.push(`\n💡 Use mouse_click with screen=(x,y) coordinates to click elements.`);
        textParts.push(`💡 Coordinates are already converted to screen coordinates (window offset applied).`);

        // 5. Try to capture and annotate screenshot (physical resolution, scale annotations)
        let screenshotContent: Array<{ type: string; data?: string; mimeType?: string; text?: string }> = [];
        try {
          const [webImgBuffer, webSf] = await Promise.all([captureScreenBuffer(), getScaleFactor()]);
          const colors = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55'];
          const annotationPoints = elements.slice(0, 200).map((el, i) => ({
            x: el.cx + windowOffsetX,
            y: el.cy + windowOffsetY,
            label: `${i + 1}`,
            color: colors[i % colors.length],
          }));

          let annotatedImg = webImgBuffer;
          if (annotationPoints.length > 0) {
            annotatedImg = await annotatePoints(webImgBuffer, annotationPoints, webSf);
          }
          const optimized = await optimizeForAI(annotatedImg, { maxWidth: 1440, format: 'jpeg', quality: 80 });
          screenshotContent = [{
            type: 'image' as const,
            data: optimized.buffer.toString('base64'),
            mimeType: optimized.mimeType,
          }];
        } catch {
          // Screenshot failed, just return text
        }

        return {
          content: [
            ...screenshotContent,
            { type: 'text' as const, text: textParts.join('\n') },
          ],
        };
      } catch (error: any) {
        const isConnectionError = error.message?.includes('ECONNREFUSED') || error.message?.includes('connect');
        const hint = isConnectionError
          ? `\n\n⚠️ Cannot connect to Chrome CDP on port ${cdpPort}.\nChrome must be launched with: --remote-debugging-port=${cdpPort}\n\nTo restart Chrome with CDP:\n  1. Quit Chrome completely\n  2. Run: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${cdpPort}`
          : '';

        return {
          content: [{
            type: 'text' as const,
            text: `Failed to scan web elements: ${error.message}${hint}`,
          }],
          isError: true,
        };
      }
    },
  },
};

// Helper: Search accessibility tree for elements matching description
function searchTree(
  node: any,
  terms: string[],
  results: any[]
): any[] {
  const searchableText = [
    node.role || '',
    node.title || '',
    node.value || '',
    node.description || '',
    node.roleDescription || '',
    node.identifier || '',
  ].join(' ').toLowerCase();

  // Check if all terms match
  const matches = terms.every(term => searchableText.includes(term));
  if (matches && node.position) {
    results.push(node);
  }

  if (node.children) {
    for (const child of node.children) {
      searchTree(child, terms, results);
    }
  }

  return results;
}

// Helper: Format tree compactly for AI context
function formatCompactTree(node: any, depth: number): string {
  if (depth > 4) return ''; // Limit for context window

  const indent = '  '.repeat(depth);
  const parts: string[] = [];

  let line = `${indent}[${node.role}]`;
  if (node.title) line += ` "${node.title}"`;
  if (node.value && node.value.length <= 50) line += ` val="${node.value}"`;

  if (node.position && node.size) {
    const cx = Math.round(node.position.x + node.size.width / 2);
    // +4 compensates for AI vision model's systematic upward bias
    const cy = Math.round(node.position.y + node.size.height / 2) + 4;
    line += ` center=(${cx},${cy})`;
  }

  parts.push(line);

  if (node.children) {
    for (const child of node.children) {
      const childStr = formatCompactTree(child, depth + 1);
      if (childStr) parts.push(childStr);
    }
  }

  return parts.join('\n');
}
