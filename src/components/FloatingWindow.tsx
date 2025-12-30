import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { formatShortcut } from "@/lib/shortcuts";
import { CheckIcon, GearIcon } from "@/components/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TranscriptionRule } from "@/hooks/useSettings";

const TARGET_SAMPLE_RATE = 24000;
const store = new LazyStore("settings.json");
const BAR_COUNT = 24;
const MIN_BAR_HEIGHT = 4;
const MAX_BAR_HEIGHT = 32;
const VOICE_AMPLIFICATION = 2.5;

// Store keys (should match backend)
const STORE_KEYS = {
  SKIP_RULES_ONCE: "skipRulesOnce",
  TRANSCRIPTION_RULES: "transcriptionRules",
  CANCEL_SHORTCUT: "cancelShortcut",
  SHORTCUT: "shortcut",
  MICROPHONE_DEVICE_ID: "microphoneDeviceId",
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

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isStartingRef = useRef(false);

  const updateBars = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    const newHeights: number[] = [];
    const binSize = Math.floor(dataArray.length / BAR_COUNT);

    for (let i = 0; i < BAR_COUNT; i++) {
      const start = i * binSize;
      const end = start + binSize;
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += dataArray[j];
      }
      const avg = sum / binSize;
      const amplified = Math.min(255, avg * VOICE_AMPLIFICATION);
      const height =
        MIN_BAR_HEIGHT + (amplified / 255) * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
      newHeights.push(height);
    }

    setBarHeights(newHeights);
    animationFrameRef.current = requestAnimationFrame(updateBars);
  }, []);

  const stopAudioCapture = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    analyserRef.current?.disconnect();
    analyserRef.current = null;

    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== "closed") {
      ctx.close().catch((err) => {
        console.error("[FloatingWindow] Error closing AudioContext:", err);
      });
    }

    setBarHeights(Array(BAR_COUNT).fill(MIN_BAR_HEIGHT));
  }, []);

  const startAudioCapture = useCallback(async () => {
    if (audioContextRef.current || isStartingRef.current) return;
    isStartingRef.current = true;

    try {
      console.log("[FloatingWindow] Starting audio capture...");

      const microphoneDeviceId = await store.get<string>(
        STORE_KEYS.MICROPHONE_DEVICE_ID
      );

      const audioConstraints: MediaTrackConstraints = {
        sampleRate: { ideal: TARGET_SAMPLE_RATE },
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
      };

      if (microphoneDeviceId) {
        audioConstraints.deviceId = { exact: microphoneDeviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      analyserRef.current = analyser;

      await audioContext.audioWorklet.addModule("/audio-processor.js");
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const workletNode = new AudioWorkletNode(audioContext, "audio-processor");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = async (event) => {
        if (event.data.type === "audio") {
          try {
            await invoke("send_audio_chunk", {
              audio: Array.from(new Uint8Array(event.data.audio)),
            });
          } catch (err) {
            console.error("Failed to send audio:", err);
          }
        }
      };

      source.connect(analyser);
      analyser.connect(workletNode);

      animationFrameRef.current = requestAnimationFrame(updateBars);

      console.log("[FloatingWindow] Audio capture started!");
    } catch (err) {
      console.error("[FloatingWindow] Failed to start audio:", err);
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          setError("Mic denied");
        } else if (err.name === "NotFoundError") {
          setError("Mic not found");
        } else if (err.name === "OverconstrainedError") {
          setError("Mic unavailable");
        } else {
          setError(`Mic error: ${err.name}`);
        }
      } else {
        setError("Mic error");
      }
      stopAudioCapture();
    } finally {
      isStartingRef.current = false;
    }
  }, [updateBars, stopAudioCapture]);

  const checkEnabledRules = useCallback(async () => {
    try {
      const rulesJson = await store.get<string>(STORE_KEYS.TRANSCRIPTION_RULES);
      if (rulesJson) {
        const parsedRules: TranscriptionRule[] = JSON.parse(rulesJson);
        const hasEnabled = parsedRules.some((r) => r.enabled);
        setHasEnabledRules(hasEnabled);
      }
    } catch (err) {
      console.error("Failed to load rules:", err);
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

  useEffect(() => {
    const unlistenExpanded = listen<boolean>(
      "floating-expanded",
      async (event) => {
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
          checkEnabledRules();
          startAudioCapture();
        } else {
          stopAudioCapture();
          setIsProcessing(false);
        }
      }
    );

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
      stopAudioCapture();
      unlistenExpanded.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenProcessing.then((fn) => fn());
      unlistenProcessingMessage.then((fn) => fn());
    };
  }, [startAudioCapture, stopAudioCapture, checkEnabledRules]);

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
          {/* Options dropdown - only show if there are enabled rules */}
          {!isProcessing && !error && hasEnabledRules && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`
                    flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200
                    ${
                      skipRules
                        ? "bg-orange-500/30 text-orange-300"
                        : "bg-violet-500/30 text-violet-300"
                    }
                  `}
                  title="Rules options"
                >
                  <GearIcon />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom">
                <DropdownMenuLabel>Rules</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => setRulesMode(false)}
                  className={
                    !skipRules ? "bg-violet-500/20 text-violet-300" : ""
                  }
                >
                  {!skipRules && <CheckIcon />}
                  <span className={!skipRules ? "" : "ml-5"}>
                    Default rules
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setRulesMode(true)}
                  className={
                    skipRules ? "bg-orange-500/20 text-orange-300" : ""
                  }
                >
                  {skipRules && <CheckIcon />}
                  <span className={skipRules ? "" : "ml-5"}>None</span>
                </DropdownMenuItem>
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
            <div className="flex items-center gap-[3px] h-8">
              {barHeights.map((height, i) => (
                <div
                  key={i}
                  className="w-[3px] bg-linear-to-t from-violet-500 to-pink-400 rounded-full transition-all duration-75"
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
