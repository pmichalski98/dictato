import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { formatShortcut } from "@/lib/shortcuts";
import { CheckIcon, GearIcon } from "@/components/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TranscriptionRule, DEFAULT_MODES } from "@/hooks/useSettings";
import { invoke } from "@tauri-apps/api/core";

const store = new LazyStore("settings.json");

// Audio visualization constants
const BAR_COUNT = 48;
const MIN_BAR_HEIGHT = 3;
const MAX_BAR_HEIGHT = 48;

// Audio level processing constants
const NOISE_THRESHOLD = 0.015; // Below this level, treat as silence
const AMPLIFICATION_FACTOR = 6.0; // Boost audio levels for better visualization

// Wave shape constants for organic visualization
const WAVE_BASE = 0.85; // Base wave amplitude
const WAVE_VARIATION = 0.15; // Wave variation range
const WAVE_FREQUENCY = 3; // Number of wave cycles across bars
const LEVEL_PHASE_FACTOR = 2; // How much audio level affects wave phase

// Random variation for organic feel
const RANDOM_BASE = 0.92; // Minimum random factor
const RANDOM_RANGE = 0.16; // Random variation range

// Store keys (should match backend)
const STORE_KEYS = {
  SKIP_RULES_ONCE: "skipRulesOnce",
  TRANSCRIPTION_RULES: "transcriptionRules",
  CANCEL_SHORTCUT: "cancelShortcut",
  SHORTCUT: "shortcut",
  ACTIVE_MODE: "activeMode",
} as const;

