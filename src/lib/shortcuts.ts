import React from "react";

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

const MODIFIER_KEYS = ["Control", "Alt", "Shift", "Meta"] as const;

export interface ParsedShortcut {
  modifiers: string[];
  mainKey: string | null;
  shortcutString: string | null;
}

/**
 * Parse a keyboard event into modifier keys and main key
 */
export function parseKeyboardEvent(e: React.KeyboardEvent): ParsedShortcut {
  const modifiers: string[] = [];
  if (e.metaKey || e.ctrlKey) modifiers.push("CommandOrControl");
  if (e.altKey) modifiers.push("Alt");
  if (e.shiftKey) modifiers.push("Shift");

  const key = e.key;
  let mainKey: string | null = null;

  if (key.length === 1 && key !== " ") {
    mainKey = key.toUpperCase();
  } else if (key === " ") {
    mainKey = "Space";
  } else if (!MODIFIER_KEYS.includes(key as (typeof MODIFIER_KEYS)[number])) {
    mainKey = key;
  }

  const shortcutString =
    modifiers.length > 0 && mainKey ? [...modifiers, mainKey].join("+") : null;

  return { modifiers, mainKey, shortcutString };
}
