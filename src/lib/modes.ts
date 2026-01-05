/**
 * Mode utility functions and constants
 *
 * Note: Built-in mode prompts are stored server-side in Rust (src-tauri/src/lib.rs)
 * The frontend only stores metadata for display purposes.
 */
import type { TranscriptionMode } from "@/hooks/useSettings";
import type { IconName } from "@/components/IconPicker";

/** Constant for the "none" mode ID - used throughout the app */
export const NONE_MODE_ID = "none" as const;

/**
 * Built-in mode definitions (metadata only - prompts are in Rust backend)
 * These are the modes that ship with the app.
 */
export const DEFAULT_MODES: TranscriptionMode[] = [
  {
    id: NONE_MODE_ID,
    name: "None",
    description: "No transformation applied, use individual rules instead",
    icon: "Circle" as IconName,
    isBuiltIn: true,
  },
  {
    id: "vibe-coding",
    name: "Vibe Coding",
    description: "Super concise, LLM-friendly output for coding assistants",
    icon: "Code" as IconName,
    isBuiltIn: true,
    // Prompt is stored in Rust backend - not needed here for display
  },
  {
    id: "professional-email",
    name: "Professional Email",
    description: "Formal email formatting with proper structure and tone",
    icon: "Mail" as IconName,
    isBuiltIn: true,
    // Prompt is stored in Rust backend - not needed here for display
  },
];

/**
 * Get visible modes (excludes "none" mode and deleted built-in modes)
 * This is the list shown in mode selectors.
 */
export function getVisibleModes(
  customModes: TranscriptionMode[],
  deletedBuiltInModes: string[]
): TranscriptionMode[] {
  const visibleBuiltIn = DEFAULT_MODES.filter(
    (m) => m.id !== NONE_MODE_ID && !deletedBuiltInModes.includes(m.id)
  );
  return [...visibleBuiltIn, ...customModes];
}

/**
 * Find a mode by ID from all available modes
 */
export function findModeById(
  modeId: string,
  customModes: TranscriptionMode[],
  deletedBuiltInModes: string[]
): TranscriptionMode | undefined {
  const allModes = getVisibleModes(customModes, deletedBuiltInModes);
  return allModes.find((m) => m.id === modeId);
}

/**
 * Check if no mode is currently active (either "none" selected or mode not found)
 */
export function isNoModeActive(
  activeMode: string,
  customModes: TranscriptionMode[],
  deletedBuiltInModes: string[]
): boolean {
  if (activeMode === NONE_MODE_ID) return true;
  const mode = findModeById(activeMode, customModes, deletedBuiltInModes);
  return !mode;
}
