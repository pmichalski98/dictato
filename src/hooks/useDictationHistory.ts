import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { STORE_KEYS } from "@/lib/storeKeys";

/** One voice dictation recorded by the Rust backend (raw vs processed text) */
export interface DictationHistoryItem {
  id: string;
  timestamp: number;
  rawText: string;
  processedText: string;
  /** What produced processedText: "none" = raw copied as-is */
  kind: "none" | "rules" | "mode";
  /** Display label, e.g. the mode name (null for "none"/"rules") */
  label: string | null;
}

const store = new LazyStore("settings.json");

async function loadFromStore(): Promise<DictationHistoryItem[]> {
  try {
    const json = await store.get<string>(STORE_KEYS.DICTATION_HISTORY);
    return json ? JSON.parse(json) : [];
  } catch (err) {
    console.error("Failed to load dictation history:", err);
    return [];
  }
}

export function useDictationHistory() {
  const [history, setHistory] = useState<DictationHistoryItem[]>([]);

  // Load on mount and whenever the backend records a new dictation
  useEffect(() => {
    loadFromStore().then(setHistory);

    const unlisten = listen("dictation-history-updated", () => {
      loadFromStore().then(setHistory);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const persist = useCallback((items: DictationHistoryItem[]) => {
    setHistory(items);
    store
      .set(STORE_KEYS.DICTATION_HISTORY, JSON.stringify(items))
      .catch((err) => console.error("Failed to save dictation history:", err));
  }, []);

  const removeItem = useCallback(
    (id: string) => {
      persist(history.filter((item) => item.id !== id));
    },
    [history, persist]
  );

  const clearHistory = useCallback(() => {
    persist([]);
  }, [persist]);

  return { history, removeItem, clearHistory };
}
