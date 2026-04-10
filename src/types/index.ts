// Type definitions for macos-control-mcp
// Author: vito1317 <service@vito1317.com>

export interface SwiftHelperResult {
  success: boolean;
  error?: string;
  action?: string;
  [key: string]: unknown;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenInfo {
  index: number;
  isMain: boolean;
  frame: Rect;
  visibleFrame: Rect;
  scaleFactor: number;
}

export interface WindowInfo {
  windowID: number;
  ownerName: string;
  windowName: string;
  pid: number;
  bounds: Record<string, number>;
  alpha: number;
}

export interface AppInfo {
  name: string;
  pid: number;
  bundleID: string;
  isActive: boolean;
  isHidden: boolean;
}

export interface AccessibilityNode {
  role: string;
  title?: string;
  value?: string;
  description?: string;
  roleDescription?: string;
  identifier?: string;
  position?: Point;
  size?: Size;
  enabled?: boolean;
  focused?: boolean;
  children?: AccessibilityNode[];
  childCount?: number;
}

export interface ScreenshotOptions {
  region?: Rect;
  windowId?: number;
  displayId?: number;
  quality?: number;         // 1-100 for JPEG
  maxWidth?: number;        // Max width for AI optimization
  showGrid?: boolean;       // Overlay coordinate grid
  gridSpacing?: number;     // Grid spacing in pixels
  format?: 'png' | 'jpeg';
}

export interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  duration: number;
}

export interface CoordinateGridOptions {
  spacing: number;
  color: string;
  opacity: number;
  showLabels: boolean;
  fontSize: number;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}>;
