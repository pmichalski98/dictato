import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./FloatingWindow.css";

const TARGET_SAMPLE_RATE = 24000;

export function FloatingWindow() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const windowStartX = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptionRef = useRef("");

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".stop-btn")) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.screenX;
    const pos = await getCurrentWindow().outerPosition();
    windowStartX.current = pos.x;
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.screenX - dragStartX.current;
      const newX = windowStartX.current + deltaX;
      invoke("set_floating_x", { x: newX });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const startAudioCapture = useCallback(async () => {
    if (audioContextRef.current) return;
    try {
      console.log("[FloatingWindow] Starting audio capture...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: TARGET_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule("/audio-processor.js");
      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, "audio-processor");

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

      source.connect(workletNode);
      workletNode.connect(audioContext.destination);
      workletNodeRef.current = workletNode;
      console.log("[FloatingWindow] Audio capture started!");
    } catch (err) {
      console.error("[FloatingWindow] Failed to start audio:", err);
      setError("Mic denied");
    }
  }, []);

  const stopAudioCapture = useCallback(() => {
    workletNodeRef.current?.disconnect();
    audioContextRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    workletNodeRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;
  }, []);

  useEffect(() => {
    const unlistenExpanded = listen<boolean>("floating-expanded", (event) => {
      setIsExpanded(event.payload);
      if (event.payload) {
        setTranscription("");
        transcriptionRef.current = "";
        setError(null);
        setIsProcessing(false);
        startAudioCapture();
      } else {
        stopAudioCapture();
        setIsSpeaking(false);
        setIsProcessing(false);
      }
    });

    const unlistenTranscript = listen<string>("transcription-update", (event) => {
      setTranscription(event.payload);
      transcriptionRef.current = event.payload;
      setError(null);
    });

    const unlistenConnection = listen<boolean>("connection-state", (event) => {
      setIsConnected(event.payload);
    });

    const unlistenError = listen<string>("transcription-error", (event) => {
      setError(event.payload);
    });

    const unlistenSpeechStart = listen("speech-started", () => {
      setIsSpeaking(true);
    });

    const unlistenSpeechStop = listen("speech-stopped", () => {
      setIsSpeaking(false);
    });

    const unlistenProcessing = listen<boolean>("processing-state", (event) => {
      setIsProcessing(event.payload);
    });

    return () => {
      unlistenExpanded.then((fn) => fn());
      unlistenTranscript.then((fn) => fn());
      unlistenConnection.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenSpeechStart.then((fn) => fn());
      unlistenSpeechStop.then((fn) => fn());
      unlistenProcessing.then((fn) => fn());
    };
  }, [startAudioCapture, stopAudioCapture]);

  const handleStop = async () => {
    try {
      await invoke("stop_recording");
    } catch (err) {
      console.error("Failed to stop:", err);
    }
  };

  const getDisplayText = () => {
    if (error) return error;
    if (isProcessing) return "Processing...";
    if (transcription) return transcription;
    if (!isConnected) return "Connecting...";
    return "Listening...";
  };

  if (!isExpanded) {
    return (
      <div className="floating-container collapsed" onMouseDown={handleMouseDown}>
        <div className="collapsed-orb" />
      </div>
    );
  }

  return (
    <div className="floating-container expanded" onMouseDown={handleMouseDown}>
      <div className="indicator">
        <div className={`orb-container ${isSpeaking ? "speaking" : ""}`}>
          <div className={`orb ${isSpeaking ? "speaking" : ""} ${error ? "error" : ""}`} />
          <div className="ring" />
          <div className="ring" />
          <div className="ring" />
        </div>
        <span className={`transcript-text ${error ? "error" : ""} ${!transcription ? "placeholder" : ""}`}>
          {getDisplayText()}
        </span>
        <button className="stop-btn" onClick={handleStop} title="Stop recording" />
      </div>
    </div>
  );
}
