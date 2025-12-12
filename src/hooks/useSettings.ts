import { useState, useEffect, useCallback } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";

interface Settings {
  apiKey: string;
  shortcut: string;
}

const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
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
        const shortcut = await store.get<string>("shortcut");

        setSettings({
          apiKey: apiKey ?? DEFAULT_SETTINGS.apiKey,
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

  return {
    settings,
    isLoading,
    updateApiKey,
    updateShortcut,
  };
}

