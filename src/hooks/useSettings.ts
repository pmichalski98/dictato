import { useState, useEffect, useCallback } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";

interface Settings {
  groqApiKey: string;
  language: string;
  shortcut: string;
  cancelShortcut: string;
  microphoneDeviceId: string;
  autoPaste: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  groqApiKey: "",
  language: "en",
  shortcut: "CommandOrControl+Shift+Space",
  cancelShortcut: "Escape",
  microphoneDeviceId: "",
  autoPaste: true,
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

        setSettings({
          groqApiKey: groqApiKey ?? DEFAULT_SETTINGS.groqApiKey,
          language: language ?? DEFAULT_SETTINGS.language,
          shortcut: shortcut ?? DEFAULT_SETTINGS.shortcut,
          cancelShortcut: cancelShortcut ?? DEFAULT_SETTINGS.cancelShortcut,
          microphoneDeviceId: microphoneDeviceId ?? DEFAULT_SETTINGS.microphoneDeviceId,
          autoPaste: autoPaste === "false" ? false : DEFAULT_SETTINGS.autoPaste,
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

  return {
    settings,
    isLoading,
    updateGroqApiKey,
    updateLanguage,
    updateShortcut,
    updateCancelShortcut,
    updateMicrophoneDeviceId,
    updateAutoPaste,
  };
}

