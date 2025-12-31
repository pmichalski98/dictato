import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatShortcut, parseKeyboardEvent, BLOCKED_SHORTCUTS } from "@/lib/shortcuts";
import { ICON_SIZES, STATUS_RESET_DELAY_MS } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";

interface AudioDevice {
  deviceId: string;
  label: string;
}

interface NativeAudioDevice {
  id: string;
  name: string;
  is_default: boolean;
}

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

interface RecordingSectionProps {
  language: string;
  microphoneDeviceId: string;
  autoPaste: boolean;
  shortcut: string;
  cancelShortcut: string;
  onUpdateLanguage: (lang: string) => void;
  onUpdateMicrophoneDeviceId: (deviceId: string) => void;
  onUpdateAutoPaste: (enabled: boolean) => void;
  onUpdateShortcut: (shortcut: string) => void;
  onUpdateCancelShortcut: (shortcut: string) => void;
}

export function RecordingSection({
  language,
  microphoneDeviceId,
  autoPaste,
  shortcut,
  cancelShortcut,
  onUpdateLanguage,
  onUpdateMicrophoneDeviceId,
  onUpdateAutoPaste,
  onUpdateShortcut,
  onUpdateCancelShortcut,
}: RecordingSectionProps) {
  const [localShortcut, setLocalShortcut] = useState("");
  const [localCancelShortcut, setLocalCancelShortcut] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCapturingCancel, setIsCapturingCancel] = useState(false);
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
      const devices = await invoke<NativeAudioDevice[]>("list_audio_devices");
      const audioInputs = devices.map((device) => ({
        deviceId: device.id,
        label: device.name,
      }));
      setMicrophones(audioInputs);
      setMicPermissionStatus("granted");
    } catch (err) {
      console.error("Failed to enumerate microphones:", err);
      setMicPermissionStatus("unknown");
    } finally {
      setIsLoadingMics(false);
    }
  }, []);

  useEffect(() => {
    loadMicrophones();
  }, [loadMicrophones]);

  useEffect(() => {
    setLocalShortcut(shortcut);
    setLocalCancelShortcut(cancelShortcut);
  }, [shortcut, cancelShortcut]);

  useEffect(() => {
    if (shortcut) {
      invoke("register_shortcut", { shortcutStr: shortcut }).catch(console.error);
    }
  }, [shortcut]);

  const handleStartCapture = useCallback(() => {
    setIsCapturing(true);
    setShortcutError(null);
    invoke("unregister_shortcuts").catch(console.error);
  }, []);

  const handleStopCapture = useCallback(() => {
    setIsCapturing(false);
    if (shortcut) {
      invoke("register_shortcut", { shortcutStr: shortcut }).catch(console.error);
    }
  }, [shortcut]);

  const handleCaptureShortcut = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();

      const { shortcutString } = parseKeyboardEvent(e);

      if (shortcutString) {
        if (BLOCKED_SHORTCUTS.includes(shortcutString as typeof BLOCKED_SHORTCUTS[number])) {
          setShortcutError("Conflicts with clipboard");
          setTimeout(() => setShortcutError(null), STATUS_RESET_DELAY_MS);
          return;
        }

        if (shortcutString === cancelShortcut) {
          setShortcutError("Same as cancel shortcut");
          setTimeout(() => setShortcutError(null), STATUS_RESET_DELAY_MS);
          return;
        }

        setLocalShortcut(shortcutString);
        onUpdateShortcut(shortcutString);
        setIsCapturing(false);
      }
    },
    [onUpdateShortcut, cancelShortcut]
  );

  const handleStartCancelCapture = useCallback(() => {
    setIsCapturingCancel(true);
    setCancelShortcutError(null);
    invoke("unregister_shortcuts").catch(console.error);
  }, []);

  const handleStopCancelCapture = useCallback(() => {
    setIsCapturingCancel(false);
    if (shortcut) {
      invoke("register_shortcut", { shortcutStr: shortcut }).catch(console.error);
    }
  }, [shortcut]);

  const handleCaptureCancelShortcut = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();

      const key = e.key;

      // Allow Escape as a single key for cancel
      if (key === "Escape") {
        setLocalCancelShortcut("Escape");
        onUpdateCancelShortcut("Escape");
        invoke("register_cancel_shortcut", { shortcutStr: "Escape" }).catch(console.error);
        setIsCapturingCancel(false);
        return;
      }

      const { shortcutString } = parseKeyboardEvent(e);

      if (shortcutString) {
        if (shortcutString === shortcut) {
          setCancelShortcutError("Same as recording shortcut");
          setTimeout(() => setCancelShortcutError(null), STATUS_RESET_DELAY_MS);
          return;
        }

        setLocalCancelShortcut(shortcutString);
        onUpdateCancelShortcut(shortcutString);
        invoke("register_cancel_shortcut", { shortcutStr: shortcutString }).catch(console.error);
        setIsCapturingCancel(false);
      }
    },
    [onUpdateCancelShortcut, shortcut]
  );

  return (
    <SectionLayout
      title="Recording"
      description="Audio input and shortcut configuration"
    >
      {/* Audio Settings */}
      <Card className="space-y-3">
        {/* Language */}
        <div className="space-y-1.5">
          <Label>Language</Label>
          <Select
            value={language}
            onChange={(e) => onUpdateLanguage(e.target.value)}
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
                value={microphoneDeviceId || ""}
                onChange={(e) => onUpdateMicrophoneDeviceId(e.target.value)}
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
                  size={ICON_SIZES.sm}
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
              checked={autoPaste}
              onCheckedChange={onUpdateAutoPaste}
            />
            <span className="text-[12px] text-muted-foreground">
              Automatically paste transcription (requires Accessibility
              permission)
            </span>
          </label>
        </div>
      </Card>

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
          {isCapturing && !shortcutError && (
            <p className="text-[11px] text-muted-foreground animate-pulse">
              Press your key combination...
            </p>
          )}
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
          {isCapturingCancel && !cancelShortcutError && (
            <p className="text-[11px] text-muted-foreground animate-pulse">
              Press Escape or a key combination...
            </p>
          )}
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

      {/* Hint */}
      <p className="text-muted-foreground text-[11px] text-center">
        Press{" "}
        <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono text-[11px]">
          {formatShortcut(shortcut) || "your shortcut"}
        </code>{" "}
        anywhere to start dictating
      </p>
    </SectionLayout>
  );
}
