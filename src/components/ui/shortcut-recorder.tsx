import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MODIFIER_KEYS } from "@/lib/shortcuts";
import { STATUS_RESET_DELAY_MS } from "@/lib/constants";

const MODIFIER_DISPLAY: Record<string, string> = {
  CommandOrControl: "⌘",
  Alt: "⌥",
  Shift: "⇧",
};

const MODIFIER_ORDER = ["CommandOrControl", "Alt", "Shift"] as const;

const KEY_DISPLAY: Record<string, string> = {
  " ": "Space",
  Space: "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "⌦",
  Enter: "↵",
  Tab: "⇥",
};

const COMMIT_FLASH_MS = 150;
const EMPTY_ALLOW_LIST: string[] = [];

function getKeyDisplay(key: string): string {
  if (KEY_DISPLAY[key]) return KEY_DISPLAY[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function KeyBadge({
  children,
  variant = "default",
  animate = false,
}: {
  children: React.ReactNode;
  variant?: "default" | "modifier-active" | "key-active";
  animate?: boolean;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center min-w-[26px] h-[26px] px-2 rounded-md text-[12px] font-semibold font-mono transition-all duration-150",
        variant === "default" &&
          "bg-background/60 border border-border/60 text-foreground/80 shadow-[0_1px_0_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.04)]",
        variant === "modifier-active" &&
          "bg-secondary/20 border border-secondary/40 text-secondary shadow-[0_1px_0_0_rgba(236,72,153,0.15),inset_0_1px_0_0_rgba(255,255,255,0.04)] scale-105",
        variant === "key-active" &&
          "bg-primary/20 border border-primary/40 text-primary shadow-[0_1px_0_0_rgba(139,92,246,0.15),inset_0_1px_0_0_rgba(255,255,255,0.04)] scale-105",
        animate && "animate-fade-in",
      )}
    >
      {children}
    </kbd>
  );
}

function PlusSeparator() {
  return (
    <span className="text-muted-foreground/30 text-[11px] font-bold select-none mx-0.5">
      +
    </span>
  );
}

interface ShortcutRecorderProps {
  value: string;
  onChange: (shortcut: string) => void;
  onCaptureStart?: () => void;
  onCaptureEnd?: () => void;
  error?: string | null;
  allowSingleKey?: boolean;
  singleKeyAllowList?: string[];
  placeholder?: string;
}