export function FloatingWindow() {
  const [isActive, setIsActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("Transcribing...");
  const [error, setError] = useState<string | null>(null);
  const [cancelShortcut, setCancelShortcut] = useState("Escape");
  const [recordingShortcut, setRecordingShortcut] =
    useState("Ctrl+Shift+Space");
  const [barHeights, setBarHeights] = useState<number[]>(
    Array(BAR_COUNT).fill(MIN_BAR_HEIGHT)
  );
  const [skipRules, setSkipRules] = useState(false);
  const [hasEnabledRules, setHasEnabledRules] = useState(false);
  const [activeMode, setActiveMode] = useState("none");

  // Ref to store previous bar heights for smooth animation
  const prevBarHeightsRef = useRef<number[]>(
    Array(BAR_COUNT).fill(MIN_BAR_HEIGHT)
  );

  // Update bars based on audio level from native capture
  const updateBarsFromLevel = useCallback((level: number) => {
    // Noise gate - ignore very low levels (ambient noise)
    if (level < NOISE_THRESHOLD) {
      setBarHeights(Array(BAR_COUNT).fill(MIN_BAR_HEIGHT));
      return;
    }

    // Amplify the level above threshold
    const adjustedLevel = (level - NOISE_THRESHOLD) / (1 - NOISE_THRESHOLD);
    const amplifiedLevel = Math.min(1.0, Math.sqrt(adjustedLevel) * AMPLIFICATION_FACTOR);

    // Create organic wave shape like the icon - high in middle, low on edges
    const newHeights = Array.from({ length: BAR_COUNT }, (_, i) => {
      // Normalize position to 0-1
      const t = i / (BAR_COUNT - 1);

      // Bell curve envelope - ensures edges are always low
      const envelope = Math.sin(t * Math.PI);
      // Squared for steeper falloff at edges
      const envelopeStrong = envelope * envelope;

      // Add subtle wave variation within the envelope
      const waveModulation =
        WAVE_BASE +
        WAVE_VARIATION * Math.sin(t * Math.PI * WAVE_FREQUENCY + amplifiedLevel * LEVEL_PHASE_FACTOR);

      // Combine envelope with variation
      const waveEffect = envelopeStrong * waveModulation;

      // Subtle randomness for organic feel
      const randomFactor = RANDOM_BASE + Math.random() * RANDOM_RANGE;

      return (
        MIN_BAR_HEIGHT +
        amplifiedLevel * waveEffect * randomFactor * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT)
      );
    });

    setBarHeights(newHeights);
  }, []);

  const resetBars = useCallback(() => {
    prevBarHeightsRef.current = Array(BAR_COUNT).fill(MIN_BAR_HEIGHT);
    setBarHeights(Array(BAR_COUNT).fill(MIN_BAR_HEIGHT));
  }, []);

  const loadModeAndRules = useCallback(async () => {
    try {
      const savedMode = await store.get<string>(STORE_KEYS.ACTIVE_MODE);
      if (savedMode) {
        setActiveMode(savedMode);
      }
      const rulesJson = await store.get<string>(STORE_KEYS.TRANSCRIPTION_RULES);
      if (rulesJson) {
        const parsedRules: TranscriptionRule[] = JSON.parse(rulesJson);
        const hasEnabled = parsedRules.some((r) => r.enabled);
        setHasEnabledRules(hasEnabled);
      }
    } catch (err) {
      console.error("Failed to load mode/rules:", err);
    }
  }, []);

  const setRulesMode = useCallback(async (skip: boolean) => {
    setSkipRules(skip);
    try {
      await store.set(STORE_KEYS.SKIP_RULES_ONCE, skip ? "true" : "false");
    } catch (err) {
      console.error("Failed to save skip rules:", err);
    }
  }, []);

  const updateActiveMode = useCallback(async (modeId: string) => {
    setActiveMode(modeId);
    try {
      await store.set(STORE_KEYS.ACTIVE_MODE, modeId);
    } catch (err) {
      console.error("Failed to save active mode:", err);
    }
  }, []);

  useEffect(() => {
    console.log("[FloatingWindow] Setting up event listeners");
    const unlistenExpanded = listen<boolean>(
      "floating-expanded",
      async (event) => {
        console.log("[FloatingWindow] floating-expanded event:", event.payload);
        setIsActive(event.payload);
        if (event.payload) {
          setError(null);
          setIsProcessing(false);
          setSkipRules(false);
          await store.set(STORE_KEYS.SKIP_RULES_ONCE, "false");
          const savedCancelShortcut = await store.get<string>(
            STORE_KEYS.CANCEL_SHORTCUT
          );
          const savedRecordingShortcut = await store.get<string>(
            STORE_KEYS.SHORTCUT
          );
          if (savedCancelShortcut) {
            setCancelShortcut(savedCancelShortcut);
          }
          if (savedRecordingShortcut) {
            setRecordingShortcut(savedRecordingShortcut);
          }
          loadModeAndRules();
          // Audio capture is now handled natively in Rust
        } else {
          resetBars();
          setIsProcessing(false);
        }
      }
    );

    // Listen for audio levels from native capture
    const unlistenAudioLevel = listen<number>("audio-level", (event) => {
      updateBarsFromLevel(event.payload);
    });

    const unlistenError = listen<string>("transcription-error", (event) => {
      setError(event.payload);
    });

    const unlistenProcessing = listen<boolean>("processing-state", (event) => {
      setIsProcessing(event.payload);
      if (event.payload) {
        setProcessingMessage("Transcribing...");
      }
    });

    const unlistenProcessingMessage = listen<string>(
      "processing-message",
      (event) => {
        setProcessingMessage(event.payload);
      }
    );

    return () => {
      resetBars();
      unlistenExpanded.then((fn) => fn());
      unlistenAudioLevel.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenProcessing.then((fn) => fn());
      unlistenProcessingMessage.then((fn) => fn());
    };
  }, [loadModeAndRules, updateBarsFromLevel, resetBars]);

  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }
    try {
      await getCurrentWindow().startDragging();
      const position = await getCurrentWindow().outerPosition();
      await invoke("save_floating_position", {
        x: position.x,
        y: position.y,
      });
    } catch (err) {
      console.error("Failed to drag window:", err);
    }
  }, []);

  console.log("[FloatingWindow] Render - isActive:", isActive, "activeMode:", activeMode);

  if (!isActive) {
    return null;
  }

  return (
    <div className="w-full h-full flex items-start justify-center bg-transparent select-none overflow-hidden">
      <div
        className="flex flex-col items-center gap-2 px-5 py-3 bg-linear-to-b from-zinc-800/95 to-zinc-900/95 rounded-2xl shadow-2xl shadow-black/50 backdrop-blur-xl animate-fade-in cursor-move"
        onMouseDown={handleDragStart}
      >
        {/* Main status area */}
        <div className="flex items-center justify-center min-h-[36px] gap-3">
          {/* Options dropdown - show mode selector */}
          {!isProcessing && !error && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`
                    flex items-center justify-center px-2.5 h-8 rounded-lg transition-all duration-200 gap-1.5
                    ${
                      activeMode !== "none"
                        ? "bg-violet-500/30 text-violet-300"
                        : hasEnabledRules && !skipRules
                          ? "bg-blue-500/30 text-blue-300"
                          : "bg-zinc-600/30 text-zinc-400"
                    }
                  `}
                  title="Transformation mode"
                >
                  <GearIcon />
                  <span className="text-xs font-medium">
                    {DEFAULT_MODES.find((m) => m.id === activeMode)?.name ?? "None"}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom">
                <DropdownMenuLabel>Mode</DropdownMenuLabel>
                {DEFAULT_MODES.map((mode) => (
                  <DropdownMenuItem
                    key={mode.id}
                    onClick={() => updateActiveMode(mode.id)}
                    className={
                      activeMode === mode.id ? "bg-violet-500/20 text-violet-300" : ""
                    }
                  >
                    {activeMode === mode.id && <CheckIcon />}
                    <span className={activeMode === mode.id ? "" : "ml-5"}>
                      {mode.name}
                    </span>
                  </DropdownMenuItem>
                ))}
                {activeMode === "none" && hasEnabledRules && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Rules</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => setRulesMode(false)}
                      className={
                        !skipRules ? "bg-blue-500/20 text-blue-300" : ""
                      }
                    >
                      {!skipRules && <CheckIcon />}
                      <span className={!skipRules ? "" : "ml-5"}>
                        Apply rules
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setRulesMode(true)}
                      className={
                        skipRules ? "bg-orange-500/20 text-orange-300" : ""
                      }
                    >
                      {skipRules && <CheckIcon />}
                      <span className={skipRules ? "" : "ml-5"}>Skip rules</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {isProcessing ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
              <span className="text-sm text-white/70 font-medium">
                {processingMessage}
              </span>
            </div>
          ) : error ? (
            <span className="text-sm text-red-400 font-medium">{error}</span>
          ) : (
            <div className="flex items-center gap-[2px] h-12">
              {barHeights.map((height, i) => (
                <div
                  key={i}
                  className="w-[2px] bg-linear-to-t from-violet-500 to-pink-400 rounded-full"
                  style={{ height: `${height}px` }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Hints row */}
        {!isProcessing && !error && (
          <div className="flex items-center gap-4 text-[11px] text-white/40">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60 font-mono">
                {formatShortcut(cancelShortcut)}
              </kbd>
              <span>cancel</span>
            </span>
            <span className="text-white/20">|</span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60 font-mono">
                {formatShortcut(recordingShortcut)}
              </kbd>
              <span>finish</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
