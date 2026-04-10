// Swift helper bridge — executes the compiled Swift binary and parses JSON output
// Author: vito1317 <service@vito1317.com>

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SwiftHelperResult } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the Swift helper binary path
function getHelperPath(): string {
  // Check multiple possible locations
  const candidates = [
    resolve(__dirname, '../../bin/mac-control'),
    resolve(__dirname, '../../../bin/mac-control'),
    resolve(process.cwd(), 'bin/mac-control'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Swift helper binary not found. Please run: npm run build:swift\n' +
    `Searched: ${candidates.join(', ')}`
  );
}

let cachedHelperPath: string | null = null;

function helperPath(): string {
  if (!cachedHelperPath) {
    cachedHelperPath = getHelperPath();
  }
  return cachedHelperPath;
}

/**
 * Execute a Swift helper command and return parsed JSON result
 */
export async function execSwift(command: string, subcommand: string, ...args: string[]): Promise<SwiftHelperResult> {
  const binary = helperPath();
  const allArgs = [command, subcommand, ...args];

  return new Promise((resolve, reject) => {
    execFile(binary, allArgs, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024, // 10MB for accessibility trees
      env: { ...process.env },
    }, (error, stdout, stderr) => {
      if (stderr && !stdout) {
        reject(new Error(`Swift helper error: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout.trim()) as SwiftHelperResult;
        resolve(result);
      } catch {
        if (error) {
          reject(new Error(`Swift helper failed: ${error.message}\nstdout: ${stdout}\nstderr: ${stderr}`));
        } else {
          reject(new Error(`Failed to parse Swift helper output: ${stdout}`));
        }
      }
    });
  });
}

/**
 * Check if the Swift helper is available
 */
export function isHelperAvailable(): boolean {
  try {
    helperPath();
    return true;
  } catch {
    return false;
  }
}
