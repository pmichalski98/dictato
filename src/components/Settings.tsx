import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings, Provider } from "../hooks/useSettings";
import { useRealtimeTranscription } from "../hooks/useRealtimeTranscription";
import "./Settings.css";

export function Settings() {
  const { settings, isLoading, updateApiKey, updateGroqApiKey, updateProvider, updateLanguage, updateShortcut } = useSettings();
  const [localApiKey, setLocalApiKey] = useState("");
  const [localGroqApiKey, setLocalGroqApiKey] = useState("");
  const [localShortcut, setLocalShortcut] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [groqStatus, setGroqStatus] = useState<"idle" | "saved" | "error">("idle");

  const currentApiKey = settings.provider === "openai" ? settings.apiKey : settings.groqApiKey;
  const { isRecording, toggleRecording } = useRealtimeTranscription(currentApiKey, settings.provider);

  useEffect(() => {
    if (!isLoading) {
      setLocalApiKey(settings.apiKey);
      setLocalGroqApiKey(settings.groqApiKey);
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

  const handleSaveGroqApiKey = useCallback(async () => {
    try {
      await updateGroqApiKey(localGroqApiKey);
      setGroqStatus("saved");
      setTimeout(() => setGroqStatus("idle"), 2000);
    } catch {
      setGroqStatus("error");
    }
  }, [localGroqApiKey, updateGroqApiKey]);

  const handleProviderChange = useCallback((provider: Provider) => {
    updateProvider(provider);
  }, [updateProvider]);

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
          <span>Transcription Provider</span>
          <div className="input-group">
            <select
              value={settings.provider}
              onChange={(e) => handleProviderChange(e.target.value as Provider)}
              className="settings-input"
            >
              <option value="openai">OpenAI (live streaming)</option>
              <option value="groq">Groq Whisper Turbo (faster)</option>
            </select>
          </div>
        </label>
      </div>

      <div className="settings-section">
        <label className="settings-label">
          <span>Language</span>
          <div className="input-group">
            <select
              value={settings.language}
              onChange={(e) => updateLanguage(e.target.value)}
              className="settings-input"
            >
              <option value="en">English</option>
              <option value="pl">Polish</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="nl">Dutch</option>
              <option value="ja">Japanese</option>
              <option value="zh">Chinese</option>
              <option value="ko">Korean</option>
              <option value="ru">Russian</option>
              <option value="uk">Ukrainian</option>
            </select>
          </div>
        </label>
      </div>

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
              {status === "saved" ? "Saved" : "Save"}
            </button>
          </div>
        </label>
      </div>

      <div className="settings-section">
        <label className="settings-label">
          <span>Groq API Key</span>
          <div className="input-group">
            <input
              type="password"
              value={localGroqApiKey}
              onChange={(e) => setLocalGroqApiKey(e.target.value)}
              placeholder="gsk_..."
              className="settings-input"
            />
            <button onClick={handleSaveGroqApiKey} className="btn-primary">
              {groqStatus === "saved" ? "Saved" : "Save"}
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
            disabled={!currentApiKey}
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

