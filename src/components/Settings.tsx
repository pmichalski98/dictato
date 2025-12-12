import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../hooks/useSettings";
import { useRealtimeTranscription } from "../hooks/useRealtimeTranscription";
import "./Settings.css";

export function Settings() {
  const { settings, isLoading, updateApiKey, updateShortcut } = useSettings();
  const [localApiKey, setLocalApiKey] = useState("");
  const [localShortcut, setLocalShortcut] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  const { isRecording, toggleRecording } = useRealtimeTranscription(settings.apiKey);

  useEffect(() => {
    if (!isLoading) {
      setLocalApiKey(settings.apiKey);
      setLocalShortcut(settings.shortcut);
    }
  }, [isLoading, settings]);

  useEffect(() => {
    if (settings.shortcut) {
      invoke("register_shortcut", { shortcutStr: settings.shortcut }).catch(console.error);
    }
  }, [settings.shortcut]);

  const handleSaveApiKey = useCallback(async () => {
    try {
      await updateApiKey(localApiKey);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }, [localApiKey, updateApiKey]);

  const handleCaptureShortcut = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();

    const parts: string[] = [];
    if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    const key = e.key;
    if (key.length === 1 && key !== " ") {
      parts.push(key.toUpperCase());
    } else if (key === " ") {
      parts.push("Space");
    } else if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
      parts.push(key);
    }

    if (parts.length > 1) {
      const shortcut = parts.join("+");
      setLocalShortcut(shortcut);
      updateShortcut(shortcut);
      setIsCapturing(false);
    }
  }, [updateShortcut]);

  if (isLoading) {
    return <div className="settings-container loading">Loading...</div>;
  }

  return (
    <div className="settings-container">
      <header className="settings-header">
        <h1>Whisper Clone</h1>
        <p className="tagline">Voice to text, instantly</p>
      </header>

      <div className="settings-section">
        <label className="settings-label">
          <span>OpenAI API Key</span>
          <div className="input-group">
            <input
              type="password"
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
              placeholder="sk-..."
              className="settings-input"
            />
            <button onClick={handleSaveApiKey} className="btn-primary">
              {status === "saved" ? "✓ Saved" : "Save"}
            </button>
          </div>
        </label>
      </div>

      <div className="settings-section">
        <label className="settings-label">
          <span>Recording Shortcut</span>
          <div className="input-group">
            <input
              type="text"
              value={localShortcut}
              readOnly
              onFocus={() => setIsCapturing(true)}
              onBlur={() => setIsCapturing(false)}
              onKeyDown={isCapturing ? handleCaptureShortcut : undefined}
              placeholder="Click and press keys..."
              className={`settings-input ${isCapturing ? "capturing" : ""}`}
            />
          </div>
          {isCapturing && (
            <span className="hint">Press your desired key combination</span>
          )}
        </label>
      </div>

      <div className="settings-section">
        <div className="status-section">
          <div className={`status-indicator ${isRecording ? "recording" : ""}`}>
            <div className="status-dot" />
            <span>{isRecording ? "Recording..." : "Ready"}</span>
          </div>
          <button
            onClick={toggleRecording}
            className={`btn-record ${isRecording ? "active" : ""}`}
            disabled={!settings.apiKey}
          >
            {isRecording ? "Stop" : "Test Recording"}
          </button>
        </div>
      </div>

      <footer className="settings-footer">
        <p>
          Press <code>{settings.shortcut || "your shortcut"}</code> anywhere to start dictating
        </p>
      </footer>
    </div>
  );
}

