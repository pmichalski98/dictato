import { useState, useEffect, useCallback } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";

export type Provider = "openai" | "groq";

interface Settings {
  apiKey: string;
  groqApiKey: string;
  provider: Provider;
  language: string;
  shortcut: string;
}

const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  groqApiKey: "",
  provider: "openai",
  language: "en",
  shortcut: "CommandOrControl+Shift+Space",
};

const store = new LazyStore("settings.json");

async function getStore() {
  return store;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        const store = await getStore();
        const apiKey = await store.get<string>("apiKey");
        const groqApiKey = await store.get<string>("groqApiKey");
        const provider = await store.get<Provider>("provider");
        const language = await store.get<string>("language");
        const shortcut = await store.get<string>("shortcut");

        setSettings({
          apiKey: apiKey ?? DEFAULT_SETTINGS.apiKey,
          groqApiKey: groqApiKey ?? DEFAULT_SETTINGS.groqApiKey,
          provider: provider ?? DEFAULT_SETTINGS.provider,
          language: language ?? DEFAULT_SETTINGS.language,
          shortcut: shortcut ?? DEFAULT_SETTINGS.shortcut,
        });
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
  }, []);

  const updateApiKey = useCallback(async (apiKey: string) => {
    try {
      const store = await getStore();
      await store.set("apiKey", apiKey);
      setSettings((prev) => ({ ...prev, apiKey }));
    } catch (err) {
      console.error("Failed to save API key:", err);
    }
  }, []);

  const updateShortcut = useCallback(async (shortcut: string) => {
    try {
      const store = await getStore();
      await store.set("shortcut", shortcut);
      setSettings((prev) => ({ ...prev, shortcut }));
    } catch (err) {
      console.error("Failed to save shortcut:", err);
    }
  }, []);

  const updateGroqApiKey = useCallback(async (groqApiKey: string) => {
    try {
      const store = await getStore();
      await store.set("groqApiKey", groqApiKey);
      setSettings((prev) => ({ ...prev, groqApiKey }));
    } catch (err) {
      console.error("Failed to save Groq API key:", err);
    }
  }, []);

  const updateProvider = useCallback(async (provider: Provider) => {
    try {
      const store = await getStore();
      await store.set("provider", provider);
      setSettings((prev) => ({ ...prev, provider }));
    } catch (err) {
      console.error("Failed to save provider:", err);
    }
  }, []);

  const updateLanguage = useCallback(async (language: string) => {
    try {
      const store = await getStore();
      await store.set("language", language);
      setSettings((prev) => ({ ...prev, language }));
    } catch (err) {
      console.error("Failed to save language:", err);
    }
  }, []);

  return {
    settings,
    isLoading,
    updateApiKey,
    updateGroqApiKey,
    updateProvider,
    updateLanguage,
    updateShortcut,
  };
}

