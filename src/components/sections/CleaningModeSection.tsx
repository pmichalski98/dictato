import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { Lock, AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CLEANING, ICON_SIZES, PLATFORMS } from "@/lib/constants";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";

export function CleaningModeSection() {
  const [isMac, setIsMac] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setIsMac(platform() === PLATFORMS.MACOS);
    } catch {
      setIsMac(false);
    }
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      await invoke("engage_cleaning_mode");
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to start Cleaning Mode");
    } finally {
      setStarting(false);
    }
  }, []);

  return (
    <SectionLayout
      title="Cleaning Mode"
      description="Block keyboard and trackpad so you can wipe your MacBook safely"
    >
      <Card className="p-5 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500/20 via-violet-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
            <Lock size={ICON_SIZES.md} className="text-primary" />
          </div>
          <div className="space-y-2 text-[13px] text-foreground">
            <p>
              When you start, a fullscreen lock appears after a {CLEANING.GRACE_SECONDS}-second grace
              countdown. All keyboard, mouse, trackpad, and scroll input is
              ignored system-wide — safe to wipe your keys and trackpad.
            </p>
            <p className="text-muted-foreground text-[12px]">
              To unlock, hold <kbd className="px-1 py-0.5 rounded bg-muted text-[11px]">⌘ Left</kbd>{" "}
              and <kbd className="px-1 py-0.5 rounded bg-muted text-[11px]">⌘ Right</kbd>{" "}
              for {CLEANING.UNLOCK_SECONDS} seconds.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <AlertTriangle size={ICON_SIZES.sm} className="shrink-0" />
          <span>
            Requires Accessibility permission. macOS will prompt the first time
            you enable this.
          </span>
        </div>

        {error && (
          <div className="text-[12px] text-destructive whitespace-pre-wrap">
            {error}
          </div>
        )}

        <div>
          <Button
            onClick={handleStart}
            disabled={!isMac || starting}
            variant="default"
          >
            {starting ? "Starting…" : "Start Cleaning Mode"}
          </Button>
          {!isMac && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Cleaning Mode is available on macOS only.
            </p>
          )}
        </div>
      </Card>
    </SectionLayout>
  );
}
