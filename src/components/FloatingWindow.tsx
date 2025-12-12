import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./FloatingWindow.css";

const TARGET_SAMPLE_RATE = 24000;

export function FloatingWindow() {
  const [transcription, setTranscription] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptionRef = useRef("");

  const startAudioCapture = useCallback(async () => {
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
      setError("Microphone access denied");
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
    startAudioCapture();
    return () => stopAudioCapture();
  }, [startAudioCapture, stopAudioCapture]);

  useEffect(() => {
    const unlistenTranscript = listen<string>(
      "transcription-update",
      (event) => {
        console.log("Transcription update:", event.payload);
        setTranscription(event.payload);
        transcriptionRef.current = event.payload;
        setError(null);
      }
    );

    const unlistenConnection = listen<boolean>("connection-state", (event) => {
      console.log("Connection state:", event.payload);
      setIsConnected(event.payload);
    });

    const unlistenError = listen<string>("transcription-error", (event) => {
      console.error("Transcription error:", event.payload);
      setError(event.payload);
    });

    const unlistenRecording = listen<boolean>("recording-state", async (event) => {
      if (!event.payload && transcriptionRef.current) {
        console.log("Recording stopped, copying:", transcriptionRef.current);
        try {
          await invoke("copy_and_paste", { text: transcriptionRef.current });
        } catch (err) {
          console.error("Failed to copy and paste:", err);
        }
      }
    });

    return () => {
      unlistenTranscript.then((fn) => fn());
      unlistenConnection.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenRecording.then((fn) => fn());
    };
  }, []);

  const handleStop = async () => {
    try {
      await invoke("stop_recording");
    } catch (err) {
      console.error("Failed to stop:", err);
    }
  };

  return (
    <div className="floating-container">
      <div className="status-bar">
        <div className="status-left">
          <div className="recording-dot pulsing" />
          <span className="status-text">
            {error ? "Error" : isConnected ? "Listening..." : "Connecting..."}
          </span>
        </div>
        <button className="stop-btn" onClick={handleStop}>
          Stop
        </button>
      </div>
      <div className="transcription-area">
        {error ? (
          <span className="error-text">{error}</span>
        ) : transcription ? (
          transcription
        ) : (
          <span className="placeholder">Start speaking...</span>
        )}
      </div>
    </div>
  );
}
