import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import {
  Check,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  Mic,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { EVENTS, ICON_SIZES, PLATFORMS, STATUS_RESET_DELAY_MS } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  LLM_PROVIDERS,
  STT_PROVIDERS,
  type LlmProvider,
  type SttProvider,
} from "@/hooks/useSettings";

type SaveStatus = "idle" | "validating" | "saved" | "error";

const SUCCESS_MESSAGE = "API key validated and saved";

interface ApiKeyCardProps {
  label: string;
  description: string;
  placeholder: string;
  linkUrl: string;
  linkText: string;
  value: string;
  validateCommand: string;
  onSave: (key: string) => Promise<void>;
}

function ApiKeyCard({
  label,
  description,
  placeholder,
  linkUrl,
  linkText,
  value,
  validateCommand,
  onSave,
}: ApiKeyCardProps) {
  const [localKey, setLocalKey] = useState("");
  const [isRevealed, setIsRevealed] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setLocalKey(value);
  }, [value]);

  const handleSave = useCallback(async () => {
    // Clear any previous error
    setErrorMessage(null);

    // If the key is empty, just save it (allows clearing the key)
    if (!localKey.trim()) {
      try {
        await onSave(localKey);
        setStatus("saved");
        setTimeout(() => setStatus("idle"), STATUS_RESET_DELAY_MS);
      } catch {
        setStatus("error");
        setErrorMessage("Failed to save");
        setTimeout(() => {
          setStatus("idle");
          setErrorMessage(null);
        }, STATUS_RESET_DELAY_MS);
      }
      return;
    }

    // Validate the key first
    setStatus("validating");
    try {
      await invoke(validateCommand, { apiKey: localKey });
      // Validation passed, now save
      await onSave(localKey);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), STATUS_RESET_DELAY_MS);
    } catch (error) {
      setStatus("error");
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setTimeout(() => {
        setStatus("idle");
        setErrorMessage(null);
      }, STATUS_RESET_DELAY_MS * 2); // Show error longer
    }
  }, [localKey, onSave, validateCommand]);

  const getButtonText = () => {
    switch (status) {
      case "validating":
        return "Validating...";
      case "saved":
        return "Saved";
      case "error":
        return "Error";
      default:
        return "Save";
    }
  };

  return (
    <Card className="space-y-3">
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <p className="text-[11px] text-muted-foreground">{description}</p>
        <div className="flex gap-1.5">
          <div className="relative w-full">
            <Input
              type={isRevealed ? "text" : "password"}
              value={localKey}
              onChange={(e) => setLocalKey(e.target.value)}
              placeholder={placeholder}
              className="pr-8 w-full"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setIsRevealed(!isRevealed)}
              tabIndex={-1}
            >
              {isRevealed ? (
                <Eye size={ICON_SIZES.sm} />
              ) : (
                <EyeOff size={ICON_SIZES.sm} />
              )}
            </Button>
          </div>
          <Button
            onClick={handleSave}
            variant={status === "error" ? "destructive" : "default"}
            disabled={status === "validating" || status === "error"}
          >
            {status === "validating" && (
              <Loader2 size={ICON_SIZES.sm} className="mr-1.5 animate-spin" />
            )}
            {status === "saved" && (
              <Check size={ICON_SIZES.sm} className="mr-1.5" />
            )}
            {getButtonText()}
          </Button>
        </div>
        {status === "saved" && (
          <p className="text-[11px] text-green-500">{SUCCESS_MESSAGE}</p>
        )}
        {errorMessage && status === "error" && (
          <p className="text-[11px] text-destructive">{errorMessage}</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          Get your API key from{" "}
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {linkText}
          </a>
        </p>
      </div>
    </Card>
  );
}

interface SectionDividerProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  accentColor?: "purple" | "pink";
}

