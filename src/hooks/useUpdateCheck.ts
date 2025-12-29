import { useState, useEffect, useCallback } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface UpdateState {
  available: boolean;
  update: Update | null;
  currentVersion: string;
  newVersion: string;
  isChecking: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  error: string | null;
}

const initialState: UpdateState = {
  available: false,
  update: null,
  currentVersion: "",
  newVersion: "",
  isChecking: false,
  isDownloading: false,
  downloadProgress: 0,
  error: null,
};

export function useUpdateCheck() {
  const [state, setState] = useState<UpdateState>(initialState);

  const checkForUpdates = useCallback(async () => {
    setState((prev) => ({ ...prev, isChecking: true, error: null }));

    try {
      const update = await check();
      if (update) {
        setState((prev) => ({
          ...prev,
          available: true,
          update,
          currentVersion: update.currentVersion,
          newVersion: update.version,
          isChecking: false,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          available: false,
          isChecking: false,
        }));
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
      setState((prev) => ({
        ...prev,
        isChecking: false,
        error: err instanceof Error ? err.message : "Failed to check for updates",
      }));
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!state.update) return;

    setState((prev) => ({ ...prev, isDownloading: true, downloadProgress: 0 }));

    try {
      await state.update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          const total = event.data.contentLength ?? 0;
          console.log(`Download started, total: ${total} bytes`);
        } else if (event.event === "Progress") {
          const progress = event.data.chunkLength;
          setState((prev) => ({
            ...prev,
            downloadProgress: Math.min(prev.downloadProgress + progress, 100),
          }));
        } else if (event.event === "Finished") {
          console.log("Download finished");
        }
      });

      await relaunch();
    } catch (err) {
      console.error("Failed to download/install update:", err);
      setState((prev) => ({
        ...prev,
        isDownloading: false,
        error: err instanceof Error ? err.message : "Failed to install update",
      }));
    }
  }, [state.update]);

  const dismiss = useCallback(() => {
    setState(initialState);
  }, []);

  useEffect(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  return {
    ...state,
    checkForUpdates,
    downloadAndInstall,
    dismiss,
  };
}
