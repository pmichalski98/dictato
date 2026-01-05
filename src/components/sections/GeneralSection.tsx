import { useState, useCallback, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { ICON_SIZES, STATUS_RESET_DELAY_MS } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ComingSoonBadge } from "../ui/ComingSoonBadge";

type SaveStatus = "idle" | "saved" | "error";

interface ApiKeyCardProps {
  label: string;
  description: string;
  placeholder: string;
  linkUrl: string;
  linkText: string;
  value: string;
  onSave: (key: string) => Promise<void>;
}

function ApiKeyCard({
  label,
  description,
  placeholder,
  linkUrl,
  linkText,
  value,
  onSave,
}: ApiKeyCardProps) {
  const [localKey, setLocalKey] = useState("");
  const [isRevealed, setIsRevealed] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    setLocalKey(value);
  }, [value]);

  const handleSave = useCallback(async () => {
    try {
      await onSave(localKey);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), STATUS_RESET_DELAY_MS);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), STATUS_RESET_DELAY_MS);
    }
  }, [localKey, onSave]);

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
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setIsRevealed(!isRevealed)}
              tabIndex={-1}
            >
              {isRevealed ? (
                <Eye size={ICON_SIZES.sm} />
              ) : (
                <EyeOff size={ICON_SIZES.sm} />
              )}
            </button>
          </div>
          <Button
            onClick={handleSave}
            variant={status === "error" ? "destructive" : "default"}
          >
            {status === "saved"
              ? "Saved"
              : status === "error"
                ? "Error"
                : "Save"}
          </Button>
        </div>
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

interface GeneralSectionProps {
  groqApiKey: string;
  openaiApiKey: string;
  onSaveGroqApiKey: (key: string) => Promise<void>;
  onSaveOpenaiApiKey: (key: string) => Promise<void>;
}

export function GeneralSection({
  groqApiKey,
  openaiApiKey,
  onSaveGroqApiKey,
  onSaveOpenaiApiKey,
}: GeneralSectionProps) {
  return (
    <SectionLayout
      title="General"
      description="API configuration and app settings"
    >
      <ApiKeyCard
        label="Groq API Key"
        description="Used for voice transcription (Whisper)"
        placeholder="gsk_..."
        linkUrl="https://console.groq.com/keys"
        linkText="console.groq.com"
        value={groqApiKey}
        onSave={onSaveGroqApiKey}
      />

      <ApiKeyCard
        label="OpenAI API Key"
        description="Used for AI modes and transcription rules"
        placeholder="sk-..."
        linkUrl="https://platform.openai.com/api-keys"
        linkText="platform.openai.com"
        value={openaiApiKey}
        onSave={onSaveOpenaiApiKey}
      />

      {/* Model Selection - Future */}
      <Card className="space-y-3 opacity-50">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label>Model</Label>
            <ComingSoonBadge />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Support for additional transcription models will be added in a
            future update.
          </p>
        </div>
      </Card>
    </SectionLayout>
  );
}
