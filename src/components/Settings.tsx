import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings, Provider } from "../hooks/useSettings";
import { useRealtimeTranscription } from "../hooks/useRealtimeTranscription";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Label } from "./ui/label";

const STATUS_RESET_DELAY_MS = 2000;

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "pl", name: "Polish" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "ja", name: "Japanese" },
  { code: "zh", name: "Chinese" },
  { code: "ko", name: "Korean" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
] as const;

type SaveStatus = "idle" | "saved" | "error";

interface ApiKeyInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  status: SaveStatus;
  placeholder: string;
}

function ApiKeyInput({
  label,
  value,
  onChange,
  onSave,
  status,
  placeholder,
}: ApiKeyInputProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-3">
        <Input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <Button
          onClick={onSave}
          variant={status === "error" ? "destructive" : "default"}
        >
          {status === "saved" ? "Saved" : status === "error" ? "Error" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function Settings() {
  const {
    settings,
    isLoading,
    updateApiKey,
    updateGroqApiKey,
    updateProvider,
    updateLanguage,
    updateShortcut,
  } = useSettings();
  const [localApiKey, setLocalApiKey] = useState("");
  const [localGroqApiKey, setLocalGroqApiKey] = useState("");
  const [localShortcut, setLocalShortcut] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [groqStatus, setGroqStatus] = useState<SaveStatus>("idle");

  const currentApiKey =
    settings.provider === "openai" ? settings.apiKey : settings.groqApiKey;
  const { isRecording, toggleRecording } = useRealtimeTranscription(
    currentApiKey,
    settings.provider
  );

  useEffect(() => {
    if (!isLoading) {
      setLocalApiKey(settings.apiKey);
      setLocalGroqApiKey(settings.groqApiKey);
      setLocalShortcut(settings.shortcut);
    }
  }, [isLoading, settings]);

  useEffect(() => {
    if (settings.shortcut) {
      invoke("register_shortcut", { shortcutStr: settings.shortcut }).catch(
        console.error
      );
    }
  }, [settings.shortcut]);

  const handleSaveApiKey = useCallback(async () => {
    try {
      await updateApiKey(localApiKey);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), STATUS_RESET_DELAY_MS);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), STATUS_RESET_DELAY_MS);
    }
  }, [localApiKey, updateApiKey]);

  const handleSaveGroqApiKey = useCallback(async () => {
    try {
      await updateGroqApiKey(localGroqApiKey);
      setGroqStatus("saved");
      setTimeout(() => setGroqStatus("idle"), STATUS_RESET_DELAY_MS);
    } catch {
      setGroqStatus("error");
      setTimeout(() => setGroqStatus("idle"), STATUS_RESET_DELAY_MS);
    }
  }, [localGroqApiKey, updateGroqApiKey]);

  const handleCaptureShortcut = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();

      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");

      const key = e.key;
      if (key.length === 1 && key !== " ") {
        parts.push(key.toUpperCase());
      } else if (key === " ") {
        parts.push("Space");
      } else if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
        parts.push(key);
      }

      if (parts.length > 1) {
        const shortcut = parts.join("+");
        setLocalShortcut(shortcut);
        updateShortcut(shortcut);
        setIsCapturing(false);
      }
    },
    [updateShortcut]
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-8 flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-8 flex flex-col overflow-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold bg-gradient-to-r from-pink-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">
          Whisper Clone
        </h1>
        <p className="text-muted-foreground text-sm font-light mt-1">
          Voice to text, instantly
        </p>
      </header>

      <div className="space-y-6 flex-1">
        {/* Provider */}
        <div className="space-y-2">
          <Label>Transcription Provider</Label>
          <Select
            value={settings.provider}
            onChange={(e) => updateProvider(e.target.value as Provider)}
          >
            <option value="openai">OpenAI (live streaming)</option>
            <option value="groq">Groq Whisper Turbo (faster)</option>
          </Select>
        </div>

        {/* Language */}
        <div className="space-y-2">
          <Label>Language</Label>
          <Select
            value={settings.language}
            onChange={(e) => updateLanguage(e.target.value)}
          >
            {SUPPORTED_LANGUAGES.map(({ code, name }) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </div>

        {/* OpenAI API Key */}
        <ApiKeyInput
          label="OpenAI API Key"
          value={localApiKey}
          onChange={setLocalApiKey}
          onSave={handleSaveApiKey}
          status={status}
          placeholder="sk-..."
        />

        {/* Groq API Key */}
        <ApiKeyInput
          label="Groq API Key"
          value={localGroqApiKey}
          onChange={setLocalGroqApiKey}
          onSave={handleSaveGroqApiKey}
          status={groqStatus}
          placeholder="gsk_..."
        />

        {/* Recording Shortcut */}
        <div className="space-y-2">
          <Label>Recording Shortcut</Label>
          <Input
            type="text"
            value={localShortcut}
            readOnly
            onFocus={() => setIsCapturing(true)}
            onBlur={() => setIsCapturing(false)}
            onKeyDown={isCapturing ? handleCaptureShortcut : undefined}
            placeholder="Click and press keys..."
            capturing={isCapturing}
          />
          {isCapturing && (
            <span className="text-xs text-secondary">
              Press your desired key combination
            </span>
          )}
        </div>

        {/* Status Section */}
        <div className="flex items-center justify-between bg-input border border-border rounded-xl px-5 py-4">
          <div
            className={cn(
              "flex items-center gap-2.5 text-sm text-muted-foreground",
              isRecording && "text-foreground"
            )}
          >
            <div
              className={cn(
                "w-2 h-2 rounded-full bg-muted transition-all",
                isRecording &&
                  "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]"
              )}
            />
            <span>{isRecording ? "Recording..." : "Ready"}</span>
          </div>
          <Button
            onClick={toggleRecording}
            disabled={!currentApiKey}
            variant={isRecording ? "destructive" : "secondary"}
            size="sm"
          >
            {isRecording ? "Stop" : "Test Recording"}
          </Button>
        </div>
      </div>

      <footer className="mt-auto pt-6 text-center">
        <p className="text-muted-foreground text-sm">
          Press{" "}
          <code className="bg-primary/10 text-primary px-2 py-1 rounded font-mono text-xs">
            {settings.shortcut || "your shortcut"}
          </code>{" "}
          anywhere to start dictating
        </p>
      </footer>
    </div>
  );
}