export function ShortcutRecorder({
  value,
  onChange,
  onCaptureStart,
  onCaptureEnd,
  error,
  allowSingleKey = false,
  singleKeyAllowList = EMPTY_ALLOW_LIST,
  placeholder = "Click to record shortcut",
}: ShortcutRecorderProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [heldModifiers, setHeldModifiers] = useState<Set<string>>(new Set());
  const [heldMainKey, setHeldMainKey] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
  }, []);

  const showHint = useCallback((msg: string) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHint(msg);
    hintTimer.current = setTimeout(() => setHint(null), STATUS_RESET_DELAY_MS);
  }, []);

  const startCapture = useCallback(() => {
    setIsCapturing(true);
    setHeldModifiers(new Set());
    setHeldMainKey(null);
    setHint(null);
    onCaptureStart?.();
    requestAnimationFrame(() => containerRef.current?.focus());
  }, [onCaptureStart]);

  const stopCapture = useCallback(() => {
    setIsCapturing(false);
    setHeldModifiers(new Set());
    setHeldMainKey(null);
    onCaptureEnd?.();
  }, [onCaptureEnd]);

  // Click-outside to cancel
  useEffect(() => {
    if (!isCapturing) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        stopCapture();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isCapturing, stopCapture]);

  /** Commit a shortcut after a brief visual flash */
  const commitShortcut = useCallback(
    (shortcutString: string) => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => {
        onChange(shortcutString);
        setIsCapturing(false);
        setHeldModifiers(new Set());
        setHeldMainKey(null);
        onCaptureEnd?.();
        commitTimer.current = null;
      }, COMMIT_FLASH_MS);
    },
    [onChange, onCaptureEnd]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isCapturing) return;
      e.preventDefault();
      e.stopPropagation();

      const mods = new Set<string>();
      if (e.metaKey || e.ctrlKey) mods.add("CommandOrControl");
      if (e.altKey) mods.add("Alt");
      if (e.shiftKey) mods.add("Shift");

      const key = e.key;
      const isModifier = MODIFIER_KEYS.includes(key as typeof MODIFIER_KEYS[number]);

      if (isModifier) {
        setHeldModifiers(mods);
        setHeldMainKey(null);
        return;
      }

      // Normalize main key
      let mainKey: string;
      if (key.length === 1 && key !== " ") {
        mainKey = key.toUpperCase();
      } else if (key === " ") {
        mainKey = "Space";
      } else {
        mainKey = key;
      }

      // Show all keys immediately
      setHeldModifiers(mods);
      setHeldMainKey(mainKey);

      // Single-key exception (e.g. Escape for cancel shortcut)
      if (mods.size === 0) {
        if (allowSingleKey && singleKeyAllowList.includes(mainKey)) {
          commitShortcut(mainKey);
          return;
        }
        showHint("Hold ⌘, ⌥, or ⇧ first, then press a key");
        return;
      }

      // Build and commit shortcut string
      const parts: string[] = [];
      for (const mod of MODIFIER_ORDER) {
        if (mods.has(mod)) parts.push(mod);
      }
      parts.push(mainKey);
      commitShortcut(parts.join("+"));
    },
    [isCapturing, allowSingleKey, singleKeyAllowList, commitShortcut, showHint]
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isCapturing) return;
      e.preventDefault();

      const mods = new Set<string>();
      if (e.metaKey || e.ctrlKey) mods.add("CommandOrControl");
      if (e.altKey) mods.add("Alt");
      if (e.shiftKey) mods.add("Shift");

      const released = e.key;
      if (released === "Meta" || released === "Control") mods.delete("CommandOrControl");
      if (released === "Alt") mods.delete("Alt");
      if (released === "Shift") mods.delete("Shift");

      setHeldModifiers(mods);
      if (mods.size === 0) setHeldMainKey(null);
    },
    [isCapturing]
  );

  // -- Derive display data --

  const storedKeys = value
    ? value.split("+").map((part) => ({
        isModifier: part in MODIFIER_DISPLAY,
        display: MODIFIER_DISPLAY[part] ?? getKeyDisplay(part),
      }))
    : [];

  const liveKeys: Array<{ isModifier: boolean; display: string }> = [];
  for (const mod of MODIFIER_ORDER) {
    if (heldModifiers.has(mod)) {
      liveKeys.push({ isModifier: true, display: MODIFIER_DISPLAY[mod] });
    }
  }
  if (heldMainKey) {
    liveKeys.push({ isModifier: false, display: getKeyDisplay(heldMainKey) });
  }

  const hasLiveKeys = isCapturing && liveKeys.length > 0;
  const waitingForMainKey = isCapturing && heldModifiers.size > 0 && !heldMainKey;
  const showStored = !isCapturing && storedKeys.length > 0;

  return (
    <div className="space-y-1.5">
      <div
        ref={containerRef}
        tabIndex={0}
        role="button"
        aria-label={
          isCapturing
            ? waitingForMainKey
              ? "Recording shortcut — modifiers held, now press a key"
              : "Recording shortcut — press your key combination"
            : `Shortcut: ${value || "none"}. Click to change.`
        }
        onClick={() => {
          if (!isCapturing) startCapture();
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={() => {
          if (isCapturing) stopCapture();
        }}
        className={cn(
          "relative flex items-center min-h-[38px] px-3 rounded-lg border transition-all duration-200 cursor-pointer select-none outline-none",
          !isCapturing && !error && "bg-input border-border hover:border-muted-foreground/30",
          isCapturing && !error && "bg-input border-secondary/60 shadow-[0_0_0_1px_rgba(236,72,153,0.1),0_0_16px_-4px_rgba(236,72,153,0.15)] animate-pulse-border",
          error && "bg-destructive/5 border-destructive/40",
          "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30",
        )}
      >
        {/* Idle: show stored shortcut */}
        {showStored && (
          <div className="flex items-center">
            {storedKeys.map((key, i) => (
              <span key={i} className="flex items-center">
                {i > 0 && <PlusSeparator />}
                <KeyBadge>{key.display}</KeyBadge>
              </span>
            ))}
          </div>
        )}

        {/* Capturing: show live keys as they're pressed */}
        {hasLiveKeys && (
          <div className="flex items-center">
            {liveKeys.map((key, i) => (
              <span key={`${key.display}-${i}`} className="flex items-center">
                {i > 0 && <PlusSeparator />}
                <KeyBadge
                  variant={key.isModifier ? "modifier-active" : "key-active"}
                  animate
                >
                  {key.display}
                </KeyBadge>
              </span>
            ))}
            {waitingForMainKey && (
              <span className="text-muted-foreground/40 text-[11px] ml-1.5 animate-pulse">
                now press a key...
              </span>
            )}
          </div>
        )}

        {/* Empty / prompt state */}
        {!showStored && !hasLiveKeys && (
          <span
            className={cn(
              "text-[12px]",
              isCapturing ? "text-secondary/60 animate-pulse" : "text-muted-foreground/50",
            )}
          >
            {isCapturing ? "Press your key combination..." : placeholder}
          </span>
        )}

        {/* Right side */}
        <div className="ml-auto pl-3 flex items-center shrink-0">
          {isCapturing ? (
            <div className="flex items-center gap-1.5">
              <div className="w-[5px] h-[5px] rounded-full bg-secondary animate-pulse" />
              <span className="text-[10px] text-secondary/60 font-semibold uppercase tracking-widest">
                rec
              </span>
            </div>
          ) : showStored ? (
            <span className="text-[10px] text-muted-foreground/30">click to change</span>
          ) : null}
        </div>
      </div>

      {/* Hint (e.g. "hold a modifier first") */}
      {hint && !error && (
        <p className="text-[11px] text-muted-foreground animate-fade-in">{hint}</p>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-destructive/10 border border-destructive/20 rounded-md animate-fade-in">
          <div className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse shrink-0" />
          <span className="text-[11px] text-destructive-foreground font-medium">{error}</span>
        </div>
      )}
    </div>
  );
}
