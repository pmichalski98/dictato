import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { STORE_KEYS } from "@/lib/storeKeys";
import { EVENTS } from "@/lib/constants";

const store = new LazyStore("settings.json");

export interface DependencyStatus {
  yt_dlp_installed: boolean;
  ffmpeg_installed: boolean;
  yt_dlp_version: string | null;
  ffmpeg_version: string | null;
}

export interface TranscriptionResult {
  raw_text: string;
  processed_text: string | null;
  duration_seconds: number;
  word_count: number;
}

export interface TranscribeProgress {
  stage: "preparing" | "downloading" | "extracting" | "splitting" | "transcribing" | "processing" | "complete";
  percent: number;
  message: string;
}

type InputType = "file" | "youtube" | null;

export function useTranscribe() {
  // Dependencies
  const [dependencies, setDependencies] = useState<DependencyStatus | null>(null);
  const [isCheckingDeps, setIsCheckingDeps] = useState(true);

  // Input state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [inputType, setInputType] = useState<InputType>(null);

  // Options (loaded from store)
  const [selectedMode, setSelectedMode] = useState<string>("none");
  const [applyRules, setApplyRulesState] = useState(false);
  const [language, setLanguageState] = useState("auto");

  // Progress
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);

  // Result
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check dependencies on mount
  useEffect(() => {
    checkDependencies();
  }, []);

  // Load options from store on mount
  useEffect(() => {
    async function loadOptions() {
      try {
        const savedLanguage = await store.get<string>(STORE_KEYS.TRANSCRIBE_LANGUAGE);
        const savedApplyRules = await store.get<boolean>(STORE_KEYS.TRANSCRIBE_APPLY_RULES);

        if (savedLanguage) {
          setLanguageState(savedLanguage);
        }
        if (savedApplyRules !== null && savedApplyRules !== undefined) {
          setApplyRulesState(savedApplyRules);
        }
      } catch (err) {
        console.error("Failed to load transcribe options:", err);
      }
    }
    loadOptions();
  }, []);

  // Wrapper to save language when changed
  const setLanguage = useCallback(async (lang: string) => {
    setLanguageState(lang);
    try {
      await store.set(STORE_KEYS.TRANSCRIBE_LANGUAGE, lang);
    } catch (err) {
      console.error("Failed to save language:", err);
    }
  }, []);

  // Wrapper to save applyRules when changed
  const setApplyRules = useCallback(async (value: boolean) => {
    setApplyRulesState(value);
    try {
      await store.set(STORE_KEYS.TRANSCRIBE_APPLY_RULES, value);
    } catch (err) {
      console.error("Failed to save apply rules:", err);
    }
  }, []);

  // Listen for progress events
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      unlisten = await listen<TranscribeProgress>(EVENTS.TRANSCRIBE_PROGRESS, (event) => {
        setProgress(event.payload);
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const checkDependencies = useCallback(async () => {
    setIsCheckingDeps(true);
    try {
      const status = await invoke<DependencyStatus>("check_transcribe_dependencies");
      setDependencies(status);
    } catch (err) {
      console.error("Failed to check dependencies:", err);
    } finally {
      setIsCheckingDeps(false);
    }
  }, []);

  const handleFileSelect = useCallback((file: File, path: string) => {
    setSelectedFile(file);
    setSelectedFilePath(path);
    setInputType("file");
    setYoutubeUrl("");
    setResult(null);
    setError(null);
  }, []);

  const handleYoutubeUrlChange = useCallback((url: string) => {
    setYoutubeUrl(url);
    if (url.trim()) {
      setInputType("youtube");
      setSelectedFile(null);
      setSelectedFilePath(null);
    } else {
      setInputType(selectedFile ? "file" : null);
    }
    setResult(null);
    setError(null);
  }, [selectedFile]);

  const clearSelection = useCallback(() => {
    setSelectedFile(null);
    setSelectedFilePath(null);
    setYoutubeUrl("");
    setInputType(null);
    setResult(null);
    setError(null);
    setProgress(null);
  }, []);

  const transcribe = useCallback(async () => {
    if (!inputType) return;

    setIsTranscribing(true);
    setError(null);
    setResult(null);
    setProgress(null);

    try {
      const modeId = selectedMode !== "none" ? selectedMode : null;
      let transcriptionResult: TranscriptionResult;

      if (inputType === "file" && selectedFilePath) {
        transcriptionResult = await invoke<TranscriptionResult>("transcribe_file", {
          filePath: selectedFilePath,
          language,
          modeId,
          applyRules: modeId ? false : applyRules,
        });
      } else if (inputType === "youtube" && youtubeUrl) {
        transcriptionResult = await invoke<TranscriptionResult>("transcribe_youtube", {
          url: youtubeUrl,
          language,
          modeId,
          applyRules: modeId ? false : applyRules,
        });
      } else {
        throw new Error("No input selected");
      }

      setResult(transcriptionResult);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
    } finally {
      setIsTranscribing(false);
    }
  }, [inputType, selectedFilePath, youtubeUrl, language, selectedMode, applyRules]);

  // YouTube URL validation regex - must match the Rust backend (transcribe.rs)
  const isYoutubeUrl = useCallback((url: string): boolean => {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/;
    return youtubeRegex.test(url);
  }, []);

  const canTranscribe = Boolean(
    (inputType === "file" && selectedFilePath) ||
    (inputType === "youtube" && youtubeUrl && isYoutubeUrl(youtubeUrl))
  );

  return {
    // Dependencies
    dependencies,
    isCheckingDeps,
    checkDependencies,

    // Input
    selectedFile,
    selectedFilePath,
    youtubeUrl,
    inputType,
    handleFileSelect,
    handleYoutubeUrlChange,
    clearSelection,

    // Options
    selectedMode,
    setSelectedMode,
    applyRules,
    setApplyRules,
    language,
    setLanguage,

    // Progress
    isTranscribing,
    progress,

    // Result
    result,
    error,

    // Actions
    transcribe,
    canTranscribe,
    isYoutubeUrl,
  };
}
