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
