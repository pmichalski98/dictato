import { useState } from "react";
import {
  Clock,
  Timer,
  RotateCcw,
  FileText,
  Mic,
  Copy,
  Check,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ICON_SIZES } from "@/lib/constants";
import { formatRelativeDate, truncateString } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { useStats, formatTimeSaved } from "@/hooks/useStats";
import {
  useDictationHistory,
  type DictationHistoryItem,
} from "@/hooks/useDictationHistory";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";

const PREVIEW_LENGTH = 90;

function processingBadge(item: DictationHistoryItem): string {
  if (item.kind === "mode") return item.label ?? "Mode";
  if (item.kind === "rules") return "Rules";
  return "Raw";
}

/** A raw or processed transcript block with its own copy button */
function TranscriptBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleCopy}
          title={`Copy ${title.toLowerCase()}`}
        >
          {copied ? (
            <Check size={ICON_SIZES.sm} className="text-green-500" />
          ) : (
            <Copy size={ICON_SIZES.sm} />
          )}
        </Button>
      </div>
      <p className="text-[12px] text-foreground whitespace-pre-wrap rounded-md bg-muted/30 border border-border p-2.5">
        {text}
      </p>
    </div>
  );
}

function DictationItem({
  item,
  onRemove,
}: {
  item: DictationHistoryItem;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const wasProcessed = item.kind !== "none";

  return (
    <div className="py-2 first:pt-0 last:pb-0">
      <div
        className="flex items-center gap-2 cursor-pointer group"
        onClick={() => setExpanded((e) => !e)}
      >
        <ChevronDown
          size={ICON_SIZES.sm}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            !expanded && "-rotate-90"
          )}
        />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-foreground truncate">
            {truncateString(item.processedText, PREVIEW_LENGTH)}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-muted-foreground">
              {formatRelativeDate(item.timestamp)}
            </span>
            <span
              className={cn(
                "text-[10px] px-1.5 py-px rounded font-medium",
                wasProcessed
                  ? "bg-primary/15 text-primary"
                  : "bg-muted/50 text-muted-foreground"
              )}
            >
              {processingBadge(item)}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(item.id);
          }}
          title="Delete entry"
        >
          <Trash2 size={ICON_SIZES.sm} />
        </Button>
      </div>

      {expanded && (
        <div className="mt-2 ml-6 space-y-2.5">
          {wasProcessed ? (
            <>
              <TranscriptBlock title="Original transcript" text={item.rawText} />
              <TranscriptBlock title="After processing" text={item.processedText} />
            </>
          ) : (
            <TranscriptBlock title="Transcript" text={item.rawText} />
          )}
        </div>
      )}
    </div>
  );
}

export function HistorySection() {
  const { stats, isLoading, resetStats } = useStats();
  const { history, removeItem, clearHistory } = useDictationHistory();

  return (
    <SectionLayout
      title="History"
      description="Past transcriptions and statistics"
    >
      {/* Compact Stats Bar */}
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Time Saved - Primary stat */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500/20 via-violet-500/20 to-blue-500/20 flex items-center justify-center">
                <Timer size={ICON_SIZES.md} className="text-primary" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-primary leading-tight">
                  {isLoading ? "..." : formatTimeSaved(stats.totalTimeSavedSeconds)}
                </span>
                <span className="text-[10px] text-muted-foreground">saved</span>
              </div>
            </div>

            {/* Divider */}
            <div className="h-8 w-px bg-border" />

            {/* Words */}
            <div className="flex items-center gap-1.5">
              <FileText size={ICON_SIZES.sm} className="text-muted-foreground" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground leading-tight">
                  {isLoading ? "..." : stats.totalWords.toLocaleString()}
                </span>
                <span className="text-[10px] text-muted-foreground">words</span>
              </div>
            </div>

            {/* Transcriptions */}
            <div className="flex items-center gap-1.5">
              <Mic size={ICON_SIZES.sm} className="text-muted-foreground" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground leading-tight">
                  {isLoading ? "..." : stats.totalTranscriptions.toLocaleString()}
                </span>
                <span className="text-[10px] text-muted-foreground">recordings</span>
              </div>
            </div>
          </div>

          {/* Reset button */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="Reset statistics"
              >
                <RotateCcw size={ICON_SIZES.sm} />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset Statistics?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will reset all your transcription statistics including
                  time saved, word count, and transcription count. This action
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={resetStats}>
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Card>

      {/* Dictation History */}
      <Card className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-[13px]">Recent Dictations</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {history.length > 0
                ? "Expand an entry to compare the raw transcript with the processed result"
                : "Your voice dictations will appear here"}
            </p>
          </div>
          {history.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                >
                  Clear all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear Dictation History?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all {history.length} recorded
                    dictations. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={clearHistory}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Clear
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {history.length > 0 ? (
          <div className="divide-y divide-border">
            {history.map((item) => (
              <DictationItem key={item.id} item={item} onRemove={removeItem} />
            ))}
          </div>
        ) : (
          <div className="py-10 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mb-3">
              <Clock size={ICON_SIZES.lg} className="text-muted-foreground" />
            </div>
            <p className="text-[11px] text-muted-foreground max-w-[280px]">
              Record a dictation with the global shortcut and it will show up
              here with its raw and processed text.
            </p>
          </div>
        )}
      </Card>
    </SectionLayout>
  );
}
