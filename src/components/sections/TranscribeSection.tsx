import { useEffect, useRef } from "react";
import { Play, Loader2, Upload, Youtube, Sliders } from "lucide-react";
import { ICON_SIZES } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Select } from "../ui/select";
import { useTranscribe } from "@/hooks/useTranscribe";
import { useTranscriptionHistory } from "@/hooks/useTranscriptionHistory";
import { FileDropZone } from "../transcribe/FileDropZone";
import { YouTubeInput } from "../transcribe/YouTubeInput";
import { DependencyCheck } from "../transcribe/DependencyCheck";
import { TranscriptionResult } from "../transcribe/TranscriptionResult";
import { TranscriptionHistory } from "../transcribe/TranscriptionHistory";

const LANGUAGES = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "pl", label: "Polish" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
];

export function TranscribeSection() {
  const {
    // Dependencies
    dependencies,
    isCheckingDeps,
    checkDependencies,

    // Input
    selectedFile,
    selectedFilePath,
    youtubeUrl,
    inputType,
    handleFileSelect,
    handleYoutubeUrlChange,
    clearSelection,

    // Options
    applyRules,
    setApplyRules,
    language,
    setLanguage,

    // Progress
    isTranscribing,
    progress,

    // Result
    result,
    error,

    // Actions
    transcribe,
    canTranscribe,
    isYoutubeUrl,
  } = useTranscribe();

  const {
    history,
    addToHistory,
    removeFromHistory,
    clearHistory,
  } = useTranscriptionHistory();

  // Ref for scrolling to result
  const resultRef = useRef<HTMLDivElement>(null);

  // Save to history when we get a new result
  // Note: We intentionally only depend on result and isTranscribing to trigger this effect
  // once when transcription completes. Other values (inputType, youtubeUrl, etc.) are read
  // at trigger time and don't need to re-trigger the effect.
  useEffect(() => {
    if (result && !isTranscribing) {
      const source = inputType === "youtube" ? "youtube" : "file";
      const sourceName = inputType === "youtube"
        ? youtubeUrl
        : (selectedFile?.name || selectedFilePath || "Unknown file");

      addToHistory(source, sourceName, result);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, isTranscribing]);

  // Auto-scroll to result when transcription completes
  useEffect(() => {
    if (result && !isTranscribing && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result, isTranscribing]);

  const needsYouTubeDeps = inputType === "youtube";
  const youtubeReady = dependencies?.yt_dlp_installed && dependencies?.ffmpeg_installed;

  return (
    <SectionLayout
      title="Transcribe"
      description="Upload audio/video files or paste YouTube URLs for transcription"
    >
      {/* Dependencies Check */}
      <DependencyCheck
        dependencies={dependencies}
        isLoading={isCheckingDeps}
        onRefresh={checkDependencies}
      />

      {/* File Upload */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Upload size={ICON_SIZES.sm} className="text-blue-400" />
          </div>
          <h3 className="text-[13px] font-medium text-foreground">
            Upload File
          </h3>
        </div>
        <FileDropZone
          selectedFile={selectedFile}
          selectedFilePath={selectedFilePath}
          onFileSelect={handleFileSelect}
          onClear={clearSelection}
          disabled={isTranscribing}
        />
      </Card>

      {/* YouTube URL */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Youtube size={ICON_SIZES.sm} className="text-red-500" />
            </div>
            <h3 className="text-[13px] font-medium text-foreground">
              YouTube URL
            </h3>
          </div>
          {needsYouTubeDeps && !youtubeReady && (
            <span className="text-[10px] text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
              Requires yt-dlp & ffmpeg
            </span>
          )}
        </div>
        <YouTubeInput
          url={youtubeUrl}
          onUrlChange={handleYoutubeUrlChange}
          isValidUrl={isYoutubeUrl(youtubeUrl)}
          disabled={isTranscribing}
        />
      </Card>

      {/* Options */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sliders size={ICON_SIZES.sm} className="text-primary" />
          </div>
          <h3 className="text-[13px] font-medium text-foreground">
            Options
          </h3>
        </div>
        <div className="space-y-4">
          {/* Language */}
          <div className="flex items-center justify-between">
            <Label className="text-[12px] text-muted-foreground">
              Language
            </Label>
            <Select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isTranscribing}
              className="w-[140px] h-8 text-[12px]"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Apply Rules */}
          <div className="flex items-center justify-between">
            <Label className="text-[12px] text-muted-foreground">
              Apply transcription rules
            </Label>
            <Switch
              checked={applyRules}
              onCheckedChange={setApplyRules}
              disabled={isTranscribing}
            />
          </div>
        </div>
      </Card>

      {/* Progress / Error (shown above button during transcription) */}
      {(isTranscribing || error) && (
        <TranscriptionResult
          result={null}
          progress={progress}
          error={error}
          isTranscribing={isTranscribing}
          onNewTranscription={clearSelection}
          isViewingHistory={false}
          historySourceName={undefined}
        />
      )}

      {/* Transcribe Button */}
      <Button
        onClick={transcribe}
        disabled={!canTranscribe || isTranscribing || (needsYouTubeDeps && !youtubeReady)}
        className="w-full h-12 text-[14px] font-medium"
      >
        {isTranscribing ? (
          <>
            <Loader2 size={ICON_SIZES.md} className="mr-2 animate-spin" />
            Transcribing...
          </>
        ) : (
          <>
            <Play size={ICON_SIZES.md} className="mr-2" />
            Transcribe
          </>
        )}
      </Button>

      {/* Result (shown below button after completion) */}
      {!isTranscribing && !error && result && (
        <div ref={resultRef}>
          <TranscriptionResult
            result={result}
            progress={null}
            error={null}
            isTranscribing={false}
            onNewTranscription={clearSelection}
            isViewingHistory={false}
            historySourceName={undefined}
          />
        </div>
      )}

      {/* History - always show when there are items */}
      {history.length > 0 && (
        <Card className="p-4">
          <TranscriptionHistory
            history={history}
            onDelete={removeFromHistory}
            onClear={clearHistory}
          />
        </Card>
      )}
    </SectionLayout>
  );
}
