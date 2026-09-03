import { Check, Download, HardDrive, Loader2, Trash2, X, Zap } from "lucide-react";
import { ICON_SIZES } from "@/lib/constants";
import { formatBytes } from "@/lib/formatters";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
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
import type { LocalModelsApi, LocalModelStatus } from "@/hooks/useLocalModels";
import type { LocalModelId, SttProvider } from "@/hooks/useSettings";

interface ModelsSectionProps {
  localModels: LocalModelsApi;
  sttProvider: SttProvider;
  onUpdateSttProvider: (provider: SttProvider) => Promise<void>;
}

type StatusTone = "green" | "amber" | "blue" | "muted";

function statusOf(
  model: LocalModelStatus,
  isSelected: boolean
): { label: string; tone: StatusTone; pulse: boolean } {
  if (model.downloading) return { label: "Downloading", tone: "blue", pulse: true };
  if (model.loading) return { label: "Loading into memory", tone: "blue", pulse: true };
  if (model.loaded) return { label: "Active", tone: "green", pulse: true };
  if (model.downloaded) {
    return isSelected
      ? { label: "Selected, not loaded", tone: "amber", pulse: false }
      : { label: "Downloaded", tone: "amber", pulse: false };
  }
  return { label: "Not downloaded", tone: "muted", pulse: false };
}

const TONE_CLASS: Record<StatusTone, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  muted: "bg-muted-foreground/40",
};

interface ModelCardProps {
  model: LocalModelStatus;
  isSelected: boolean;
  progress: LocalModelsApi["progress"][LocalModelId];
  error: string | undefined;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onSelect: () => void;
  onDownloadAccelerator: () => void;
  onRemoveAccelerator: () => void;
}

function AcceleratorRow({
  model,
  onDownload,
  onRemove,
}: {
  model: LocalModelStatus;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const acc = model.accelerator;
  if (!acc || model.downloading || !model.downloaded) return null;

  return (
    <div className="flex items-start justify-between gap-3 pt-3 border-t border-border/50">
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2">
          <Zap size={ICON_SIZES.xs} className="text-amber-400 shrink-0" />
          <span className="text-[12px] font-medium text-foreground">{acc.name}</span>
          {acc.installed && (
            <span className="text-[10px] text-muted-foreground">
              {acc.active ? "· active" : model.loading ? "· compiling…" : "· installed"}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{acc.description}</p>
      </div>
      {acc.installed ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={model.loading}
          className="text-[11px] text-muted-foreground hover:text-destructive shrink-0"
        >
          <Trash2 size={ICON_SIZES.xs} className="mr-1" />
          Remove
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={onDownload} className="shrink-0">
          <Download size={ICON_SIZES.xs} className="mr-1" />
          Add ({formatBytes(acc.sizeBytes)})
        </Button>
      )}
    </div>
  );
}

function ModelCard({
  model,
  isSelected,
  progress,
  error,
  onDownload,
  onCancel,
  onDelete,
  onSelect,
  onDownloadAccelerator,
  onRemoveAccelerator,
}: ModelCardProps) {
  const status = statusOf(model, isSelected);

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <HardDrive size={ICON_SIZES.sm} className="text-muted-foreground shrink-0" />
            <Label className="text-[13px] text-foreground">{model.name}</Label>
          </div>
          <p className="text-[11px] text-muted-foreground">{model.description}</p>
          <p className="text-[10px] text-muted-foreground/80">
            {model.languages} · {formatBytes(model.sizeBytes)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-md bg-muted/30 border border-border/50">
          <div
            className={`w-1.5 h-1.5 rounded-full ${TONE_CLASS[status.tone]} ${
              status.pulse ? "animate-pulse" : ""
            }`}
          />
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {status.label}
          </span>
        </div>
      </div>

      {model.downloading && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              {progress
                ? `Downloading file ${progress.fileIndex}/${progress.fileCount}`
                : "Starting download..."}
            </span>
            <span className="text-foreground font-medium">
              {progress ? `${progress.percent.toFixed(0)}%` : ""}
            </span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress?.percent ?? 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              {progress && progress.totalBytes > 0
                ? `${formatBytes(progress.bytesDownloaded)} / ${formatBytes(progress.totalBytes)}`
                : ""}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="text-[11px] text-muted-foreground hover:text-destructive"
            >
              <X size={ICON_SIZES.xs} className="mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!model.downloading && !model.downloaded && (
        <Button onClick={onDownload} className="w-full">
          <Download size={ICON_SIZES.sm} className="mr-1.5" />
          Download ({formatBytes(model.sizeBytes)})
        </Button>
      )}

      {!model.downloading && model.downloaded && (
        <div className="flex items-center justify-between gap-2">
          {isSelected ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Check size={ICON_SIZES.xs} className="text-green-500" />
              Used for dictation
            </span>
          ) : (
            <Button variant="secondary" size="sm" onClick={onSelect}>
              Use for dictation
            </Button>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={model.loading}
                className="text-[11px] text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={ICON_SIZES.xs} className="mr-1" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {model.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes {formatBytes(model.diskBytes)} from disk.
                  {isSelected
                    ? " It is your current dictation model, so recording will stop working until you pick another provider or download it again."
                    : " You can download it again at any time."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <AcceleratorRow
        model={model}
        onDownload={onDownloadAccelerator}
        onRemove={onRemoveAccelerator}
      />

      {error && (
        <div className="space-y-2">
          <p className="text-[11px] text-destructive">{error}</p>
          {!model.downloaded && !model.downloading && (
            <Button onClick={onDownload} variant="default" size="sm">
              Retry Download
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export function ModelsSection({
  localModels,
  sttProvider,
  onUpdateSttProvider,
}: ModelsSectionProps) {
  const {
    models,
    progress,
    errors,
    download,
    downloadAccelerator,
    removeAccelerator,
    cancel,
    remove,
  } = localModels;
  const diskTotal = models.reduce((sum, m) => sum + m.diskBytes, 0);
  const downloadedCount = models.filter((m) => m.downloaded).length;

  return (
    <SectionLayout
      title="Models"
      description="Download and manage local speech-to-text models"
    >
      <Card className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Label>Local models</Label>
          <p className="text-[11px] text-muted-foreground">
            Models run fully on this machine. Only the model selected under
            General is kept in memory.
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[13px] font-medium text-foreground">
            {formatBytes(diskTotal)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {downloadedCount} of {models.length} on disk
          </p>
        </div>
      </Card>

      {models.length === 0 && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-1">
          <Loader2 size={ICON_SIZES.sm} className="animate-spin" />
          Checking model status...
        </div>
      )}

      {models.map((model) => (
        <ModelCard
          key={model.id}
          model={model}
          isSelected={sttProvider === model.id}
          progress={progress[model.id]}
          error={errors[model.id]}
          onDownload={() => download(model.id)}
          onCancel={() => cancel(model.id)}
          onDelete={() => remove(model.id)}
          onSelect={() => onUpdateSttProvider(model.id)}
          onDownloadAccelerator={() => downloadAccelerator(model.id)}
          onRemoveAccelerator={() => removeAccelerator(model.id)}
        />
      ))}
    </SectionLayout>
  );
}
