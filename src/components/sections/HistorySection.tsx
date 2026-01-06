import { Clock, Timer, RotateCcw, FileText, Mic } from "lucide-react";
import { ICON_SIZES } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { useStats, formatTimeSaved } from "@/hooks/useStats";
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

export function HistorySection() {
  const { stats, isLoading, resetStats } = useStats();

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

      {/* History List - Placeholder */}
      <Card className="flex-1 min-h-[300px] flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mb-4">
          <Clock size={ICON_SIZES.lg} className="text-muted-foreground" />
        </div>
        <h3 className="text-[13px] font-medium text-foreground mb-1">
          Coming Soon
        </h3>
        <p className="text-[11px] text-muted-foreground max-w-[280px]">
          View your transcription history, see costs, compare raw vs processed
          text, and retry transcriptions with different settings.
        </p>
      </Card>
    </SectionLayout>
  );
}
