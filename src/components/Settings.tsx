import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../hooks/useSettings";
import { formatShortcut } from "@/lib/shortcuts";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { RulesSection } from "./RulesSection";

interface AudioDevice {
  deviceId: string;
  label: string;
}

interface NativeAudioDevice {
  id: string;
  name: string;
  is_default: boolean;
}

const STATUS_RESET_DELAY_MS = 2000;

const SUPPORTED_LANGUAGES = [
  { code: "auto", name: "Auto-detect" },
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
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1.5">
        <div className="relative w-full">
          <Input
            type={isRevealed ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="pr-8 w-full"
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setIsRevealed(!isRevealed)}
            tabIndex={-1}
          >
            {isRevealed ? <Eye size={14} /> : <EyeOff size={14} />}
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
    updateGroqApiKey,
    updateLanguage,
    updateShortcut,
    updateCancelShortcut,
    updateMicrophoneDeviceId,
    updateAutoPaste,
    toggleRule,
    addRule,
    updateRule,
    deleteRule,
  } = useSettings();
  const [localGroqApiKey, setLocalGroqApiKey] = useState("");
  const [localShortcut, setLocalShortcut] = useState("");
  const [localCancelShortcut, setLocalCancelShortcut] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCapturingCancel, setIsCapturingCancel] = useState(false);
  const [groqStatus, setGroqStatus] = useState<SaveStatus>("idle");
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [cancelShortcutError, setCancelShortcutError] = useState<string | null>(null);
  const [microphones, setMicrophones] = useState<AudioDevice[]>([]);
  const [micPermissionStatus, setMicPermissionStatus] = useState<
    "granted" | "denied" | "prompt" | "unknown"
  >("unknown");
  const [isLoadingMics, setIsLoadingMics] = useState(false);

  const loadMicrophones = useCallback(async () => {
    setIsLoadingMics(true);
    try {
      // Use native audio device enumeration (doesn't open a stream, no audio ducking)
      const devices = await invoke<NativeAudioDevice[]>("list_audio_devices");
      const audioInputs = devices.map((device) => ({
        deviceId: device.id,
        label: device.name,
      }));

      setMicrophones(audioInputs);
      setMicPermissionStatus("granted");
    } catch (err) {
      console.error("Failed to enumerate microphones:", err);
      // Native audio will show permission dialog when recording starts
      setMicPermissionStatus("unknown");
    } finally {
      setIsLoadingMics(false);
    }
  }, []);

  useEffect(() => {
    loadMicrophones();
  }, [loadMicrophones]);

  useEffect(() => {
    if (!isLoading) {
      setLocalGroqApiKey(settings.groqApiKey);
      setLocalShortcut(settings.shortcut);
      setLocalCancelShortcut(settings.cancelShortcut);
    }
  }, [isLoading, settings]);

  useEffect(() => {
    if (settings.shortcut) {
      invoke("register_shortcut", { shortcutStr: settings.shortcut }).catch(
        console.error
      );
    }
  }, [settings.shortcut]);

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
        const blocked = [
          "CommandOrControl+V",
          "CommandOrControl+C",
          "CommandOrControl+X",
        ];
        if (blocked.includes(shortcut)) {
          setShortcutError("Conflicts with clipboard");
          setTimeout(() => setShortcutError(null), STATUS_RESET_DELAY_MS);
          return;
        }

        // Check for conflict with cancel shortcut
        if (shortcut === settings.cancelShortcut) {
          setShortcutError("Same as cancel shortcut");
          setTimeout(() => setShortcutError(null), STATUS_RESET_DELAY_MS);
          return;
        }

        setLocalShortcut(shortcut);
        updateShortcut(shortcut);
        setIsCapturing(false);
      }
    },
    [updateShortcut, settings.cancelShortcut]
  );

  const handleStartCancelCapture = useCallback(() => {
    setIsCapturingCancel(true);
    setCancelShortcutError(null);
    invoke("unregister_shortcuts").catch(console.error);
  }, []);

  const handleStopCancelCapture = useCallback(() => {
    setIsCapturingCancel(false);
    // Re-register shortcuts if capture cancelled
    if (settings.shortcut) {
      invoke("register_shortcut", { shortcutStr: settings.shortcut }).catch(
        console.error
      );
    }
  }, [settings.shortcut]);

  const handleCaptureCancelShortcut = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();

      const key = e.key;

      // For cancel shortcut, allow single keys like Escape
      if (key === "Escape") {
        setLocalCancelShortcut("Escape");
        updateCancelShortcut("Escape");
        invoke("register_cancel_shortcut", { shortcutStr: "Escape" }).catch(console.error);
        setIsCapturingCancel(false);
        return;
      }

      const modifiers: string[] = [];
      if (e.metaKey || e.ctrlKey) modifiers.push("CommandOrControl");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");

      let mainKey: string | null = null;

      if (key.length === 1 && key !== " ") {
        mainKey = key.toUpperCase();
      } else if (key === " ") {
        mainKey = "Space";
      } else if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
        mainKey = key;
      }

      // Allow modifier + key combinations
      if (modifiers.length > 0 && mainKey) {
        const shortcut = [...modifiers, mainKey].join("+");

        // Check for conflict with recording shortcut
        if (shortcut === settings.shortcut) {
          setCancelShortcutError("Same as recording shortcut");
          setTimeout(() => setCancelShortcutError(null), STATUS_RESET_DELAY_MS);
          return;
        }

        setLocalCancelShortcut(shortcut);
        updateCancelShortcut(shortcut);
        invoke("register_cancel_shortcut", { shortcutStr: shortcut }).catch(console.error);
        setIsCapturingCancel(false);
      }
    },
    [updateCancelShortcut, settings.shortcut]
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-5 flex items-center justify-center text-muted-foreground text-[13px]">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-5 flex flex-col overflow-auto">
      <header className="mb-5">
        <h1 className="text-xl font-semibold bg-linear-to-r from-pink-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">
          Dictato
        </h1>
        <p className="text-muted-foreground text-[11px] mt-0.5">
          Voice to text, instantly
        </p>
      </header>

      <div className="space-y-2.5 flex-1">
        {/* Audio Settings Section */}
        <Card className="space-y-3">
          {/* Language */}
          <div className="space-y-1.5">
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

          {/* Microphone Device */}
          <div className="space-y-1.5">
            <Label>Microphone</Label>
            {micPermissionStatus === "denied" ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 px-2 py-1.5 bg-destructive/10 border border-destructive/20 rounded-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                  <span className="text-[12px] text-destructive-foreground">
                    Microphone access denied
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Grant microphone permission in System Settings → Privacy &
                  Security → Microphone
                </p>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <Select
                  value={settings.microphoneDeviceId || ""}
                  onChange={(e) => updateMicrophoneDeviceId(e.target.value)}
                  disabled={isLoadingMics || microphones.length === 0}
                  className="flex-1"
                >
                  <option value="">Default microphone</option>
                  {microphones.map((mic) => (
                    <option key={mic.deviceId} value={mic.deviceId}>
                      {mic.label}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={loadMicrophones}
                  disabled={isLoadingMics}
                  title="Refresh microphone list"
                >
                  <RefreshCw
                    size={14}
                    className={isLoadingMics ? "animate-spin" : ""}
                  />
                </Button>
              </div>
            )}
          </div>

          {/* Auto-paste Toggle */}
          <div className="space-y-1.5">
            <Label>Auto-paste</Label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={settings.autoPaste}
                onCheckedChange={updateAutoPaste}
              />
              <span className="text-[12px] text-muted-foreground">
                Automatically paste transcription (requires Accessibility
                permission)
              </span>
            </label>
          </div>
        </Card>

        {/* API Key Section */}
        <Card>
          <ApiKeyInput
            label="Groq API Key"
            value={localGroqApiKey}
            onChange={setLocalGroqApiKey}
            onSave={handleSaveGroqApiKey}
            status={groqStatus}
            placeholder="gsk_..."
          />
        </Card>

        {/* Transcription Rules Section */}
        <RulesSection
          rules={settings.transcriptionRules}
          onToggle={toggleRule}
          onAdd={addRule}
          onUpdate={updateRule}
          onDelete={deleteRule}
        />

        {/* Shortcuts Section */}
        <Card className="space-y-3">
          {/* Recording Shortcut */}
          <div className="space-y-1.5">
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
              <p className="text-[11px] text-muted-foreground animate-pulse">
                Press your key combination...
              </p>
            )}
            {/* Error message - separate row with clear visual treatment */}
            {shortcutError && (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-destructive/10 border border-destructive/20 rounded-md">
                <div className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12px] text-destructive-foreground font-medium">
                    {shortcutError}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Ctrl+V/C/X reserved for clipboard — try Ctrl+Shift+Space
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Cancel Shortcut */}
          <div className="space-y-1.5">
            <Label>Cancel Shortcut</Label>
            <Input
              type="text"
              value={formatShortcut(localCancelShortcut)}
              readOnly
              onFocus={handleStartCancelCapture}
              onBlur={handleStopCancelCapture}
              onKeyDown={isCapturingCancel ? handleCaptureCancelShortcut : undefined}
              placeholder="Click and press keys..."
              capturing={isCapturingCancel}
              error={!!cancelShortcutError}
            />
            {/* Hint - only show when capturing and no error */}
            {isCapturingCancel && !cancelShortcutError && (
              <p className="text-[11px] text-muted-foreground animate-pulse">
                Press Escape or a key combination...
              </p>
            )}
            {/* Error message */}
            {cancelShortcutError && (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-destructive/10 border border-destructive/20 rounded-md">
                <div className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                <span className="text-[12px] text-destructive-foreground font-medium">
                  {cancelShortcutError}
                </span>
              </div>
            )}
          </div>
        </Card>
      </div>

      <footer className="mt-auto pt-4 text-center">
        <p className="text-muted-foreground text-[11px]">
          Press{" "}
          <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono text-[11px]">
            {formatShortcut(settings.shortcut) || "your shortcut"}
          </code>{" "}
          anywhere to start dictating
        </p>
      </footer>
    </div>
  );
}
