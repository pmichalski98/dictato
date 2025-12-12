import { useState, useRef, useCallback } from "react";

const TARGET_SAMPLE_RATE = 24000;

export function useAudioRecorder(onAudioChunk: (chunk: ArrayBuffer) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkCountRef = useRef(0);

  const startRecording = useCallback(async () => {
    try {
      console.log("[Audio] Requesting microphone access...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: TARGET_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      console.log("[Audio] Got microphone stream");
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioContextRef.current = audioContext;

      console.log(
        "[Audio] AudioContext created, sample rate:",
        audioContext.sampleRate
      );

      await audioContext.audioWorklet.addModule("/audio-processor.js");
      console.log("[Audio] AudioWorklet loaded");

      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, "audio-processor");

      chunkCountRef.current = 0;

      workletNode.port.onmessage = (event) => {
        if (event.data.type === "audio") {
          chunkCountRef.current++;
          if (chunkCountRef.current % 10 === 0) {
            console.log(
              `[Audio] Chunk #${chunkCountRef.current}, size: ${event.data.audio.byteLength} bytes`
            );
          }
          onAudioChunk(event.data.audio);
        }
      };

      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      workletNodeRef.current = workletNode;
      setIsRecording(true);
      console.log("[Audio] Recording started!");
    } catch (err) {
      console.error("[Audio] Failed to start recording:", err);
      throw err;
    }
  }, [onAudioChunk]);

  const stopRecording = useCallback(() => {
    console.log("[Audio] Stopping recording...");

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    console.log(
      `[Audio] Recording stopped. Total chunks: ${chunkCountRef.current}`
    );
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return {
    isRecording,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
