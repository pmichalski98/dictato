import { useState } from "react";
import {
  Clock,
  Youtube,
  Trash2,
  ChevronDown,
  ChevronUp,
  History,
  FileAudio,
  Copy,
  Check,
  Download,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { cn } from "@/lib/utils";
import { ICON_SIZES, TRANSCRIPTION_UI } from "@/lib/constants";
import {
  formatDuration,
  formatRelativeDate,
  truncateString,
} from "@/lib/formatters";
import type { TranscriptionHistoryItem } from "@/hooks/useTranscriptionHistory";

interface TranscriptionHistoryProps {
  history: TranscriptionHistoryItem[];
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function TranscriptionHistory({
  history,
  onDelete,
  onClear,
}: TranscriptionHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (text: string, itemId: string) => {
    try {
      await writeText(text);
      setCopiedId(itemId);
      setTimeout(
        () => setCopiedId(null),
        TRANSCRIPTION_UI.COPY_FEEDBACK_TIMEOUT_MS
      );
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleDownload = async (text: string, sourceName: string) => {
    try {
      const defaultName =
        sourceName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50) + ".txt";
      const filePath = await save({
        defaultPath: defaultName,
        filters: [
          {
            name: "Text",
            extensions: ["txt"],
          },
        ],
      });

      if (filePath) {
        await writeTextFile(filePath, text);
      }
    } catch (err) {
      console.error("Failed to save file:", err);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleDeleteConfirm = () => {
    if (deleteItemId) {
      onDelete(deleteItemId);
      setDeleteItemId(null);
      // If we deleted the expanded item, collapse it
      if (expandedId === deleteItemId) {
        setExpandedId(null);
      }
    }
  };

  const handleClearConfirm = () => {
    onClear();
    setShowClearDialog(false);
    setExpandedId(null);
  };

  const itemToDelete = deleteItemId
    ? history.find((h) => h.id === deleteItemId)
    : null;

  if (history.length === 0) {
    return (
      <div className="border border-dashed border-border/60 rounded-xl p-8 text-center bg-muted/10">
        <div className="w-14 h-14 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-3">
          <History size={ICON_SIZES.lg} className="text-muted-foreground/60" />
        </div>
        <p className="text-[13px] font-medium text-muted-foreground">
          No transcription history yet
        </p>
        <p className="text-[11px] text-muted-foreground/70 mt-1">
          Your transcriptions will appear here
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-foreground flex items-center gap-2">
            <History size={ICON_SIZES.sm} className="text-primary" />
            History
            <span className="text-[10px] text-muted-foreground font-normal px-1.5 py-0.5 bg-muted/50 rounded">
              {history.length}
            </span>
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] text-muted-foreground hover:text-destructive"
            onClick={() => setShowClearDialog(true)}
          >
            Clear all
          </Button>
        </div>

        {/* max-h matches TRANSCRIPTION_UI.HISTORY_MAX_HEIGHT */}
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 scrollbar-thin">
          {history.map((item) => {
            const isExpanded = expandedId === item.id;
            const displayText =
              item.result.processed_text || item.result.raw_text;

            return (
              <div
                key={item.id}
                className={cn(
                  "group relative rounded-xl border transition-all duration-200",
                  isExpanded
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/60 hover:border-primary/30 hover:bg-muted/30"
                )}
              >
                {/* Header - always visible */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} transcription: ${item.sourceName}`}
                  className="flex items-center gap-3 p-3 cursor-pointer"
                  onClick={() => toggleExpanded(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleExpanded(item.id);
                    }
                  }}
                >
                  {/* Source icon */}
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                      item.source === "youtube"
                        ? "bg-red-500/10 ring-1 ring-red-500/20"
                        : "bg-blue-500/10 ring-1 ring-blue-500/20"
                    )}
                  >
                    {item.source === "youtube" ? (
                      <Youtube size={ICON_SIZES.md} className="text-red-500" />
                    ) : (
                      <FileAudio
                        size={ICON_SIZES.md}
                        className="text-blue-400"
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-[12px] font-medium truncate transition-colors",
                        isExpanded
                          ? "text-primary"
                          : "text-foreground group-hover:text-primary"
                      )}
                    >
                      {truncateString(
                        item.sourceName,
                        TRANSCRIPTION_UI.SOURCE_NAME_MAX_LENGTH
                      )}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 tabular-nums">
                        <Clock size={10} />
                        {formatDuration(item.result.duration_seconds)}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {item.result.word_count.toLocaleString()} words
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">
                        {formatRelativeDate(item.timestamp)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteItemId(item.id);
                      }}
                    >
                      <Trash2
                        size={ICON_SIZES.sm}
                        className="text-muted-foreground hover:text-destructive"
                      />
                    </Button>
                    {isExpanded ? (
                      <ChevronUp
                        size={ICON_SIZES.sm}
                        className="text-primary"
                      />
                    ) : (
                      <ChevronDown
                        size={ICON_SIZES.sm}
                        className="text-muted-foreground/50 group-hover:text-primary"
                      />
                    )}
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-border/60 p-3 space-y-3">
                    {/* Actions bar */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => handleCopy(displayText, item.id)}
                      >
                        {copiedId === item.id ? (
                          <>
                            <Check
                              size={ICON_SIZES.xs}
                              className="mr-1.5 text-green-500"
                            />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy size={ICON_SIZES.xs} className="mr-1.5" />
                            Copy
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() =>
                          handleDownload(displayText, item.sourceName)
                        }
                      >
                        <Download size={ICON_SIZES.xs} className="mr-1.5" />
                        Download
                      </Button>
                    </div>

                    {/* Transcript text */}
                    <div className="max-h-[200px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                      <p className="text-[12px] text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
                        {displayText}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete single item confirmation dialog */}
      <AlertDialog
        open={!!deleteItemId}
        onOpenChange={(open) => !open && setDeleteItemId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transcription?</AlertDialogTitle>
            <AlertDialogDescription>
              {itemToDelete && (
                <>
                  This will permanently delete the transcription for{" "}
                  <span className="font-medium text-foreground">
                    "{truncateString(itemToDelete.sourceName, 40)}"
                  </span>
                  . This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear all confirmation dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all history?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {history.length} transcription
              {history.length !== 1 ? "s" : ""} from your history. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
