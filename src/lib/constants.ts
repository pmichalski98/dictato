/**
 * Consistent icon sizes used throughout the app
 */
export const ICON_SIZES = {
  xs: 12,
  sm: 14,
  md: 18,
  lg: 24,
} as const;

/**
 * Sidebar dimensions
 */
export const SIDEBAR = {
  WIDTH_EXPANDED: "w-[200px]",
  WIDTH_COLLAPSED: "w-14",
} as const;

// Re-export STORE_KEYS from the single source of truth
export { STORE_KEYS } from "./storeKeys";

/**
 * Delay for status message reset (e.g., "Saved" -> "Save")
 */
export const STATUS_RESET_DELAY_MS = 2000;
