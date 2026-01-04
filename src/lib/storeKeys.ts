/**
 * Centralized store keys - must match backend store_keys in lib.rs
 */
export const STORE_KEYS = {
  FLOATING_X: "floatingX",
  FLOATING_Y: "floatingY",
  SKIP_RULES_ONCE: "skipRulesOnce",
  TRANSCRIPTION_RULES: "transcriptionRules",
  CUSTOM_MODES: "customModes",
  GROQ_API_KEY: "groqApiKey",
  LANGUAGE: "language",
  CANCEL_SHORTCUT: "cancelShortcut",
  SHORTCUT: "shortcut",
  AUTO_PASTE: "autoPaste",
  MICROPHONE_DEVICE_ID: "microphoneDeviceId",
  ACTIVE_MODE: "activeMode",
} as const;

export type StoreKey = (typeof STORE_KEYS)[keyof typeof STORE_KEYS];
