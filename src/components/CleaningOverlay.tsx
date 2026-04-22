import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Lock } from "lucide-react";
import { CLEANING, EVENTS } from "@/lib/constants";

type Phase = "grace" | "locked";

const RING_SIZE = 180;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function CleaningOverlay() {
  const [phase, setPhase] = useState<Phase>("grace");
  const [graceProgress, setGraceProgress] = useState(0);
  const [unlockProgress, setUnlockProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let errorCloseTimer: ReturnType<typeof setTimeout> | null = null;

    const unlistenGrace = listen<number>(EVENTS.CLEANING_GRACE_PROGRESS, (e) => {
      setGraceProgress(e.payload);
    });

    const unlistenLock = listen<boolean>(EVENTS.KEYBOARD_LOCK_CHANGED, (e) => {
      if (e.payload) {
        setPhase("locked");
        setUnlockProgress(0);
      } else {
        // Unlock complete — close overlay.
        invoke("close_cleaning_overlay").catch(() => {});
      }
    });

    const unlistenProgress = listen<number>(EVENTS.KEYBOARD_UNLOCK_PROGRESS, (e) => {
      setUnlockProgress(e.payload);
    });

    const unlistenError = listen<string>(EVENTS.CLEANING_MODE_ERROR, (e) => {
      setError(e.payload);
      errorCloseTimer = setTimeout(() => {
        invoke("close_cleaning_overlay").catch(() => {});
      }, CLEANING.ERROR_AUTO_CLOSE_MS);
    });

    return () => {
      if (errorCloseTimer !== null) clearTimeout(errorCloseTimer);
      unlistenGrace.then((fn) => fn());
      unlistenLock.then((fn) => fn());
      unlistenProgress.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, []);

  const graceRemaining = Math.max(
    1,
    Math.ceil((1 - graceProgress / 100) * CLEANING.GRACE_SECONDS),
  );
  const dashOffset =
    RING_CIRCUMFERENCE - (unlockProgress / 100) * RING_CIRCUMFERENCE;

  return (
    <div className="fixed inset-0 bg-background/95 backdrop-blur-xl flex items-center justify-center select-none">
      <div className="flex flex-col items-center gap-8 text-center px-8">
        {error ? (
          <>
            <div className="w-20 h-20 rounded-full bg-destructive/20 flex items-center justify-center">
              <Lock size={40} className="text-destructive" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-foreground mb-2">
                Couldn't Start Cleaning Mode
              </h1>
              <p className="text-[14px] text-muted-foreground max-w-md whitespace-pre-wrap">
                {error}
              </p>
            </div>
          </>
        ) : phase === "grace" ? (
          <>
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-pink-500/30 via-violet-500/30 to-blue-500/30 flex items-center justify-center">
              <Lock size={40} className="text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-semibold text-foreground mb-3">
                Starting in {graceRemaining}…
              </h1>
              <p className="text-[15px] text-muted-foreground max-w-md">
                Lift your hands. In a moment all keyboard and trackpad input
                will be blocked so you can wipe the surface.
              </p>
            </div>
            <div className="w-64 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pink-400 via-violet-400 to-blue-400 transition-[width] duration-75"
                style={{ width: `${graceProgress}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
              <svg
                width={RING_SIZE}
                height={RING_SIZE}
                className="-rotate-90"
              >
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  stroke="currentColor"
                  strokeWidth={RING_STROKE}
                  fill="none"
                  className="text-muted/40"
                />
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  stroke="url(#cleaning-ring-gradient)"
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={dashOffset}
                  style={{ transition: "stroke-dashoffset 80ms linear" }}
                />
                <defs>
                  <linearGradient
                    id="cleaning-ring-gradient"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor="#f472b6" />
                    <stop offset="50%" stopColor="#a78bfa" />
                    <stop offset="100%" stopColor="#60a5fa" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <Lock size={52} className="text-foreground" />
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-foreground mb-3">
                Keyboard &amp; Trackpad Locked
              </h1>
              <p className="text-[15px] text-muted-foreground max-w-md">
                Hold{" "}
                <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[13px]">
                  ⌘ Left
                </kbd>{" "}
                and{" "}
                <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[13px]">
                  ⌘ Right
                </kbd>{" "}
                together for {CLEANING.UNLOCK_SECONDS} seconds to unlock.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
