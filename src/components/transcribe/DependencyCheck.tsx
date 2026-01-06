import { useState } from "react";
import { CheckCircle, XCircle, ChevronDown, ChevronUp, RefreshCw, ExternalLink, Download, Copy, Check } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { cn } from "@/lib/utils";
import { ICON_SIZES } from "@/lib/constants";
import { Button } from "../ui/button";
import { DependencyStatus } from "@/hooks/useTranscribe";

const YTDLP_INSTALL_URL = "https://github.com/yt-dlp/yt-dlp#installation";
const FFMPEG_INSTALL_URL = "https://ffmpeg.org/download.html";

interface DependencyCheckProps {
  dependencies: DependencyStatus | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export function DependencyCheck({
  dependencies,
  isLoading,
  onRefresh,
}: DependencyCheckProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<"mac" | "win" | null>(null);

  const getMissingDeps = () => {
    const missing = [];
    if (!dependencies?.yt_dlp_installed) missing.push("yt-dlp");
    if (!dependencies?.ffmpeg_installed) missing.push("ffmpeg");
    return missing.join(" ");
  };

  const handleCopyCommand = async (platform: "mac" | "win") => {
    const deps = getMissingDeps();
    const command = platform === "mac"
      ? `brew install ${deps}`
      : `winget install ${deps}`;

    try {
      await writeText(command);
      setCopiedCommand(platform);
      setTimeout(() => setCopiedCommand(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const allInstalled = dependencies?.yt_dlp_installed && dependencies?.ffmpeg_installed;
  const someInstalled = dependencies?.yt_dlp_installed || dependencies?.ffmpeg_installed;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-lg">
        <RefreshCw size={ICON_SIZES.sm} className="text-muted-foreground animate-spin" />
        <span className="text-[11px] text-muted-foreground">Checking dependencies...</span>
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-lg border transition-colors",
      allInstalled ? "border-green-500/20 bg-green-500/5" : "border-amber-500/20 bg-amber-500/5"
    )}>
      <Button
        variant="ghost"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full px-3 py-2 h-auto hover:bg-transparent"
      >
        <div className="flex items-center gap-2">
          {allInstalled ? (
            <CheckCircle size={ICON_SIZES.sm} className="text-green-500" />
          ) : (
            <XCircle size={ICON_SIZES.sm} className="text-amber-500" />
          )}
          <span className={cn(
            "text-[12px] font-medium",
            allInstalled ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
          )}>
            {allInstalled
              ? "All dependencies installed"
              : someInstalled
                ? "Some dependencies missing"
                : "Dependencies required"}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp size={ICON_SIZES.sm} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={ICON_SIZES.sm} className="text-muted-foreground" />
        )}
      </Button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {dependencies?.yt_dlp_installed ? (
                  <CheckCircle size={ICON_SIZES.xs} className="text-green-500" />
                ) : (
                  <XCircle size={ICON_SIZES.xs} className="text-destructive" />
                )}
                <span className="text-[11px] text-foreground">yt-dlp</span>
              </div>
              {dependencies?.yt_dlp_version && (
                <span className="text-[10px] text-muted-foreground">
                  {dependencies.yt_dlp_version}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {dependencies?.ffmpeg_installed ? (
                  <CheckCircle size={ICON_SIZES.xs} className="text-green-500" />
                ) : (
                  <XCircle size={ICON_SIZES.xs} className="text-destructive" />
                )}
                <span className="text-[11px] text-foreground">ffmpeg</span>
              </div>
              {dependencies?.ffmpeg_version && (
                <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                  {dependencies.ffmpeg_version.split(" ").slice(0, 3).join(" ")}
                </span>
              )}
            </div>
          </div>

          {!allInstalled && (
            <div className="pt-2 border-t border-border/50 space-y-2">
              <p className="text-[10px] text-muted-foreground">
                YouTube transcription requires these tools to be installed on your system:
              </p>

              {!dependencies?.yt_dlp_installed && (
                <Button
                  variant="ghost"
                  onClick={() => openUrl(YTDLP_INSTALL_URL)}
                  className="flex items-center justify-between w-full gap-2 bg-background/50 hover:bg-background rounded px-3 py-2 h-auto group"
                >
                  <div className="flex items-center gap-2">
                    <Download size={ICON_SIZES.sm} className="text-muted-foreground" />
                    <div className="text-left">
                      <p className="text-[11px] font-medium text-foreground">yt-dlp</p>
                      <p className="text-[10px] text-muted-foreground">Downloads audio from YouTube</p>
                    </div>
                  </div>
                  <ExternalLink size={ICON_SIZES.xs} className="text-muted-foreground group-hover:text-foreground" />
                </Button>
              )}

              {!dependencies?.ffmpeg_installed && (
                <Button
                  variant="ghost"
                  onClick={() => openUrl(FFMPEG_INSTALL_URL)}
                  className="flex items-center justify-between w-full gap-2 bg-background/50 hover:bg-background rounded px-3 py-2 h-auto group"
                >
                  <div className="flex items-center gap-2">
                    <Download size={ICON_SIZES.sm} className="text-muted-foreground" />
                    <div className="text-left">
                      <p className="text-[11px] font-medium text-foreground">ffmpeg</p>
                      <p className="text-[10px] text-muted-foreground">Processes audio/video files</p>
                    </div>
                  </div>
                  <ExternalLink size={ICON_SIZES.xs} className="text-muted-foreground group-hover:text-foreground" />
                </Button>
              )}

              <div className="pt-2 mt-2 border-t border-border/30 space-y-1.5">
                <p className="text-[10px] text-muted-foreground mb-2">
                  Quick install via terminal:
                </p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-muted-foreground flex-1">
                    <span className="font-medium">macOS:</span>{" "}
                    <code className="bg-background px-1 py-0.5 rounded text-[9px] font-mono">
                      brew install {getMissingDeps()}
                    </code>
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopyCommand("mac")}
                    className="h-6 w-6 hover:bg-background"
                    title="Copy command"
                  >
                    {copiedCommand === "mac" ? (
                      <Check size={12} className="text-green-500" />
                    ) : (
                      <Copy size={12} className="text-muted-foreground" />
                    )}
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-muted-foreground flex-1">
                    <span className="font-medium">Windows:</span>{" "}
                    <code className="bg-background px-1 py-0.5 rounded text-[9px] font-mono">
                      winget install {getMissingDeps()}
                    </code>
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopyCommand("win")}
                    className="h-6 w-6 hover:bg-background"
                    title="Copy command"
                  >
                    {copiedCommand === "win" ? (
                      <Check size={12} className="text-green-500" />
                    ) : (
                      <Copy size={12} className="text-muted-foreground" />
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-2 italic">
                  After installing, click Refresh below to verify.
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              className="h-7 text-[11px]"
            >
              <RefreshCw size={ICON_SIZES.xs} className="mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
