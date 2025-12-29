import { Button } from "./ui/button";

interface UpdateDialogProps {
  currentVersion: string;
  newVersion: string;
  isDownloading: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

export function UpdateDialog({
  currentVersion,
  newVersion,
  isDownloading,
  onUpdate,
  onDismiss,
}: UpdateDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-2xl p-6 w-[360px] shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-ring flex items-center justify-center">
            <svg
              className="w-5 h-5 text-primary-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Update Available
            </h2>
            <p className="text-sm text-muted-foreground">
              A new version is ready
            </p>
          </div>
        </div>

        <div className="bg-input border border-border rounded-xl p-4 mb-5">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Current</span>
            <span className="text-foreground font-mono">{currentVersion}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">New</span>
            <span className="text-primary font-mono font-medium">
              {newVersion}
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={onDismiss}
            disabled={isDownloading}
            className="flex-1"
          >
            Later
          </Button>
          <Button
            onClick={onUpdate}
            disabled={isDownloading}
            className="flex-1"
          >
            {isDownloading ? "Downloading..." : "Update Now"}
          </Button>
        </div>
      </div>
    </div>
  );
}
