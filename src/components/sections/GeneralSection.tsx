import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Eye, EyeOff, Loader2, Mic, Sparkles } from "lucide-react";
import { ICON_SIZES, STATUS_RESET_DELAY_MS } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { LLM_PROVIDERS, type LlmProvider } from "@/hooks/useSettings";

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
  groqApiKey: string;
  openaiApiKey: string;
  googleApiKey: string;
  anthropicApiKey: string;
  llmProvider: LlmProvider;
  onSaveGroqApiKey: (key: string) => Promise<void>;
  onSaveOpenaiApiKey: (key: string) => Promise<void>;
  onSaveGoogleApiKey: (key: string) => Promise<void>;
  onSaveAnthropicApiKey: (key: string) => Promise<void>;
  onUpdateLlmProvider: (provider: LlmProvider) => Promise<void>;
}

export function GeneralSection({
  groqApiKey,
  openaiApiKey,
  googleApiKey,
  anthropicApiKey,
  llmProvider,
  onSaveGroqApiKey,
  onSaveOpenaiApiKey,
  onSaveGoogleApiKey,
  onSaveAnthropicApiKey,
  onUpdateLlmProvider,
}: GeneralSectionProps) {
  const hasOpenaiKey = !!openaiApiKey;
  const hasGoogleKey = !!googleApiKey;
  const hasAnthropicKey = !!anthropicApiKey;

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
    </SectionLayout>
  );
}
