import { useState, useCallback, useRef } from "react";
import { Upload, X, FileAudio, FileVideo, CheckCircle2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { ICON_SIZES, SUPPORTED_VIDEO_FORMATS, ALL_SUPPORTED_FORMATS } from "@/lib/constants";
import { Button } from "../ui/button";

interface FileDropZoneProps {
  selectedFile: File | null;
  selectedFilePath: string | null;
  onFileSelect: (file: File, path: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function FileDropZone({
  selectedFile,
  selectedFilePath,
  onFileSelect,
  onClear,
  disabled,
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const isVideoFile = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    return ext ? (SUPPORTED_VIDEO_FORMATS as readonly string[]).includes(ext) : false;
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    const validFile = files.find((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      return ext && (ALL_SUPPORTED_FORMATS as readonly string[]).includes(ext);
    });

    if (validFile) {
      // Get the file path - in browser context we use file.name as the path
      // The actual file path is handled by Tauri's dialog when using the browse button
      // For drag-drop, the file name serves as an identifier
      const path = validFile.name;
      onFileSelect(validFile, path);
    }
  }, [disabled, onFileSelect]);

  const handleBrowse = useCallback(async () => {
    if (disabled) return;

    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: "Audio/Video",
          extensions: [...ALL_SUPPORTED_FORMATS],
        }],
      });

      if (selected && typeof selected === "string") {
        const fileName = selected.split("/").pop() || "file";
        const file = new File([], fileName);
        onFileSelect(file, selected);
      }
    } catch (err) {
      console.error("Failed to open file dialog:", err);
    }
  }, [disabled, onFileSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return;
    // Allow activation via Enter or Space key for accessibility
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleBrowse();
    }
  }, [disabled, handleBrowse]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  if (selectedFile && selectedFilePath) {
    const isVideo = isVideoFile(selectedFile.name || selectedFilePath);
    const Icon = isVideo ? FileVideo : FileAudio;

    return (
      <div className="relative overflow-hidden rounded-lg border border-primary/30 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5">
        {/* Subtle gradient accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-pink-400 via-violet-400 to-blue-400 opacity-60" />

        <div className="flex items-center gap-3 p-4">
          <div className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center shadow-sm",
            isVideo
              ? "bg-gradient-to-br from-violet-500/20 to-violet-600/10 ring-1 ring-violet-500/20"
              : "bg-gradient-to-br from-blue-500/20 to-blue-600/10 ring-1 ring-blue-500/20"
          )}>
            <Icon size={ICON_SIZES.lg} className={cn(
              isVideo ? "text-violet-400" : "text-blue-400"
            )} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-medium text-foreground truncate">
                {selectedFile.name || selectedFilePath.split("/").pop()}
              </p>
              <CheckCircle2 size={ICON_SIZES.sm} className="text-green-500 shrink-0" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {selectedFile.size > 0 ? formatFileSize(selectedFile.size) : "Ready to transcribe"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            onClick={onClear}
            disabled={disabled}
          >
            <X size={ICON_SIZES.md} />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={dropZoneRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Drop audio or video file here, or click to browse"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative overflow-hidden border-2 border-dashed rounded-xl p-8 transition-all duration-200 cursor-pointer group",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background",
        isDragging
          ? "border-primary bg-gradient-to-br from-primary/10 via-primary/5 to-secondary/10 scale-[1.01]"
          : "border-border/60 hover:border-primary/40 hover:bg-muted/20",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={handleBrowse}
    >
      {/* Subtle background pattern on hover */}
      <div className={cn(
        "absolute inset-0 opacity-0 transition-opacity duration-300",
        "bg-[radial-gradient(circle_at_50%_50%,rgba(139,92,246,0.03)_0%,transparent_50%)]",
        !disabled && "group-hover:opacity-100",
        isDragging && "opacity-100"
      )} />

      <div className="relative flex flex-col items-center gap-3 text-center">
        <div className={cn(
          "w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-200",
          isDragging
            ? "bg-gradient-to-br from-primary/20 to-secondary/20 ring-2 ring-primary/30 scale-110"
            : "bg-muted/40 group-hover:bg-muted/60 group-hover:ring-1 group-hover:ring-primary/20"
        )}>
          <Upload size={ICON_SIZES.lg} className={cn(
            "transition-colors duration-200",
            isDragging ? "text-primary" : "text-muted-foreground group-hover:text-primary/70"
          )} />
        </div>
        <div>
          <p className={cn(
            "text-[13px] font-medium transition-colors",
            isDragging ? "text-primary" : "text-foreground"
          )}>
            {isDragging ? "Release to upload" : "Drop audio or video file here"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            or click to browse
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5 max-w-[280px]">
          {["MP3", "WAV", "M4A", "MP4", "MOV"].map((format) => (
            <span
              key={format}
              className="px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground/60 bg-muted/30 rounded"
            >
              {format}
            </span>
          ))}
          <span className="px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground/60 bg-muted/30 rounded">
            +{ALL_SUPPORTED_FORMATS.length - 5} more
          </span>
        </div>
      </div>
    </div>
  );
}
