import { useState, useEffect, useCallback } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";

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

export const DEFAULT_MODES: TranscriptionMode[] = [
  {
    id: "none",
    name: "None",
    description: "No transformation applied, use individual rules instead",
    isBuiltIn: true,
  },
  {
    id: "vibe-coding",
    name: "Vibe Coding",
    description: "Super concise, LLM-friendly output for coding assistants",
    isBuiltIn: true,
  },
  {
    id: "professional-email",
    name: "Professional Email",
    description: "Formal email formatting with proper structure and tone",
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
  activeMode: "none",
};

const store = new LazyStore("settings.json");

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        const groqApiKey = await store.get<string>("groqApiKey");
        const language = await store.get<string>("language");
        const shortcut = await store.get<string>("shortcut");
        const cancelShortcut = await store.get<string>("cancelShortcut");
        const microphoneDeviceId = await store.get<string>("microphoneDeviceId");
        const autoPaste = await store.get<string>("autoPaste");
        const transcriptionRulesJson = await store.get<string>("transcriptionRules");
        const activeMode = await store.get<string>("activeMode");

        let transcriptionRules = DEFAULT_RULES;
        if (transcriptionRulesJson) {
          try {
            transcriptionRules = JSON.parse(transcriptionRulesJson);
          } catch {
            console.error("Failed to parse transcription rules");
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
      await store.set("shortcut", shortcut);
      setSettings((prev) => ({ ...prev, shortcut }));
    } catch (err) {
      console.error("Failed to save shortcut:", err);
    }
  }, []);

  const updateCancelShortcut = useCallback(async (cancelShortcut: string) => {
    try {
      await store.set("cancelShortcut", cancelShortcut);
      setSettings((prev) => ({ ...prev, cancelShortcut }));
    } catch (err) {
      console.error("Failed to save cancel shortcut:", err);
    }
  }, []);

  const updateGroqApiKey = useCallback(async (groqApiKey: string) => {
    try {
      await store.set("groqApiKey", groqApiKey);
      setSettings((prev) => ({ ...prev, groqApiKey }));
    } catch (err) {
      console.error("Failed to save Groq API key:", err);
    }
  }, []);

  const updateLanguage = useCallback(async (language: string) => {
    try {
      await store.set("language", language);
      setSettings((prev) => ({ ...prev, language }));
    } catch (err) {
      console.error("Failed to save language:", err);
    }
  }, []);

  const updateMicrophoneDeviceId = useCallback(async (microphoneDeviceId: string) => {
    try {
      await store.set("microphoneDeviceId", microphoneDeviceId);
      setSettings((prev) => ({ ...prev, microphoneDeviceId }));
    } catch (err) {
      console.error("Failed to save microphone device:", err);
    }
  }, []);

  const updateAutoPaste = useCallback(async (autoPaste: boolean) => {
    try {
      await store.set("autoPaste", autoPaste ? "true" : "false");
      setSettings((prev) => ({ ...prev, autoPaste }));
    } catch (err) {
      console.error("Failed to save auto-paste setting:", err);
    }
  }, []);

  const updateActiveMode = useCallback(async (activeMode: string) => {
    try {
      await store.set("activeMode", activeMode);
      setSettings((prev) => ({ ...prev, activeMode }));
    } catch (err) {
      console.error("Failed to save active mode:", err);
    }
  }, []);

  const updateTranscriptionRules = useCallback(async (rules: TranscriptionRule[]) => {
    try {
      await store.set("transcriptionRules", JSON.stringify(rules));
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
  };
}

