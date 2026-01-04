import { useState, useEffect, useCallback } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import { STORE_KEYS } from "@/lib/storeKeys";
import type { IconName } from "@/components/IconPicker";

export interface TranscriptionRule {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  isBuiltIn: boolean;
}

export interface TranscriptionMode {
  id: string;
  name: string;
  description: string;
  /** Prompt is only required for custom modes; built-in modes have prompts in Rust backend */
  prompt?: string;
  icon?: IconName;
  isBuiltIn: boolean;
}

interface Settings {
  groqApiKey: string;
  language: string;
  shortcut: string;
  cancelShortcut: string;
  microphoneDeviceId: string;
  autoPaste: boolean;
  transcriptionRules: TranscriptionRule[];
  customModes: TranscriptionMode[];
  activeMode: string;
}

const DEFAULT_RULES: TranscriptionRule[] = [
  {
    id: "fix-grammar",
    title: "Fix Grammar & Spelling",
    description: "Correct grammar, spelling, and punctuation errors",
    enabled: false,
    isBuiltIn: true,
  },
  {
    id: "remove-fillers",
    title: "Remove Filler Words",
    description: "Remove 'um', 'uh', 'like', 'you know', etc.",
    enabled: false,
    isBuiltIn: true,
  },
  {
    id: "smart-punctuation",
    title: "Smart Punctuation",
    description: "Add proper sentence structure and punctuation",
    enabled: false,
    isBuiltIn: true,
  },
  {
    id: "be-concise",
    title: "Be Concise",
    description: "Remove unnecessary words and repetition",
    enabled: false,
    isBuiltIn: true,
  },
  {
    id: "professional-tone",
    title: "Professional Tone",
    description: "Maintain a professional, polished tone",
    enabled: false,
    isBuiltIn: true,
  },
];

// Built-in modes - prompts are stored in Rust backend (lib.rs)
export const DEFAULT_MODES: TranscriptionMode[] = [
  {
    id: "none",
    name: "None",
    description: "No transformation applied, use individual rules instead",
    icon: "Circle",
    isBuiltIn: true,
  },
  {
    id: "vibe-coding",
    name: "Vibe Coding",
    description: "Super concise, LLM-friendly output for coding assistants",
    icon: "Code",
    isBuiltIn: true,
  },
  {
    id: "professional-email",
    name: "Professional Email",
    description: "Formal email formatting with proper structure and tone",
    icon: "Mail",
    isBuiltIn: true,
  },
];

const DEFAULT_SETTINGS: Settings = {
  groqApiKey: "",
  language: "en",
  shortcut: "CommandOrControl+Shift+Space",
  cancelShortcut: "Escape",
  microphoneDeviceId: "",
  autoPaste: true,
  transcriptionRules: DEFAULT_RULES,
  customModes: [],
  activeMode: "none",
};

