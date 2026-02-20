/**
 * Format a keyboard shortcut string for display
 */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .replace(/CommandOrControl/g, "Ctrl")
    .replace(/ArrowUp/g, "↑")
    .replace(/ArrowDown/g, "↓")
    .replace(/ArrowLeft/g, "←")
    .replace(/ArrowRight/g, "→");
}

/**
 * Shortcuts that conflict with system clipboard operations
 */
export const BLOCKED_SHORTCUTS = [
  "CommandOrControl+V",
  "CommandOrControl+C",
  "CommandOrControl+X",
] as const;

/**
 * Browser keyboard event modifier key names
 */
export const MODIFIER_KEYS = ["Control", "Alt", "Shift", "Meta"] as const;