function SectionDivider({
  icon,
  title,
  description,
  accentColor = "purple",
}: SectionDividerProps) {
  const gradientClass =
    accentColor === "pink" ? "from-pink-500/20" : "from-purple-500/20";
  const textClass =
    accentColor === "pink" ? "text-pink-400" : "text-purple-400";

  return (
    <div className="relative pt-4 pb-2">
      <div
        className={`absolute inset-x-0 top-0 h-px bg-linear-to-r ${gradientClass} to-transparent`}
      />
      <div className="flex items-center gap-2.5">
        <div
          className={`flex items-center justify-center w-7 h-7 rounded-md bg-linear-to-br ${gradientClass} to-transparent ${textClass}`}
        >
          {icon}
        </div>
        <div>
          <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
          <p className="text-[10px] text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

type ParakeetStatus =
  | "checking"
  | "not_downloaded"
  | "downloading"
  | "loading"
  | "downloaded"
  | "ready"
  | "error";

interface DownloadProgress {
  bytesDownloaded?: number;
  totalBytes?: number;
  percent: number;
  finishing: boolean;
}

function ParakeetModelCard() {
  const [status, setStatus] = useState<ParakeetStatus>("checking");
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkStatus() {
      try {
        const result = await invoke<string>("get_parakeet_model_status");
        setStatus(result as ParakeetStatus);
      } catch (err) {
        console.error("Failed to check model status:", err);
        setStatus("error");
        setError(String(err));
      }
    }
    checkStatus();
  }, []);

  useEffect(() => {
    const unlistenProgress = listen<DownloadProgress>(
      EVENTS.PARAKEET_DOWNLOAD_PROGRESS,
      (event) => {
        setDownloadProgress(event.payload);
      }
    );
    const unlistenLoading = listen<boolean>(
      EVENTS.PARAKEET_LOADING,
      (event) => {
        if (event.payload) {
          setStatus("loading");
        } else {
          // Refresh actual status after loading completes
          invoke<string>("get_parakeet_model_status")
            .then((result) => setStatus(result as ParakeetStatus))
            .catch(() => {});
        }
      }
    );
    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenLoading.then((fn) => fn());
    };
  }, []);

  const handleDownload = useCallback(async () => {
    setStatus("downloading");
    setError(null);
    setDownloadProgress(null);
    try {
      await invoke("download_parakeet_model");
      setStatus("ready");
    } catch (err) {
      console.error("Failed to download model:", err);
      setStatus("error");
      setError(String(err));
    }
  }, []);

  const handleDelete = useCallback(async () => {
    setError(null);
    try {
      await invoke("delete_parakeet_model");
      setStatus("not_downloaded");
      setDownloadProgress(null);
    } catch (err) {
      console.error("Failed to delete model:", err);
      setError(String(err));
    }
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <HardDrive size={ICON_SIZES.sm} className="text-muted-foreground" />
          <Label>Parakeet Model</Label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          NVIDIA Parakeet TDT v3 (600M params, ~670 MB download). Supports 25
          European languages.
        </p>
      </div>

      {status === "checking" && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 size={ICON_SIZES.sm} className="animate-spin" />
          Checking model status...
        </div>
      )}

      {status === "not_downloaded" && (
        <Button onClick={handleDownload} className="w-full">
          <Download size={ICON_SIZES.sm} className="mr-1.5" />
          Download Model (~670 MB)
        </Button>
      )}

      {status === "downloading" && (
        <div className="space-y-2">
          {downloadProgress?.finishing ? (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 size={ICON_SIZES.sm} className="animate-spin" />
              Finishing up...
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">
                  Downloading model...
                </span>
                <span className="text-foreground font-medium">
                  {downloadProgress
                    ? `${downloadProgress.percent.toFixed(0)}%`
                    : ""}
                </span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{
                    width: `${downloadProgress?.percent ?? 0}%`,
                  }}
                />
              </div>
              {downloadProgress?.bytesDownloaded != null &&
                downloadProgress?.totalBytes != null &&
                downloadProgress.totalBytes > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    {formatBytes(downloadProgress.bytesDownloaded)} /{" "}
                    {formatBytes(downloadProgress.totalBytes)}
                  </p>
                )}
            </>
          )}
        </div>
      )}

      {status === "loading" && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 size={ICON_SIZES.sm} className="animate-spin" />
          Loading model into memory...
        </div>
      )}

      {(status === "ready" || status === "downloaded") && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-muted/30 border border-border/50">
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                status === "ready"
                  ? "bg-green-500 animate-pulse"
                  : "bg-amber-500"
              }`}
            />
            <span className="text-[11px] text-muted-foreground">
              Model{" "}
              <span className="text-foreground font-medium">
                {status === "ready" ? "ready" : "downloaded (not loaded)"}
              </span>
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="text-[11px] text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={ICON_SIZES.xs} className="mr-1" />
            Delete model
          </Button>
        </div>
      )}

      {error && (
        <div className="space-y-2">
          <p className="text-[11px] text-destructive">{error}</p>
          {status === "error" && (
            <Button onClick={handleDownload} variant="default" size="sm">
              Retry Download
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

interface GeneralSectionProps {
  sttProvider: SttProvider;
  groqApiKey: string;
  openaiApiKey: string;
  googleApiKey: string;
  anthropicApiKey: string;
  llmProvider: LlmProvider;
  onUpdateSttProvider: (provider: SttProvider) => Promise<void>;
  onSaveGroqApiKey: (key: string) => Promise<void>;
  onSaveOpenaiApiKey: (key: string) => Promise<void>;
  onSaveGoogleApiKey: (key: string) => Promise<void>;
  onSaveAnthropicApiKey: (key: string) => Promise<void>;
  onUpdateLlmProvider: (provider: LlmProvider) => Promise<void>;
}

export function GeneralSection({
  sttProvider,
  groqApiKey,
  openaiApiKey,
  googleApiKey,
  anthropicApiKey,
  llmProvider,
  onUpdateSttProvider,
  onSaveGroqApiKey,
  onSaveOpenaiApiKey,
  onSaveGoogleApiKey,
  onSaveAnthropicApiKey,
  onUpdateLlmProvider,
}: GeneralSectionProps) {
  const hasOpenaiKey = !!openaiApiKey;
  const hasGoogleKey = !!googleApiKey;
  const hasAnthropicKey = !!anthropicApiKey;

  // Autostart state (Windows only)
  const [isWindows, setIsWindows] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  useEffect(() => {
    async function checkPlatformAndAutostart() {
      try {
        const currentPlatform = await platform();
        const isWin = currentPlatform === PLATFORMS.WINDOWS;
        setIsWindows(isWin);

        if (isWin) {
          const enabled = await invoke<boolean>("get_autostart");
          setAutostart(enabled);
        }
      } catch (error) {
        console.error("Failed to check platform/autostart:", error);
      } finally {
        setAutostartLoading(false);
      }
    }
    checkPlatformAndAutostart();
  }, []);

  const handleAutostartChange = useCallback(async (enabled: boolean) => {
    setAutostartError(null);
    try {
      await invoke("set_autostart", { enabled });
      setAutostart(enabled);
    } catch (error) {
      console.error("Failed to set autostart:", error);
      const message = error instanceof Error ? error.message : String(error);
      setAutostartError(message);
      setTimeout(() => setAutostartError(null), STATUS_RESET_DELAY_MS * 2);
    }
  }, []);

  return (
    <SectionLayout
      title="General"
      description="API configuration and app settings"
    >
      {/* Voice Transcription Section */}
      <SectionDivider
        icon={<Mic size={ICON_SIZES.sm} />}
        title="Voice Transcription"
        description="Speech-to-text provider for recording"
        accentColor="pink"
      />

      <Card className="space-y-3">
        <div className="space-y-1.5">
          <Label>Transcription Provider</Label>
          <p className="text-[11px] text-muted-foreground">
            Choose between cloud or local speech-to-text
          </p>
          <Select
            value={sttProvider}
            onChange={(e) =>
              onUpdateSttProvider(e.target.value as SttProvider)
            }
          >
            {Object.values(STT_PROVIDERS).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} — {provider.description}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {sttProvider === "parakeet" && <ParakeetModelCard />}

      {sttProvider === "groq" && (
        <ApiKeyCard
          label="Groq API Key"
          description="Powers fast voice transcription using Whisper large-v3"
          placeholder="gsk_..."
          linkUrl="https://console.groq.com/keys"
          linkText="console.groq.com"
          value={groqApiKey}
          validateCommand="validate_groq_key"
          onSave={onSaveGroqApiKey}
        />
      )}

      {/* AI Processing Section */}
      <SectionDivider
        icon={<Sparkles size={ICON_SIZES.sm} />}
        title="AI Processing"
        description="Language model for modes and rules"
        accentColor="purple"
      />

      {/* Provider Selection Card */}
      <Card className="space-y-4">
        <div className="space-y-1.5">
          <Label>Active Provider</Label>
          <p className="text-[11px] text-muted-foreground">
            Choose which AI model processes your transcriptions
          </p>
          <Select
            value={llmProvider}
            onChange={(e) => onUpdateLlmProvider(e.target.value as LlmProvider)}
          >
            {Object.values(LLM_PROVIDERS).map((provider) => {
              const hasKey =
                provider.id === "openai"
                  ? hasOpenaiKey
                  : provider.id === "google"
                  ? hasGoogleKey
                  : hasAnthropicKey;
              return (
                <option
                  key={provider.id}
                  value={provider.id}
                  disabled={!hasKey}
                >
                  {provider.name} ({provider.model})
                  {!hasKey ? " — Add key below" : ""}
                </option>
              );
            })}
          </Select>
        </div>

        <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-muted/30 border border-border/50">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[11px] text-muted-foreground">
            Using{" "}
            <span className="text-foreground font-medium">
              {LLM_PROVIDERS[llmProvider].model}
            </span>{" "}
            for text processing
          </span>
        </div>
      </Card>

      <ApiKeyCard
        label="OpenAI API Key"
        description="Used for GPT-4.1 Mini AI processing"
        placeholder="sk-..."
        linkUrl="https://platform.openai.com/api-keys"
        linkText="platform.openai.com"
        value={openaiApiKey}
        validateCommand="validate_openai_key"
        onSave={onSaveOpenaiApiKey}
      />

      <ApiKeyCard
        label="Google API Key"
        description="Used for Gemini 2.0 Flash AI processing"
        placeholder="AIza..."
        linkUrl="https://aistudio.google.com/apikey"
        linkText="aistudio.google.com"
        value={googleApiKey}
        validateCommand="validate_google_key"
        onSave={onSaveGoogleApiKey}
      />

      <ApiKeyCard
        label="Anthropic API Key"
        description="Used for Claude 3.5 Haiku AI processing"
        placeholder="sk-ant-..."
        linkUrl="https://console.anthropic.com/settings/keys"
        linkText="console.anthropic.com"
        value={anthropicApiKey}
        validateCommand="validate_anthropic_key"
        onSave={onSaveAnthropicApiKey}
      />

      {/* System Settings Section (Windows only) */}
      {isWindows && (
        <>
          <SectionDivider
            icon={<Settings2 size={ICON_SIZES.sm} />}
            title="System Settings"
            description="Windows startup and system behavior"
            accentColor="purple"
          />

          <Card className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Start with Windows</Label>
                <p className="text-[11px] text-muted-foreground">
                  Launch Dictato automatically when Windows starts (runs in
                  background)
                </p>
              </div>
              <Switch
                checked={autostart}
                onCheckedChange={handleAutostartChange}
                disabled={autostartLoading}
              />
            </div>
            {autostartError && (
              <p className="text-[11px] text-destructive">{autostartError}</p>
            )}
          </Card>
        </>
      )}
    </SectionLayout>
  );
}
