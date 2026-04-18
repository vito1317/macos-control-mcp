// Bridge to the Overlay Swift helper — manages a persistent overlay process
// Sends JSON commands via stdin, reads acks via stdout
// Auto-launches overlay process on first use, reuses for subsequent calls
// Author: vito1317 <service@vito1317.com>

import { spawn, ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let overlayProcess: ChildProcess | null = null;
let overlayReady = false;
let pendingCommands: string[] = [];
let readyResolvers: (() => void)[] = [];

function getOverlayBinaryPath(): string {
  // Try relative to dist/utils/
  const fromDist = resolve(__dirname, '../../bin/overlay');
  if (existsSync(fromDist)) return fromDist;

  // Try relative to src/utils/
  const fromSrc = resolve(__dirname, '../../bin/overlay');
  if (existsSync(fromSrc)) return fromSrc;

  // Fallback: absolute path
  return resolve(process.cwd(), 'bin/overlay');
}

function isOverlayAlive(): boolean {
  return overlayProcess !== null && !overlayProcess.killed && overlayProcess.exitCode === null;
}

function spawnOverlay(): ChildProcess {
  // Kill existing if dead
  if (overlayProcess && !isOverlayAlive()) {
    overlayProcess = null;
    overlayReady = false;
  }

  if (overlayProcess && isOverlayAlive()) {
    return overlayProcess;
  }

  const binaryPath = getOverlayBinaryPath();
  if (!existsSync(binaryPath)) {
    throw new Error(`Overlay binary not found at ${binaryPath}. Run: npm run build:swift`);
  }

  overlayReady = false;

  overlayProcess = spawn(binaryPath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  overlayProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      if (line === 'READY') {
        overlayReady = true;
        // Flush pending commands
        for (const cmd of pendingCommands) {
          overlayProcess?.stdin?.write(cmd + '\n');
        }
        pendingCommands = [];
        // Resolve any waiters
        for (const resolve of readyResolvers) resolve();
        readyResolvers = [];
      }
    }
  });

  overlayProcess.stderr?.on('data', () => {
    // Log errors but don't crash
  });

  overlayProcess.on('exit', () => {
    overlayProcess = null;
    overlayReady = false;
  });

  overlayProcess.on('error', () => {
    overlayProcess = null;
    overlayReady = false;
  });

  return overlayProcess;
}

function sendCommand(command: object): void {
  try {
    const proc = spawnOverlay();
    const json = JSON.stringify(command);
    if (overlayReady) {
      proc.stdin?.write(json + '\n');
    } else {
      // Queue until READY
      pendingCommands.push(json);
    }
  } catch {
    // Overlay not available, silently skip animation
  }
}

// Auto-kill overlay when process exits
process.on('exit', () => {
  if (overlayProcess && !overlayProcess.killed) {
    overlayProcess.stdin?.write('quit\n');
    overlayProcess.kill();
  }
});

// --- Public API ---

export function showClickAnimation(x: number, y: number, options?: {
  button?: 'left' | 'right' | 'double';
  color?: string;
  duration?: number;
}): void {
  sendCommand({
    action: 'click',
    click: {
      x, y,
      button: options?.button ?? 'left',
      color: options?.color ?? '#007AFF',
      duration: options?.duration ?? 0.6,
    },
  });
}

export function showTrailAnimation(points: [number, number][], options?: {
  color?: string;
  duration?: number;
  width?: number;
}): void {
  if (points.length < 2) return;
  sendCommand({
    action: 'trail',
    trail: {
      points,
      color: options?.color ?? '#34C759',
      duration: options?.duration ?? 1.5,
      width: options?.width ?? 3,
    },
  });
}

export function showTypeAnimation(x: number, y: number, text: string, options?: {
  color?: string;
  duration?: number;
}): void {
  sendCommand({
    action: 'type',
    type_anim: {
      x, y, text,
      color: options?.color ?? '#AF52DE',
      duration: options?.duration ?? Math.max(1.5, text.length * 0.08),
    },
  });
}

export function showHighlightAnimation(x: number, y: number, width: number, height: number, options?: {
  color?: string;
  label?: string;
  duration?: number;
}): void {
  sendCommand({
    action: 'highlight',
    highlight: {
      x, y, width, height,
      color: options?.color ?? '#FF9500',
      label: options?.label,
      duration: options?.duration ?? 2.0,
    },
  });
}

export function showScrollAnimation(x: number, y: number, direction: 'up' | 'down', options?: {
  color?: string;
  duration?: number;
}): void {
  sendCommand({
    action: 'scroll',
    scroll: {
      x, y, direction,
      color: options?.color ?? '#5AC8FA',
      duration: options?.duration ?? 0.8,
    },
  });
}

export function killOverlay(): void {
  if (overlayProcess && !overlayProcess.killed) {
    overlayProcess.stdin?.write('quit\n');
    overlayProcess.kill();
    overlayProcess = null;
  }
}
