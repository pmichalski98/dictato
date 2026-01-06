import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { STORE_KEYS } from "@/lib/storeKeys";

const store = new LazyStore("settings.json");

export interface Stats {
  totalWords: number;
  totalTranscriptions: number;
  totalTimeSavedSeconds: number;
}

const DEFAULT_STATS: Stats = {
  totalWords: 0,
  totalTranscriptions: 0,
  totalTimeSavedSeconds: 0,
};

export function useStats() {
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [isLoading, setIsLoading] = useState(true);

  // Load stats from store
  useEffect(() => {
    async function loadStats() {
      try {
        const [words, transcriptions, time] = await Promise.all([
          store.get<number>(STORE_KEYS.STATS_TOTAL_WORDS),
          store.get<number>(STORE_KEYS.STATS_TOTAL_TRANSCRIPTIONS),
          store.get<number>(STORE_KEYS.STATS_TOTAL_TIME_SAVED_SECONDS),
        ]);
        setStats({
          totalWords: words ?? 0,
          totalTranscriptions: transcriptions ?? 0,
          totalTimeSavedSeconds: time ?? 0,
        });
      } catch (err) {
        console.error("Failed to load stats:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadStats();
  }, []);

  // Listen for real-time stats updates from backend
  useEffect(() => {
    const unlisten = listen<Stats>("stats-updated", (event) => {
      setStats(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Reset statistics
  const resetStats = useCallback(async () => {
    try {
      await Promise.all([
        store.set(STORE_KEYS.STATS_TOTAL_WORDS, 0),
        store.set(STORE_KEYS.STATS_TOTAL_TRANSCRIPTIONS, 0),
        store.set(STORE_KEYS.STATS_TOTAL_TIME_SAVED_SECONDS, 0),
      ]);
      await store.save();
      setStats(DEFAULT_STATS);
    } catch (err) {
      console.error("Failed to reset stats:", err);
    }
  }, []);

  return { stats, isLoading, resetStats };
}

// Format seconds to human-readable time
export function formatTimeSaved(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
