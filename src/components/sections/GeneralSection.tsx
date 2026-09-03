import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import {
  Check,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  Mic,
  Settings2,
  Sparkles,
} from "lucide-react";
import { ICON_SIZES, PLATFORMS, STATUS_RESET_DELAY_MS } from "@/lib/constants";
import type { Section } from "@/types/navigation";
import type { LocalModelStatus } from "@/hooks/useLocalModels";
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
  type LlmModelInfo,
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

interface GeneralSectionProps {
  sttProvider: SttProvider;
  groqApiKey: string;
  openaiApiKey: string;
  googleApiKey: string;
  anthropicApiKey: string;
  llmProvider: LlmProvider;
  llmModels: Record<LlmProvider, string>;
  onUpdateSttProvider: (provider: SttProvider) => Promise<void>;
  onSaveGroqApiKey: (key: string) => Promise<void>;
  onSaveOpenaiApiKey: (key: string) => Promise<void>;
  onSaveGoogleApiKey: (key: string) => Promise<void>;
  onSaveAnthropicApiKey: (key: string) => Promise<void>;
  onUpdateLlmProvider: (provider: LlmProvider) => Promise<void>;
  onUpdateLlmModel: (provider: LlmProvider, model: string) => Promise<void>;
  /** Download state of every local model, from the Models section */
  localModels: LocalModelStatus[];
  onNavigate: (section: Section) => void;
}

export function GeneralSection({
  sttProvider,
  groqApiKey,
  openaiApiKey,
  googleApiKey,
  anthropicApiKey,
  llmProvider,
  llmModels,
  onUpdateSttProvider,
  onSaveGroqApiKey,
  onSaveOpenaiApiKey,
  onSaveGoogleApiKey,
  onSaveAnthropicApiKey,
  onUpdateLlmProvider,
  onUpdateLlmModel,
  localModels,
  onNavigate,
}: GeneralSectionProps) {
  const hasOpenaiKey = !!openaiApiKey;

  // Local providers are only selectable once their model is on disk
  const modelById = new Map(localModels.map((m) => [m.id, m]));
  const activeLocalModel =
    sttProvider === "groq" ? undefined : modelById.get(sttProvider);
  const hasGoogleKey = !!googleApiKey;
  const hasAnthropicKey = !!anthropicApiKey;

  const hasActiveProviderKey =
    llmProvider === "openai"
      ? hasOpenaiKey
      : llmProvider === "google"
      ? hasGoogleKey
      : hasAnthropicKey;

  const selectedModel = llmModels[llmProvider];

  // Model list fetched live from the active provider's API
  const [availableModels, setAvailableModels] = useState<LlmModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAvailableModels([]);
    setModelsError(null);
    if (!hasActiveProviderKey) return;

    setModelsLoading(true);
    invoke<LlmModelInfo[]>("list_llm_models", { provider: llmProvider })
      .then((models) => {
        if (!cancelled) setAvailableModels(models);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to fetch models:", err);
          setModelsError(typeof err === "string" ? err : "Failed to fetch models");
        }
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [llmProvider, hasActiveProviderKey]);

  // Keep the saved model selectable even if it's missing from the fetched list
  // (e.g. a deprecated model or a fetch that returned a partial list)
  const modelOptions =
    availableModels.some((m) => m.id === selectedModel) || !selectedModel
      ? availableModels
      : [{ id: selectedModel, display_name: selectedModel }, ...availableModels];

  const selectedModelLabel =
    availableModels.find((m) => m.id === selectedModel)?.display_name ?? selectedModel;

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
            Choose between cloud or local speech-to-text. Local models become
            selectable once downloaded.
          </p>
          <Select
            value={sttProvider}
            onChange={(e) =>
              onUpdateSttProvider(e.target.value as SttProvider)
            }
          >
            {Object.values(STT_PROVIDERS).map((provider) => {
              const isLocal = provider.id !== "groq";
              const model = isLocal ? modelById.get(provider.id) : undefined;
              const available = !isLocal || !!model?.downloaded;
              return (
                <option
                  key={provider.id}
                  value={provider.id}
                  disabled={!available && provider.id !== sttProvider}
                >
                  {provider.name} — {provider.description}
                  {!available ? " (not downloaded)" : ""}
                </option>
              );
            })}
          </Select>
        </div>

        {sttProvider !== "groq" && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-md bg-muted/30 border border-border/50">
            <div className="flex items-center gap-2 min-w-0">
              {activeLocalModel?.loading ? (
                <Loader2 size={ICON_SIZES.xs} className="animate-spin text-muted-foreground shrink-0" />
              ) : (
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    activeLocalModel?.loaded
                      ? "bg-green-500 animate-pulse"
                      : activeLocalModel?.downloaded
                      ? "bg-amber-500"
                      : "bg-destructive"
                  }`}
                />
              )}
              <span className="text-[11px] text-muted-foreground truncate">
                {activeLocalModel?.loading
                  ? "Loading model into memory..."
                  : activeLocalModel?.loaded
                  ? "Model ready"
                  : activeLocalModel?.downloaded
                  ? "Model downloaded, not loaded"
                  : "Model not downloaded"}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onNavigate("models")}
            >
              <HardDrive size={ICON_SIZES.xs} className="mr-1" />
              Manage models
            </Button>
          </div>
        )}
      </Card>

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
                  {provider.name}
                  {!hasKey ? " — Add key below" : ""}
                </option>
              );
            })}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Model</Label>
          <p className="text-[11px] text-muted-foreground">
            Models are fetched live from {LLM_PROVIDERS[llmProvider].name}
          </p>
          <Select
            value={selectedModel}
            disabled={modelsLoading || !hasActiveProviderKey}
            onChange={(e) => onUpdateLlmModel(llmProvider, e.target.value)}
          >
            {modelsLoading ? (
              <option value={selectedModel}>Loading models...</option>
            ) : modelOptions.length > 0 ? (
              modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.display_name}
                </option>
              ))
            ) : (
              <option value={selectedModel}>{selectedModel}</option>
            )}
          </Select>
          {modelsError && (
            <p className="text-[11px] text-destructive">
              Could not fetch models — using {selectedModel}. {modelsError}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-muted/30 border border-border/50">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[11px] text-muted-foreground">
            Using{" "}
            <span className="text-foreground font-medium">
              {selectedModelLabel}
            </span>{" "}
            for text processing
          </span>
        </div>
      </Card>

      <ApiKeyCard
        label="OpenAI API Key"
        description="Unlocks OpenAI GPT models for AI processing"
        placeholder="sk-..."
        linkUrl="https://platform.openai.com/api-keys"
        linkText="platform.openai.com"
        value={openaiApiKey}
        validateCommand="validate_openai_key"
        onSave={onSaveOpenaiApiKey}
      />

      <ApiKeyCard
        label="Google API Key"
        description="Unlocks Google Gemini models for AI processing"
        placeholder="AIza..."
        linkUrl="https://aistudio.google.com/apikey"
        linkText="aistudio.google.com"
        value={googleApiKey}
        validateCommand="validate_google_key"
        onSave={onSaveGoogleApiKey}
      />

      <ApiKeyCard
        label="Anthropic API Key"
        description="Unlocks Anthropic Claude models for AI processing"
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
