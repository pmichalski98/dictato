import { useCallback } from "react";
import { Youtube, X, CheckCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON_SIZES } from "@/lib/constants";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface YouTubeInputProps {
  url: string;
  onUrlChange: (url: string) => void;
  isValidUrl: boolean;
  disabled?: boolean;
}

export function YouTubeInput({
  url,
  onUrlChange,
  isValidUrl,
  disabled,
}: YouTubeInputProps) {
  const handleClear = useCallback(() => {
    onUrlChange("");
  }, [onUrlChange]);

  const hasUrl = url.trim().length > 0;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "relative w-full group",
          hasUrl && isValidUrl && "ring-1 ring-green-500/30 rounded-lg"
        )}
      >
        <div
          className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2 transition-colors",
            hasUrl && isValidUrl && "text-red-500"
          )}
        >
          <Youtube
            size={ICON_SIZES.md}
            className={cn(
              hasUrl && isValidUrl ? "text-red-500" : "text-muted-foreground"
            )}
          />
        </div>
        <Input
          type="text"
          placeholder="Paste YouTube URL..."
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "pl-10 pr-20 h-11 w-full transition-all",
            hasUrl && isValidUrl && "border-green-500/40 bg-green-500/5",
            hasUrl &&
              !isValidUrl &&
              "border-destructive/50 bg-destructive/5 focus-visible:ring-destructive"
          )}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {hasUrl && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              disabled={disabled}
              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <X size={ICON_SIZES.sm} />
            </Button>
          )}
        </div>
      </div>

      {hasUrl && (
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] transition-all",
            isValidUrl
              ? "bg-green-500/10 text-green-400"
              : "bg-destructive/10 text-destructive"
          )}
        >
          {isValidUrl ? (
            <>
              <CheckCircle size={ICON_SIZES.sm} />
              <span className="font-medium">
                Valid YouTube URL — ready to transcribe
              </span>
            </>
          ) : (
            <>
              <AlertCircle size={ICON_SIZES.sm} />
              <span className="font-medium">
                Invalid URL — please enter a valid YouTube link
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
