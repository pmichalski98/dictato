import { useState } from "react";
import { Copy, Check, Clock, FileText, ChevronDown, ChevronUp, RotateCcw, Download, Maximize2, Minimize2, ArrowLeft, Sparkles, AlertTriangle } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { cn } from "@/lib/utils";
import { ICON_SIZES, TRANSCRIPTION_UI } from "@/lib/constants";
import { formatDuration } from "@/lib/formatters";
import { Button } from "../ui/button";
import { TranscriptionResult as TranscriptionResultType, TranscribeProgress } from "@/hooks/useTranscribe";

interface TranscriptionResultProps {
  result: TranscriptionResultType | null;
  progress: TranscribeProgress | null;
  error: string | null;
  isTranscribing: boolean;
  onNewTranscription: () => void;
  isViewingHistory?: boolean;
  historySourceName?: string;
}

export function TranscriptionResult({
  result,
  progress,
  error,
  isTranscribing,
  onNewTranscription,
  isViewingHistory = false,
  historySourceName,
}: TranscriptionResultProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [showFullText, setShowFullText] = useState(false);
  const [copiedField, setCopiedField] = useState<"raw" | "processed" | null>(null);

  const handleCopy = async (text: string, field: "raw" | "processed") => {
    try {
      await writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), TRANSCRIPTION_UI.COPY_FEEDBACK_TIMEOUT_MS);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleDownload = async (text: string, defaultName: string) => {
    try {
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{
          name: "Text",
          extensions: ["txt"],
        }],
      });

      if (filePath) {
        await writeTextFile(filePath, text);
      }
    } catch (err) {
      console.error("Failed to save file:", err);
    }
  };

  // Get stage-specific styling
  const getStageInfo = (stage: TranscribeProgress["stage"]) => {
    switch (stage) {
      case "preparing":
        return { color: "text-muted-foreground", label: "Preparing" };
      case "downloading":
        return { color: "text-blue-400", label: "Downloading" };
      case "extracting":
        return { color: "text-violet-400", label: "Extracting audio" };
      case "splitting":
        return { color: "text-pink-400", label: "Processing" };
      case "transcribing":
        return { color: "text-primary", label: "Transcribing" };
      case "processing":
        return { color: "text-green-400", label: "Finalizing" };
      case "complete":
        return { color: "text-green-500", label: "Complete" };
      default:
        return { color: "text-muted-foreground", label: "Processing" };
    }
  };

  // Progress state
  if (isTranscribing && progress) {
    const stageInfo = getStageInfo(progress.stage);

    return (
      <div className="border border-border rounded-xl">
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className={cn("text-[13px] font-medium", stageInfo.color)}>
                {progress.message}
              </span>
            </div>
            <span className="text-[13px] font-bold tabular-nums text-primary">
              {progress.percent}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="relative w-full h-2 bg-muted/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
              style={{ width: `${progress.percent}%` }}
            />
          </div>

          {/* Stage indicators */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
            <span>Preparing</span>
            <span>Processing</span>
            <span>Complete</span>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="relative overflow-hidden border border-destructive/30 bg-gradient-to-br from-destructive/10 via-destructive/5 to-transparent rounded-xl">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-destructive/50" />

        <div className="flex items-start gap-3 p-4">
          <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0 ring-1 ring-destructive/20">
            <AlertTriangle size={ICON_SIZES.md} className="text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-destructive">
              Transcription failed
            </p>
            <p className="text-[11px] text-destructive/70 mt-1 leading-relaxed">
              {error}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onNewTranscription}
            className="shrink-0 hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <RotateCcw size={ICON_SIZES.sm} className="mr-1.5" />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // Result state
  if (result) {
    const displayText = result.processed_text || result.raw_text;
    const hasProcessed = result.processed_text && result.processed_text !== result.raw_text;
    const isLongText = displayText.length > TRANSCRIPTION_UI.TEXT_TRUNCATE_THRESHOLD;

    return (
      <div className="relative overflow-hidden border border-border rounded-xl">
        {/* Success gradient accent */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500" />

        {/* Header with stats */}
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-green-500/5 via-transparent to-transparent border-b border-border">
          <div className="flex items-center gap-4">
            {isViewingHistory && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onNewTranscription}
                className="h-7 text-[11px] -ml-1 mr-2 hover:bg-muted/50"
              >
                <ArrowLeft size={ICON_SIZES.xs} className="mr-1" />
                Back
              </Button>
            )}
            {isViewingHistory && historySourceName && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[150px]" title={historySourceName}>
                {historySourceName.length > 30 ? historySourceName.substring(0, 30) + "..." : historySourceName}
              </span>
            )}
            {!isViewingHistory && (
              <div className="flex items-center gap-1.5">
                <Sparkles size={ICON_SIZES.sm} className="text-green-500" />
                <span className="text-[12px] font-medium text-green-500">
                  Complete
                </span>
              </div>
            )}
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <Clock size={ICON_SIZES.sm} className="text-muted-foreground" />
              <span className="text-[12px] text-foreground tabular-nums">
                {formatDuration(result.duration_seconds)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <FileText size={ICON_SIZES.sm} className="text-muted-foreground" />
              <span className="text-[12px] text-foreground tabular-nums">
                {result.word_count.toLocaleString()} words
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDownload(displayText, "transcription.txt")}
              className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-colors"
              title="Download as .txt"
            >
              <Download size={ICON_SIZES.sm} />
            </Button>
            {!isViewingHistory && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onNewTranscription}
                className="h-8 text-[11px]"
              >
                <RotateCcw size={ICON_SIZES.xs} className="mr-1.5" />
                New
              </Button>
            )}
          </div>
        </div>

        {/* Main text */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {showFullText ? (
                /* max-h matches TRANSCRIPTION_UI.FULL_TEXT_MAX_HEIGHT */
                <div className="max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                  <p className="text-[13px] text-foreground whitespace-pre-wrap break-words">
                    {displayText}
                  </p>
                </div>
              ) : (
                <p className="text-[13px] text-foreground whitespace-pre-wrap break-words">
                  {isLongText
                    ? displayText.substring(0, TRANSCRIPTION_UI.TEXT_TRUNCATE_THRESHOLD) + "..."
                    : displayText}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleCopy(displayText, "processed")}
              className="shrink-0 h-8 w-8"
              title="Copy to clipboard"
            >
              {copiedField === "processed" ? (
                <Check size={ICON_SIZES.md} className="text-green-500" />
              ) : (
                <Copy size={ICON_SIZES.md} />
              )}
            </Button>
          </div>

          {/* Show full text toggle */}
          {isLongText && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 h-8 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => setShowFullText(!showFullText)}
            >
              {showFullText ? (
                <>
                  <Minimize2 size={ICON_SIZES.xs} className="mr-1.5" />
                  Show less
                </>
              ) : (
                <>
                  <Maximize2 size={ICON_SIZES.xs} className="mr-1.5" />
                  Show full text ({displayText.length.toLocaleString()} characters)
                </>
              )}
            </Button>
          )}
        </div>

        {/* Raw text toggle (if processed) */}
        {hasProcessed && (
          <div className="border-t border-border">
            <Button
              variant="ghost"
              onClick={() => setShowRaw(!showRaw)}
              className="flex items-center justify-between w-full px-4 py-2 h-auto text-[11px] text-muted-foreground hover:bg-muted/30 rounded-none"
            >
              <span>Show raw transcript</span>
              {showRaw ? (
                <ChevronUp size={ICON_SIZES.sm} />
              ) : (
                <ChevronDown size={ICON_SIZES.sm} />
              )}
            </Button>

            {showRaw && (
              <div className="px-4 pb-4">
                <div className="flex items-start justify-between gap-3 p-3 bg-muted/20 rounded max-h-[200px] overflow-y-auto">
                  <p className="text-[12px] text-muted-foreground whitespace-pre-wrap break-words flex-1">
                    {result.raw_text}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopy(result.raw_text, "raw")}
                    className="shrink-0 h-7 w-7"
                    title="Copy raw text"
                  >
                    {copiedField === "raw" ? (
                      <Check size={ICON_SIZES.sm} className="text-green-500" />
                    ) : (
                      <Copy size={ICON_SIZES.sm} />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
