// Terminal operation tools — execute commands, manage processes
// Author: vito1317 <service@vito1317.com>

import { z } from 'zod';
import { exec, execFile, spawn } from 'node:child_process';
import type { TerminalResult } from '../types/index.js';

async function executeCommand(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    shell?: string;
    env?: Record<string, string>;
  } = {}
): Promise<TerminalResult> {
  const startTime = Date.now();
  const timeout = options.timeout ?? 30000;
  const shell = options.shell ?? '/bin/zsh';

  return new Promise((resolve) => {
    const child = exec(command, {
      cwd: options.cwd ?? process.env.HOME,
      timeout,
      shell,
      env: { ...process.env, ...options.env },
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const duration = Date.now() - startTime;
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: error ? (error as any).code ?? 1 : 0,
        timedOut: duration >= timeout,
        duration,
      });
    });
  });
}

export const terminalTools = {
  terminal_execute: {
    description: 'Execute a shell command in the macOS terminal and return the output. Supports any shell command including pipes, redirects, and chaining. Default shell is zsh. Timeout defaults to 30 seconds.',
    inputSchema: z.object({
      command: z.string().describe('Shell command to execute'),
      cwd: z.string().optional().describe('Working directory (defaults to home directory)'),
      timeout: z.number().min(1000).max(300000).optional().describe('Timeout in milliseconds (default: 30000)'),
      shell: z.string().optional().describe('Shell to use (default: /bin/zsh)'),
      env: z.record(z.string()).optional().describe('Additional environment variables'),
    }),
    handler: async (args: {
      command: string;
      cwd?: string;
      timeout?: number;
      shell?: string;
      env?: Record<string, string>;
    }) => {
      const timeout = args.timeout ?? 30000;
      const shell = args.shell ?? '/bin/zsh';
      const result = await executeCommand(args.command, {
        cwd: args.cwd,
        timeout: timeout,
        shell: shell,
        env: args.env,
      });

      const output = [
        `Exit code: ${result.exitCode}`,
        `Duration: ${result.duration}ms`,
        result.timedOut ? '⚠️ Command timed out' : '',
        result.stdout ? `\n--- stdout ---\n${result.stdout}` : '',
        result.stderr ? `\n--- stderr ---\n${result.stderr}` : '',
      ].filter(Boolean).join('\n');

      return {
        content: [{ type: 'text' as const, text: output }],
        isError: result.exitCode !== 0,
      };
    },
  },

  terminal_execute_background: {
    description: 'Start a long-running process in the background. Returns the PID immediately. Use terminal_execute with "kill <pid>" to stop it.',
    inputSchema: z.object({
      command: z.string().describe('Command to run in background'),
      cwd: z.string().optional().describe('Working directory'),
    }),
    handler: async (args: { command: string; cwd?: string }) => {
      const child = spawn('/bin/zsh', ['-c', args.command], {
        cwd: args.cwd ?? process.env.HOME,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            action: 'background_process',
            pid: child.pid,
            command: args.command,
            message: `Process started with PID ${child.pid}. Use "kill ${child.pid}" to stop.`,
          }, null, 2),
        }],
      };
    },
  },

  terminal_applescript: {
    description: 'Execute AppleScript code. Useful for macOS-specific automation like controlling apps via their AppleScript dictionaries, showing dialogs, etc.',
    inputSchema: z.object({
      script: z.string().describe('AppleScript code to execute'),
      timeout: z.number().min(1000).max(60000).optional().describe('Timeout in milliseconds (default: 15000)'),
    }),
    handler: async (args: { script: string; timeout?: number }) => {
      const timeout = args.timeout ?? 15000;
      return new Promise((resolve) => {
        execFile('/usr/bin/osascript', ['-e', args.script], {
          timeout: timeout,
          maxBuffer: 5 * 1024 * 1024,
        }, (error, stdout, stderr) => {
          if (error) {
            resolve({
              content: [{
                type: 'text' as const,
                text: `AppleScript error: ${stderr || error.message}`,
              }],
              isError: true,
            });
          } else {
            resolve({
              content: [{
                type: 'text' as const,
                text: stdout.trim() || '(no output)',
              }],
            });
          }
        });
      });
    },
  },
};
