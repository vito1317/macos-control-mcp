// Keyboard input tools — type text, press keys, hotkey combinations
// Author: vito1317 <service@vito1317.com>

import { z } from 'zod';
import { execSwift } from '../utils/swift-bridge.js';
import { showTypeAnimation, showClickAnimation } from '../utils/overlay-bridge.js';

export const keyboardTools = {
  keyboard_type: {
    description: 'Type a string of text character by character, simulating real keyboard input. Supports Unicode (Chinese, Japanese, emoji, etc.).',
    inputSchema: z.object({
      text: z.string().describe('Text to type'),
    }),
    handler: async (args: { text: string }) => {
      // Show typing animation at the focused input field's caret position
      try {
        const focusPos = await execSwift('accessibility', 'focused-position');
        if (focusPos?.success) {
          const fp = focusPos as any;
          const px = fp.x ?? 400;
          const py = fp.y ?? 400;
          // Position the text bubble right at the caret
          showTypeAnimation(px, py, args.text.substring(0, 30), { color: '#AF52DE' });
        } else {
          // Fallback to mouse position
          const pos = await execSwift('mouse', 'position');
          if (pos?.success) {
            showTypeAnimation((pos as any).x, (pos as any).y, args.text.substring(0, 30), { color: '#AF52DE' });
          }
        }
      } catch { /* skip animation if position fails */ }
      const result = await execSwift('keyboard', 'type', args.text);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  keyboard_press: {
    description: `Press a key with optional modifier keys. Available keys: letters (a-z), numbers (0-9), function keys (f1-f12), arrow keys (up/down/left/right), return/enter, tab, space, delete/backspace, escape/esc, home, end, pageup, pagedown, and symbols. Modifiers: command/cmd, shift, option/alt, control/ctrl, fn.`,
    inputSchema: z.object({
      key: z.string().describe('Key name (e.g., "a", "return", "f5", "up")'),
      modifiers: z.array(z.string()).optional().describe('Modifier keys (e.g., ["cmd", "shift"]) (default: [])'),
    }),
    handler: async (args: { key: string; modifiers?: string[] }) => {
      const modifiers = args.modifiers ?? [];
      const result = await execSwift('keyboard', 'press', args.key, ...modifiers);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },

  keyboard_hotkey: {
    description: 'Press a keyboard shortcut / hotkey combination. Use "+" to separate keys. Examples: "cmd+c" (copy), "cmd+v" (paste), "cmd+shift+s" (save as), "cmd+tab" (switch app), "ctrl+cmd+f" (fullscreen).',
    inputSchema: z.object({
      keys: z.string().describe('Hotkey combination with "+" separator (e.g., "cmd+c", "cmd+shift+z")'),
    }),
    handler: async (args: { keys: string }) => {
      // Show hotkey animation at focused element or fallback to mouse
      try {
        const focusPos = await execSwift('accessibility', 'focused-position');
        if (focusPos?.success) {
          const fp = focusPos as any;
          showTypeAnimation(fp.x, fp.y, `⌨️ ${args.keys}`, { color: '#5856D6', duration: 1.0 });
        } else {
          const pos = await execSwift('mouse', 'position');
          if (pos?.success) {
            showTypeAnimation((pos as any).x, (pos as any).y, `⌨️ ${args.keys}`, { color: '#5856D6', duration: 1.0 });
          }
        }
      } catch { /* skip animation */ }
      const result = await execSwift('keyboard', 'hotkey', args.keys);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },
};
