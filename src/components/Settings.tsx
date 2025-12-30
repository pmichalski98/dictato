import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Provider, useSettings } from "../hooks/useSettings";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";

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

// Format shortcut for display (shorter, more readable)
function formatShortcut(shortcut: string): string {
  return shortcut
    .replace(/CommandOrControl/g, "Ctrl")
    .replace(/ArrowUp/g, "↑")
    .replace(/ArrowDown/g, "↓")
    .replace(/ArrowLeft/g, "←")
    .replace(/ArrowRight/g, "→");
}

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
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-3 ">       
         <div className="relative w-full">
          <Input
            type={isRevealed ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="pr-10 w-full"
          />
          <button 
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setIsRevealed(!isRevealed)}
            tabIndex={-1}
          >
            {isRevealed ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>
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
  const [shortcutError, setShortcutError] = useState<string | null>(null);


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

  const handleStartCapture = useCallback(() => {
    setIsCapturing(true);
    setShortcutError(null);
    invoke("unregister_shortcuts").catch(console.error);
  }, []);

  const handleStopCapture = useCallback(() => {
    setIsCapturing(false);
    // Re-register current shortcut if capture cancelled
    if (settings.shortcut) {
      invoke("register_shortcut", { shortcutStr: settings.shortcut }).catch(
        console.error
      );
    }
  }, [settings.shortcut]);

  const handleCaptureShortcut = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();

      const modifiers: string[] = [];
      if (e.metaKey || e.ctrlKey) modifiers.push("CommandOrControl");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");

      const key = e.key;
      let mainKey: string | null = null;

      if (key.length === 1 && key !== " ") {
        mainKey = key.toUpperCase();
      } else if (key === " ") {
        mainKey = "Space";
      } else if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
        mainKey = key;
      }

      // Need at least one modifier + one non-modifier key
      if (modifiers.length > 0 && mainKey) {
        const shortcut = [...modifiers, mainKey].join("+");

        // Block shortcuts that conflict with paste (used after transcription)
        const blocked = ["CommandOrControl+V", "CommandOrControl+C", "CommandOrControl+X"];
        if (blocked.includes(shortcut)) {
          setShortcutError("Conflicts with clipboard");
          setTimeout(() => setShortcutError(null), STATUS_RESET_DELAY_MS);
          return;
        }

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
        <h1 className="text-3xl font-semibold bg-linear-to-r from-pink-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">
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
            value={formatShortcut(localShortcut)}
            readOnly
            onFocus={handleStartCapture}
            onBlur={handleStopCapture}
            onKeyDown={isCapturing ? handleCaptureShortcut : undefined}
            placeholder="Click and press keys..."
            capturing={isCapturing}
            error={!!shortcutError}
          />
          {/* Hint - only show when capturing and no error */}
          {isCapturing && !shortcutError && (
            <p className="text-xs text-muted-foreground animate-pulse">
              Press your key combination...
            </p>
          )}
          {/* Error message - separate row with clear visual treatment */}
          {shortcutError && (
            <div className="flex items-center gap-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-red-400 font-medium">{shortcutError}</span>
                <span className="text-xs text-muted-foreground">Ctrl+V/C/X reserved for clipboard — try Ctrl+Shift+Space</span>
              </div>
            </div>
          )}
        </div>

       
      </div>

      <footer className="mt-auto pt-6 text-center">
        <p className="text-muted-foreground text-sm">
          Press{" "}
          <code className="bg-primary/10 text-primary px-2 py-1 rounded font-mono text-xs">
            {formatShortcut(settings.shortcut) || "your shortcut"}
          </code>{" "}
          anywhere to start dictating
        </p>
      </footer>
    </div>
  );
}