const store = new LazyStore("settings.json");

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        const groqApiKey = await store.get<string>(STORE_KEYS.GROQ_API_KEY);
        const language = await store.get<string>(STORE_KEYS.LANGUAGE);
        const shortcut = await store.get<string>(STORE_KEYS.SHORTCUT);
        const cancelShortcut = await store.get<string>(STORE_KEYS.CANCEL_SHORTCUT);
        const microphoneDeviceId = await store.get<string>(STORE_KEYS.MICROPHONE_DEVICE_ID);
        const autoPaste = await store.get<string>(STORE_KEYS.AUTO_PASTE);
        const transcriptionRulesJson = await store.get<string>(STORE_KEYS.TRANSCRIPTION_RULES);
        const customModesJson = await store.get<string>(STORE_KEYS.CUSTOM_MODES);
        const activeMode = await store.get<string>(STORE_KEYS.ACTIVE_MODE);

        let transcriptionRules = DEFAULT_RULES;
        if (transcriptionRulesJson) {
          try {
            transcriptionRules = JSON.parse(transcriptionRulesJson);
          } catch {
            console.error("Failed to parse transcription rules");
          }
        }

        let customModes: TranscriptionMode[] = [];
        if (customModesJson) {
          try {
            customModes = JSON.parse(customModesJson);
          } catch {
            console.error("Failed to parse custom modes");
          }
        }

        setSettings({
          groqApiKey: groqApiKey ?? DEFAULT_SETTINGS.groqApiKey,
          language: language ?? DEFAULT_SETTINGS.language,
          shortcut: shortcut ?? DEFAULT_SETTINGS.shortcut,
          cancelShortcut: cancelShortcut ?? DEFAULT_SETTINGS.cancelShortcut,
          microphoneDeviceId: microphoneDeviceId ?? DEFAULT_SETTINGS.microphoneDeviceId,
          autoPaste: autoPaste === "false" ? false : DEFAULT_SETTINGS.autoPaste,
          transcriptionRules,
          customModes,
          activeMode: activeMode ?? DEFAULT_SETTINGS.activeMode,
        });
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
  }, []);

  const updateShortcut = useCallback(async (shortcut: string) => {
    try {
      await store.set(STORE_KEYS.SHORTCUT, shortcut);
      setSettings((prev) => ({ ...prev, shortcut }));
    } catch (err) {
      console.error("Failed to save shortcut:", err);
    }
  }, []);

  const updateCancelShortcut = useCallback(async (cancelShortcut: string) => {
    try {
      await store.set(STORE_KEYS.CANCEL_SHORTCUT, cancelShortcut);
      setSettings((prev) => ({ ...prev, cancelShortcut }));
    } catch (err) {
      console.error("Failed to save cancel shortcut:", err);
    }
  }, []);

  const updateGroqApiKey = useCallback(async (groqApiKey: string) => {
    try {
      await store.set(STORE_KEYS.GROQ_API_KEY, groqApiKey);
      setSettings((prev) => ({ ...prev, groqApiKey }));
    } catch (err) {
      console.error("Failed to save Groq API key:", err);
    }
  }, []);

  const updateLanguage = useCallback(async (language: string) => {
    try {
      await store.set(STORE_KEYS.LANGUAGE, language);
      setSettings((prev) => ({ ...prev, language }));
    } catch (err) {
      console.error("Failed to save language:", err);
    }
  }, []);

  const updateMicrophoneDeviceId = useCallback(async (microphoneDeviceId: string) => {
    try {
      await store.set(STORE_KEYS.MICROPHONE_DEVICE_ID, microphoneDeviceId);
      setSettings((prev) => ({ ...prev, microphoneDeviceId }));
    } catch (err) {
      console.error("Failed to save microphone device:", err);
    }
  }, []);

  const updateAutoPaste = useCallback(async (autoPaste: boolean) => {
    try {
      await store.set(STORE_KEYS.AUTO_PASTE, autoPaste ? "true" : "false");
      setSettings((prev) => ({ ...prev, autoPaste }));
    } catch (err) {
      console.error("Failed to save auto-paste setting:", err);
    }
  }, []);

  const updateActiveMode = useCallback(async (activeMode: string) => {
    try {
      await store.set(STORE_KEYS.ACTIVE_MODE, activeMode);
      setSettings((prev) => ({ ...prev, activeMode }));
    } catch (err) {
      console.error("Failed to save active mode:", err);
    }
  }, []);

  const updateTranscriptionRules = useCallback(async (rules: TranscriptionRule[]) => {
    try {
      await store.set(STORE_KEYS.TRANSCRIPTION_RULES, JSON.stringify(rules));
      setSettings((prev) => ({ ...prev, transcriptionRules: rules }));
    } catch (err) {
      console.error("Failed to save transcription rules:", err);
    }
  }, []);

  const toggleRule = useCallback(async (ruleId: string) => {
    const newRules = settings.transcriptionRules.map((rule) =>
      rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule
    );
    await updateTranscriptionRules(newRules);
  }, [settings.transcriptionRules, updateTranscriptionRules]);

  const addRule = useCallback(async (title: string, description: string) => {
    const newRule: TranscriptionRule = {
      id: `custom-${Date.now()}`,
      title,
      description,
      enabled: false,
      isBuiltIn: false,
    };
    const newRules = [...settings.transcriptionRules, newRule];
    await updateTranscriptionRules(newRules);
  }, [settings.transcriptionRules, updateTranscriptionRules]);

  const updateRule = useCallback(async (ruleId: string, updates: Partial<TranscriptionRule>) => {
    const newRules = settings.transcriptionRules.map((rule) =>
      rule.id === ruleId ? { ...rule, ...updates } : rule
    );
    await updateTranscriptionRules(newRules);
  }, [settings.transcriptionRules, updateTranscriptionRules]);

  const deleteRule = useCallback(async (ruleId: string) => {
    const newRules = settings.transcriptionRules.filter((rule) => rule.id !== ruleId);
    await updateTranscriptionRules(newRules);
  }, [settings.transcriptionRules, updateTranscriptionRules]);

  // Mode CRUD operations
  const updateCustomModes = useCallback(async (modes: TranscriptionMode[]) => {
    try {
      await store.set(STORE_KEYS.CUSTOM_MODES, JSON.stringify(modes));
      setSettings((prev) => ({ ...prev, customModes: modes }));
    } catch (err) {
      console.error("Failed to save custom modes:", err);
    }
  }, []);

  const addMode = useCallback(async (name: string, description: string, prompt: string, icon?: IconName) => {
    const newMode: TranscriptionMode = {
      id: `custom-mode-${Date.now()}`,
      name,
      description,
      prompt,
      icon,
      isBuiltIn: false,
    };
    const newModes = [...settings.customModes, newMode];
    await updateCustomModes(newModes);
  }, [settings.customModes, updateCustomModes]);

  const updateMode = useCallback(async (modeId: string, updates: Partial<TranscriptionMode>) => {
    const newModes = settings.customModes.map((mode) =>
      mode.id === modeId ? { ...mode, ...updates } : mode
    );
    await updateCustomModes(newModes);
  }, [settings.customModes, updateCustomModes]);

  const deleteMode = useCallback(async (modeId: string) => {
    const newModes = settings.customModes.filter((mode) => mode.id !== modeId);
    await updateCustomModes(newModes);
    // If the deleted mode was active, reset to "none"
    if (settings.activeMode === modeId) {
      await updateActiveMode("none");
    }
  }, [settings.customModes, settings.activeMode, updateCustomModes, updateActiveMode]);

  return {
    settings,
    isLoading,
    updateGroqApiKey,
    updateLanguage,
    updateShortcut,
    updateCancelShortcut,
    updateMicrophoneDeviceId,
    updateAutoPaste,
    updateActiveMode,
    updateTranscriptionRules,
    toggleRule,
    addRule,
    updateRule,
    deleteRule,
    addMode,
    updateMode,
    deleteMode,
  };
}

