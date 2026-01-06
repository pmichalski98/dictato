import { useState, useEffect, useCallback, useRef } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import { STORE_KEYS } from "@/lib/storeKeys";
import type { TranscriptionResult } from "./useTranscribe";

export interface TranscriptionHistoryItem {
  id: string;
  timestamp: number;
  source: "file" | "youtube";
  sourceName: string; // filename or youtube URL
  result: TranscriptionResult;
}

const MAX_HISTORY_ITEMS = 50;
const store = new LazyStore("settings.json");

export function useTranscriptionHistory() {
  const [history, setHistory] = useState<TranscriptionHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Track if initial load is complete to avoid saving on mount
  const isInitialLoad = useRef(true);

  // Load history on mount
  useEffect(() => {
    async function loadHistory() {
      try {
        const historyJson = await store.get<string>(STORE_KEYS.TRANSCRIPTION_HISTORY);
        if (historyJson) {
          const parsed = JSON.parse(historyJson);
          setHistory(parsed);
        }
      } catch (err) {
        console.error("Failed to load transcription history:", err);
      } finally {
        setIsLoading(false);
        isInitialLoad.current = false;
      }
    }

    loadHistory();
  }, []);

  // Persist history whenever it changes (after initial load)
  useEffect(() => {
    if (isInitialLoad.current) return;

    const saveHistory = async () => {
      try {
        await store.set(STORE_KEYS.TRANSCRIPTION_HISTORY, JSON.stringify(history));
      } catch (err) {
        console.error("Failed to save transcription history:", err);
      }
    };

    saveHistory();
  }, [history]);

  const addToHistory = useCallback((
    source: "file" | "youtube",
    sourceName: string,
    result: TranscriptionResult
  ) => {
    const newItem: TranscriptionHistoryItem = {
      id: `transcription-${Date.now()}`,
      timestamp: Date.now(),
      source,
      sourceName,
      result,
    };

    setHistory(prev => [newItem, ...prev].slice(0, MAX_HISTORY_ITEMS));

    return newItem;
  }, []);

  const removeFromHistory = useCallback((id: string) => {
    setHistory(prev => prev.filter((item) => item.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const getHistoryItem = useCallback((id: string) => {
    return history.find((item) => item.id === id);
  }, [history]);

  return {
    history,
    isLoading,
    addToHistory,
    removeFromHistory,
    clearHistory,
    getHistoryItem,
  };
}
