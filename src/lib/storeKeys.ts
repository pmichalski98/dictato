/**
 * Centralized store keys - must match backend store_keys in lib.rs
 * This is the single source of truth for all store keys in the frontend.
 */
export const STORE_KEYS = {
  // UI State
  SIDEBAR_COLLAPSED: "sidebarCollapsed",

  // Window Position
  FLOATING_X: "floatingX",
  FLOATING_Y: "floatingY",

  // Transcription
  SKIP_RULES_ONCE: "skipRulesOnce",
  TRANSCRIPTION_RULES: "transcriptionRules",
  CUSTOM_MODES: "customModes",
  DELETED_BUILTIN_MODES: "deletedBuiltInModes",
  GROQ_API_KEY: "groqApiKey",
  OPENAI_API_KEY: "openaiApiKey",
  LANGUAGE: "language",
  CANCEL_SHORTCUT: "cancelShortcut",
  SHORTCUT: "shortcut",
  AUTO_PASTE: "autoPaste",
  MICROPHONE_DEVICE_ID: "microphoneDeviceId",
  ACTIVE_MODE: "activeMode",
  STATS_TOTAL_WORDS: "statsTotalWords",
  STATS_TOTAL_TRANSCRIPTIONS: "statsTotalTranscriptions",
  STATS_TOTAL_TIME_SAVED_SECONDS: "statsTotalTimeSavedSeconds",
} as const;

export type StoreKey = (typeof STORE_KEYS)[keyof typeof STORE_KEYS];
