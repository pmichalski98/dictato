import { useState, useEffect, useCallback, useRef } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Dictato lives in the tray for days, so poll instead of checking once. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** Don't hit the release endpoint on every focus flicker. */
const MIN_CHECK_GAP_MS = 15 * 60 * 1000;

interface UpdateState {
  available: boolean;
  showDialog: boolean;
  update: Update | null;
  currentVersion: string;
  newVersion: string;
  isChecking: boolean;
  isDownloading: boolean;
  /** Bundle is on disk; installing only needs a restart */
  isDownloaded: boolean;
  isInstalling: boolean;
  /** 0-100, or null while the total size is unknown */
  downloadProgress: number | null;
  error: string | null;
}

const initialState: UpdateState = {
  available: false,
  showDialog: false,
  update: null,
  currentVersion: "",
  newVersion: "",
  isChecking: false,
  isDownloading: false,
  isDownloaded: false,
  isInstalling: false,
  downloadProgress: null,
  error: null,
};

export function useUpdateCheck() {
  const [state, setState] = useState<UpdateState>(initialState);
  const lastCheckRef = useRef(0);
  const downloadStartedRef = useRef(false);
  /** Handle whose Rust-side resource holds the downloaded bundle */
  const updateRef = useRef<Update | null>(null);

  /**
   * Fetch the bundle right away so "Update" later is just a restart. The
   * updater verifies the signature on install, so an early download is safe.
   */
  const downloadInBackground = useCallback(async (update: Update) => {
    if (downloadStartedRef.current) return;
    downloadStartedRef.current = true;
    setState((prev) => ({ ...prev, isDownloading: true, downloadProgress: null, error: null }));

    let total = 0;
    let received = 0;
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          setState((prev) => ({
            ...prev,
            downloadProgress: total > 0 ? Math.min(Math.round((received / total) * 100), 100) : null,
          }));
        }
      });
      setState((prev) => ({
        ...prev,
        isDownloading: false,
        isDownloaded: true,
        downloadProgress: 100,
      }));
    } catch (err) {
      console.error("Failed to download update:", err);
      downloadStartedRef.current = false;
      setState((prev) => ({
        ...prev,
        isDownloading: false,
        error: err instanceof Error ? err.message : "Failed to download update",
      }));
    }
  }, []);

  const checkForUpdates = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastCheckRef.current < MIN_CHECK_GAP_MS) return;
    lastCheckRef.current = now;

    setState((prev) => ({ ...prev, isChecking: true, error: null }));

    try {
      const update = await check();
      if (!update) {
        setState((prev) => ({ ...prev, available: false, isChecking: false }));
        return;
      }

      const known = updateRef.current;
      if (known && known.version === update.version && downloadStartedRef.current) {
        // Same version, already downloading or downloaded: the bundle bytes
        // live on the known handle, so drop the fresh one.
        update.close().catch(() => {});
        setState((prev) => ({ ...prev, isChecking: false }));
        return;
      }

      // New version, or a previous download failed: switch to the fresh handle.
      known?.close().catch(() => {});
      updateRef.current = update;
      downloadStartedRef.current = false;
      setState((prev) => ({
        ...prev,
        available: true,
        update,
        currentVersion: update.currentVersion,
        newVersion: update.version,
        isChecking: false,
        isDownloaded: false,
      }));
      invoke("set_update_available", { version: update.version }).catch((err) =>
        console.error("Failed to notify tray about update:", err)
      );
      downloadInBackground(update);
    } catch (err) {
      console.error("Failed to check for updates:", err);
      setState((prev) => ({
        ...prev,
        isChecking: false,
        error: err instanceof Error ? err.message : "Failed to check for updates",
      }));
    }
  }, [downloadInBackground]);

  const installAndRestart = useCallback(async () => {
    const { update, isDownloaded } = state;
    if (!update) return;

    setState((prev) => ({ ...prev, isInstalling: true, error: null }));
    try {
      if (isDownloaded) {
        await update.install();
      } else {
        await update.downloadAndInstall();
      }
      await relaunch();
    } catch (err) {
      console.error("Failed to install update:", err);
      setState((prev) => ({
        ...prev,
        isInstalling: false,
        error: err instanceof Error ? err.message : "Failed to install update",
      }));
    }
  }, [state]);

  const openDialog = useCallback(() => {
    setState((prev) => ({ ...prev, showDialog: true }));
  }, []);

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, showDialog: false }));
  }, []);

  // Startup check, then poll; also re-check when the (long hidden) settings
  // window comes back into focus, and open the dialog from the tray item.
  useEffect(() => {
    checkForUpdates(true);
    const interval = setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);

    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) checkForUpdates();
    });
    const unlistenTray = listen("open-update-dialog", () => {
      setState((prev) => ({ ...prev, showDialog: true }));
    });

    return () => {
      clearInterval(interval);
      unlistenFocus.then((fn) => fn());
      unlistenTray.then((fn) => fn());
    };
  }, [checkForUpdates]);

  return {
    ...state,
    checkForUpdates,
    installAndRestart,
    openDialog,
    dismiss,
  };
}
