import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";

const TARGET_SAMPLE_RATE = 24000;
const store = new LazyStore("settings.json");
const BAR_COUNT = 24;
const MIN_BAR_HEIGHT = 4;
const MAX_BAR_HEIGHT = 32;
const VOICE_AMPLIFICATION = 2.5; // Boost voice frequencies for more visible movement

function formatShortcut(shortcut: string): string {
  return shortcut
    .replace(/CommandOrControl/g, "Ctrl")
    .replace(/ArrowUp/g, "↑")
    .replace(/ArrowDown/g, "↓")
    .replace(/ArrowLeft/g, "←")
    .replace(/ArrowRight/g, "→");
}

export function FloatingWindow() {
  const [isActive, setIsActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("Transcribing...");
  const [error, setError] = useState<string | null>(null);
  const [cancelShortcut, setCancelShortcut] = useState("Escape");
  const [recordingShortcut, setRecordingShortcut] = useState("Ctrl+Shift+Space");
  const [barHeights, setBarHeights] = useState<number[]>(
    Array(BAR_COUNT).fill(MIN_BAR_HEIGHT)
  );

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
      // Apply amplification and clamp to [0, 255]
      const amplified = Math.min(255, avg * VOICE_AMPLIFICATION);
      const height =
        MIN_BAR_HEIGHT + (amplified / 255) * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
      newHeights.push(height);
    }

    setBarHeights(newHeights);
    animationFrameRef.current = requestAnimationFrame(updateBars);
  }, []);

  const stopAudioCapture = useCallback(() => {
    // Cancel animation frame first
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Disconnect nodes in reverse connection order
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    analyserRef.current?.disconnect();
    analyserRef.current = null;

    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;

    // Stop media tracks before closing context
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    // Close audio context (fire and forget, but log errors)
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
    // Guard against concurrent starts
    if (audioContextRef.current || isStartingRef.current) return;
    isStartingRef.current = true;

    try {
      console.log("[FloatingWindow] Starting audio capture...");

      // Get saved microphone device ID from settings
      const microphoneDeviceId = await store.get<string>("microphoneDeviceId");

      const audioConstraints: MediaTrackConstraints = {
        // Use 'ideal' instead of exact to avoid "no device found" errors
        sampleRate: { ideal: TARGET_SAMPLE_RATE },
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
      };

      // Only set deviceId if a specific device was selected
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
      analyser.smoothingTimeConstant = 0.4; // Lower = more responsive to voice
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
      workletNode.connect(audioContext.destination);

      animationFrameRef.current = requestAnimationFrame(updateBars);

      console.log("[FloatingWindow] Audio capture started!");
    } catch (err) {
      console.error("[FloatingWindow] Failed to start audio:", err);
      // Provide more specific error messages
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
      // Clean up any partial initialization
      stopAudioCapture();
    } finally {
      isStartingRef.current = false;
    }
  }, [updateBars, stopAudioCapture]);

  useEffect(() => {
    const unlistenExpanded = listen<boolean>("floating-expanded", async (event) => {
      setIsActive(event.payload);
      if (event.payload) {
        setError(null);
        setIsProcessing(false);
        // Load shortcuts from store
        const savedCancelShortcut = await store.get<string>("cancelShortcut");
        const savedRecordingShortcut = await store.get<string>("shortcut");
        if (savedCancelShortcut) {
          setCancelShortcut(savedCancelShortcut);
        }
        if (savedRecordingShortcut) {
          setRecordingShortcut(savedRecordingShortcut);
        }
        startAudioCapture();
      } else {
        stopAudioCapture();
        setIsProcessing(false);
      }
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

    const unlistenProcessingMessage = listen<string>("processing-message", (event) => {
      setProcessingMessage(event.payload);
    });

    return () => {
      // Clean up audio resources on unmount
      stopAudioCapture();
      unlistenExpanded.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenProcessing.then((fn) => fn());
      unlistenProcessingMessage.then((fn) => fn());
    };
  }, [startAudioCapture, stopAudioCapture]);

  if (!isActive) {
    return null;
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent select-none">
      <div className="flex flex-col items-center gap-2 px-5 py-3 bg-gradient-to-b from-zinc-800/95 to-zinc-900/95 rounded-2xl shadow-2xl shadow-black/50 backdrop-blur-xl animate-fade-in">
        {/* Main status area */}
        <div className="flex items-center justify-center min-h-[36px]">
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
                  className="w-[3px] bg-gradient-to-t from-violet-500 to-pink-400 rounded-full transition-all duration-75"
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
