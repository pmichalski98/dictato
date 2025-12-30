import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAudioRecorder } from "./useAudioRecorder";

export function useRealtimeTranscription() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const isRecordingRef = useRef(false);

  const handleAudioChunk = useCallback(async (chunk: ArrayBuffer) => {
    if (!isRecordingRef.current) return;

    try {
      await invoke("send_audio_chunk", {
        audio: Array.from(new Uint8Array(chunk)),
      });
    } catch (err) {
      console.error("Failed to send audio chunk:", err);
    }
  }, []);

  const { startRecording: startAudio, stopRecording: stopAudio } =
    useAudioRecorder(handleAudioChunk);

  const startRecording = useCallback(async () => {
    try {
      isRecordingRef.current = true;
      setIsRecording(true);
      setTranscription("");
      setIsProcessing(false);

      await invoke("start_recording");
      await startAudio();
    } catch (err) {
      console.error("Failed to start recording:", err);
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  }, [startAudio]);

  const stopRecording = useCallback(async () => {
    try {
      isRecordingRef.current = false;
      stopAudio();
      await invoke("stop_recording");
      setIsRecording(false);
    } catch (err) {
      console.error("Failed to stop recording:", err);
    }
  }, [stopAudio]);

  const toggleRecording = useCallback(async () => {
    if (isRecordingRef.current) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }, [startRecording, stopRecording]);

  useEffect(() => {
    const unlistenTranscript = listen<string>("transcription-update", (event) => {
      setTranscription(event.payload);
    });

    const unlistenFinal = listen<string>("transcription-final", async (event) => {
      if (event.payload) {
        try {
          await invoke("copy_and_paste", { text: event.payload });
        } catch (err) {
          console.error("Failed to copy and paste:", err);
        }
      }
    });

    const unlistenProcessing = listen<boolean>("processing-state", (event) => {
      setIsProcessing(event.payload);
    });

    return () => {
      unlistenTranscript.then((fn) => fn());
      unlistenFinal.then((fn) => fn());
      unlistenProcessing.then((fn) => fn());
    };
  }, []);

  return {
    isRecording,
    isProcessing,
    transcription,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}

