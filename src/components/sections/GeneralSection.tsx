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

interface GeneralSectionProps {
  groqApiKey: string;
  onSaveApiKey: (key: string) => Promise<void>;
}

export function GeneralSection({
  groqApiKey,
  onSaveApiKey,
}: GeneralSectionProps) {
  const [localApiKey, setLocalApiKey] = useState("");
  const [isRevealed, setIsRevealed] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    setLocalApiKey(groqApiKey);
  }, [groqApiKey]);

  const handleSave = useCallback(async () => {
    try {
      await onSaveApiKey(localApiKey);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), STATUS_RESET_DELAY_MS);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), STATUS_RESET_DELAY_MS);
    }
  }, [localApiKey, onSaveApiKey]);

  return (
    <SectionLayout
      title="General"
      description="API configuration and app settings"
    >
      {/* API Key Section */}
      <Card className="space-y-3">
        <div className="space-y-1.5">
          <Label>Groq API Key</Label>
          <div className="flex gap-1.5">
            <div className="relative w-full">
              <Input
                type={isRevealed ? "text" : "password"}
                value={localApiKey}
                onChange={(e) => setLocalApiKey(e.target.value)}
                placeholder="gsk_..."
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
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              console.groq.com
            </a>
          </p>
        </div>
      </Card>

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
