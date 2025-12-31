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

/**
 * Store keys for Tauri plugin-store
 */
export const STORE_KEYS = {
  SIDEBAR_COLLAPSED: "sidebarCollapsed",
  GROQ_API_KEY: "groqApiKey",
  LANGUAGE: "language",
  SHORTCUT: "shortcut",
  CANCEL_SHORTCUT: "cancelShortcut",
  MICROPHONE_DEVICE_ID: "microphoneDeviceId",
  AUTO_PASTE: "autoPaste",
  TRANSCRIPTION_RULES: "transcriptionRules",
} as const;

/**
 * Delay for status message reset (e.g., "Saved" -> "Save")
 */
export const STATUS_RESET_DELAY_MS = 2000;
