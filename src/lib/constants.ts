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

/**
 * Supported file formats for transcription
 * Note: webm appears in both as it can be audio or video
 */
export const SUPPORTED_AUDIO_FORMATS = ["mp3", "wav", "m4a", "ogg", "flac", "webm"] as const;
export const SUPPORTED_VIDEO_FORMATS = ["mp4", "mov", "avi", "mkv", "webm"] as const;
export const ALL_SUPPORTED_FORMATS = [
  ...SUPPORTED_AUDIO_FORMATS.filter(f => f !== "webm"),
  ...SUPPORTED_VIDEO_FORMATS,
] as const;

/**
 * Tauri event names for type-safe event handling
 */
export const EVENTS = {
  TRANSCRIBE_PROGRESS: "transcribe-progress",
} as const;

/**
 * UI constants for transcription components
 */
export const TRANSCRIPTION_UI = {
  /** Max characters before truncating text preview */
  TEXT_TRUNCATE_THRESHOLD: 500,
  /** Timeout for copy feedback in ms */
  COPY_FEEDBACK_TIMEOUT_MS: 2000,
  /** Max height for full text view in px */
  FULL_TEXT_MAX_HEIGHT: 400,
  /** Max height for history list in px */
  HISTORY_MAX_HEIGHT: 400,
  /** Max length for source name display */
  SOURCE_NAME_MAX_LENGTH: 40,
} as const;
