import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENTS } from "@/lib/constants";
import type { LocalModelId } from "./useSettings";

/** Mirrors `AcceleratorStatus` in src-tauri/src/models.rs */
export interface AcceleratorStatus {
  name: string;
  description: string;
  sizeBytes: number;
  installed: boolean;
  /** True once the loaded engine is actually using it */
  active: boolean;
}

/** Mirrors `LocalModelStatus` in src-tauri/src/models.rs */
export interface LocalModelStatus {
  id: LocalModelId;
  name: string;
  description: string;
  languages: string;
  /** Expected download size in bytes */
  sizeBytes: number;
  /** Bytes currently on disk (partial downloads included) */
  diskBytes: number;
  downloaded: boolean;
  downloading: boolean;
  loading: boolean;
  loaded: boolean;
  /** Optional speed-up (e.g. the Core ML encoder on macOS) */
  accelerator: AcceleratorStatus | null;
}

/** Mirrors `DownloadProgress` in src-tauri/src/models.rs */
export interface ModelDownloadProgress {
  model: LocalModelId;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  fileIndex: number;
  fileCount: number;
  fileName: string;
}

export function useLocalModels() {
  const [models, setModels] = useState<LocalModelStatus[]>([]);
  const [progress, setProgress] = useState<
    Partial<Record<LocalModelId, ModelDownloadProgress>>
  >({});
  const [errors, setErrors] = useState<Partial<Record<LocalModelId, string>>>(
    {}
  );

  const refresh = useCallback(async () => {
    try {
      const status = await invoke<LocalModelStatus[]>("get_local_models_status");
      setModels(status);
    } catch (err) {
      console.error("Failed to fetch local model status:", err);
    }
  }, []);

  useEffect(() => {
    refresh();

    const unlistenChanged = listen(EVENTS.LOCAL_MODELS_CHANGED, () => {
      refresh();
    });
    const unlistenProgress = listen<ModelDownloadProgress>(
      EVENTS.MODEL_DOWNLOAD_PROGRESS,
      (event) => {
        setProgress((prev) => ({ ...prev, [event.payload.model]: event.payload }));
      }
    );

    return () => {
      unlistenChanged.then((fn) => fn());
      unlistenProgress.then((fn) => fn());
    };
  }, [refresh]);

  const setError = useCallback((id: LocalModelId, message: string | null) => {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }, []);

  const runDownload = useCallback(
    async (id: LocalModelId, command: string) => {
      setError(id, null);
      setProgress((prev) => ({ ...prev, [id]: undefined }));
      try {
        await invoke(command, { modelId: id });
      } catch (err) {
        const message = String(err);
        // A cancel is user-initiated, not an error worth showing
        if (!message.includes("cancelled")) {
          console.error("Failed to download model:", err);
          setError(id, message);
        }
      } finally {
        setProgress((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        refresh();
      }
    },
    [refresh, setError]
  );

  const download = useCallback(
    (id: LocalModelId) => runDownload(id, "download_local_model"),
    [runDownload]
  );

  const downloadAccelerator = useCallback(
    (id: LocalModelId) => runDownload(id, "download_model_accelerator"),
    [runDownload]
  );

  const removeAccelerator = useCallback(
    async (id: LocalModelId) => {
      setError(id, null);
      try {
        await invoke("delete_model_accelerator", { modelId: id });
      } catch (err) {
        console.error("Failed to delete accelerator:", err);
        setError(id, String(err));
      } finally {
        refresh();
      }
    },
    [refresh, setError]
  );

  const cancel = useCallback(async (id: LocalModelId) => {
    try {
      await invoke("cancel_local_model_download", { modelId: id });
    } catch (err) {
      console.error("Failed to cancel download:", err);
    }
  }, []);

  const remove = useCallback(
    async (id: LocalModelId) => {
      setError(id, null);
      try {
        await invoke("delete_local_model", { modelId: id });
      } catch (err) {
        console.error("Failed to delete model:", err);
        setError(id, String(err));
      } finally {
        refresh();
      }
    },
    [refresh, setError]
  );

  return {
    models,
    progress,
    errors,
    refresh,
    download,
    downloadAccelerator,
    removeAccelerator,
    cancel,
    remove,
  };
}

export type LocalModelsApi = ReturnType<typeof useLocalModels>;
