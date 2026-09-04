mod audio;
mod groq;
mod keyboard_lock;
mod llm;
mod local_audio;
mod local_llm;
mod models;
mod transcribe;
mod whisper;

use audio::{AudioCaptureHandle, AudioDevice};
#[cfg(not(target_os = "macos"))]
use enigo::{Enigo, Key, Keyboard, Settings};
use groq::GroqState;
use llm::LlmBackend;
use models::{LocalModel, ModelKind, SttProvider};
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
// Autostart plugin only on Windows
#[cfg(target_os = "windows")]
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

// Floating window constants
const FLOATING_WINDOW_WIDTH: f64 = 320.0;
// Compact default; the frontend resizes the window to fit the visible pill
// (and expands it while the mode dropdown is open) so the transparent area
// doesn't block clicks on windows underneath.
const FLOATING_WINDOW_HEIGHT: f64 = 140.0;
const FLOATING_WINDOW_DEFAULT_Y: f64 = 8.0;

// Audio processing constants

// Clipboard propagation delay (ms) — macOS NSPasteboard doesn't propagate writes instantly;
// pasting too soon after writing may read stale contents.
const CLIPBOARD_PROPAGATION_DELAY_MS: u64 = 150;

// Statistics calculation constants
const AVERAGE_TYPING_WPM: f64 = 40.0; // Average typing speed for time-saved calculations

// Store keys
mod store_keys {
    pub const FLOATING_X: &str = "floatingX";
    pub const FLOATING_Y: &str = "floatingY";
    pub const SKIP_RULES_ONCE: &str = "skipRulesOnce";
    pub const TRANSCRIPTION_RULES: &str = "transcriptionRules";
    pub const CUSTOM_MODES: &str = "customModes";
    pub const GROQ_API_KEY: &str = "groqApiKey";
    pub const OPENAI_API_KEY: &str = "openaiApiKey";
    pub const GOOGLE_API_KEY: &str = "googleApiKey";
    pub const ANTHROPIC_API_KEY: &str = "anthropicApiKey";
    pub const OPENAI_MODEL: &str = "openaiModel";
    pub const GOOGLE_MODEL: &str = "googleModel";
    pub const ANTHROPIC_MODEL: &str = "anthropicModel";
    pub const LLM_PROVIDER: &str = "llmProvider";
    pub const LANGUAGE: &str = "language";
    pub const CANCEL_SHORTCUT: &str = "cancelShortcut";
    pub const AUTO_PASTE: &str = "autoPaste";
    pub const MICROPHONE_DEVICE_ID: &str = "microphoneDeviceId";
    pub const ACTIVE_MODE: &str = "activeMode";
    pub const STATS_TOTAL_WORDS: &str = "statsTotalWords";
    pub const STATS_TOTAL_TRANSCRIPTIONS: &str = "statsTotalTranscriptions";
    pub const STATS_TOTAL_TIME_SAVED_SECONDS: &str = "statsTotalTimeSavedSeconds";
    pub const STT_PROVIDER: &str = "sttProvider";
    pub const PURE_PASTE_ENABLED: &str = "purePasteEnabled";
    pub const PURE_PASTE_SHORTCUT: &str = "purePasteShortcut";
    pub const DICTIONARY_WORDS: &str = "dictionaryWords";
    pub const DICTATION_HISTORY: &str = "dictationHistory";
}

const MAX_DICTATION_HISTORY: usize = 50;

// Built-in mode prompts
const VIBE_CODING_PROMPT: &str = r#"You are a concise text formatter for coding assistant input.

CRITICAL: You are a FORMATTER, not an assistant. NEVER answer questions or provide solutions.
If the user asks "how do I fix this bug?" - keep it as a question, do not answer it.

Transform the text to be:
- Extremely brief and direct
- No filler words or pleasantries
- Use imperative commands when appropriate
- Clear, actionable instructions

NEVER change the intent or add your own content. Output ONLY the formatted text."#;

const PROFESSIONAL_EMAIL_PROMPT: &str = r#"You are a professional email formatter.

CRITICAL: You are a FORMATTER, not an assistant. NEVER answer questions in the text.
If the user asks something, format it as a question in the email - do not answer it.

Transform the text into a professional email:
- Use formal, professional language
- Include appropriate greeting if not present
- Organize into clear paragraphs
- Use proper email conventions
- Maintain a courteous but professional tone
- Include appropriate closing if relevant

NEVER change the message's intent. Output ONLY the formatted email."#;

const DEFAULT_PURE_PASTE_SHORTCUT: &str = "CommandOrControl+Shift+V";

static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static REGISTERED_PURE_PASTE_SHORTCUT: Lazy<Mutex<Option<String>>> =
    Lazy::new(|| Mutex::new(None));

pub struct AudioCaptureState {
    handle: AudioCaptureHandle,
    receiver_handle: std::sync::Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Default for AudioCaptureState {
    fn default() -> Self {
        Self {
            handle: AudioCaptureHandle::new(),
            receiver_handle: std::sync::Mutex::new(None),
        }
    }
}

#[tauri::command]
fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    audio::list_input_devices()
}

#[tauri::command]
async fn start_recording(app: AppHandle) -> Result<(), String> {
    IS_RECORDING.store(true, Ordering::SeqCst);

    // Register cancel shortcut only while recording
    let cancel_shortcut_str = get_cancel_shortcut_from_store(&app);
    register_cancel_shortcut_internal(&app, &cancel_shortcut_str).ok();

    app.emit("recording-state", true).ok();
    expand_floating_window(&app)?;

    let groq_state = app.state::<GroqState>();
    groq_state.clear_buffer();

    // Start native audio capture
    let device_id = get_store_string(&app, store_keys::MICROPHONE_DEVICE_ID);
    let audio_state = app.state::<AudioCaptureState>();

    // Create channels for audio data and levels
    let (audio_tx, audio_rx) = mpsc::channel::<Vec<u8>>();
    let (level_tx, level_rx) = mpsc::channel::<f32>();

    // Start the audio capture
    audio_state
        .handle
        .start(device_id, audio_tx, level_tx)?;

    // Spawn task to receive audio data and store in buffer
    let groq_state_clone = app.state::<GroqState>().inner().clone();
    let receiver_handle = std::thread::spawn(move || {
        let mut chunks_received: usize = 0;
        let mut total_bytes: usize = 0;
        while let Ok(audio_chunk) = audio_rx.recv() {
            chunks_received += 1;
            total_bytes += audio_chunk.len();
            if let Err(e) = groq_state_clone.append_audio(audio_chunk) {
                eprintln!("[Audio] Failed to append audio: {}", e);
            }
        }
        println!(
            "[Audio] Receiver thread finished: {} chunks, {} bytes total",
            chunks_received, total_bytes
        );
    });

    // Store receiver handle so stop_recording can join it
    if let Ok(mut guard) = audio_state.receiver_handle.lock() {
        *guard = Some(receiver_handle);
    }

    // Spawn task to receive audio levels and emit to frontend
    let app_clone = app.clone();
    std::thread::spawn(move || {
        // Small delay on first iteration to ensure frontend webview is ready
        // (hidden windows may delay JS initialization until shown)
        std::thread::sleep(std::time::Duration::from_millis(50));
        while let Ok(level) = level_rx.recv() {
            app_clone.emit("audio-level", level).ok();
        }
    });

    Ok(())
}

#[tauri::command]
async fn stop_recording(app: AppHandle) -> Result<(), String> {
    IS_RECORDING.store(false, Ordering::SeqCst);
    app.emit("recording-state", false).ok();

    // Unregister cancel shortcut since recording stopped
    unregister_cancel_shortcut(&app);

    // Stop native audio capture (sends Stop command to audio thread)
    let audio_state = app.state::<AudioCaptureState>();
    audio_state.handle.stop();

    // Wait for receiver thread to finish draining all audio into the buffer.
    // The receiver thread exits when the processing thread drops audio_sender,
    // which happens after the audio thread processes the Stop command.
    let receiver_handle = audio_state
        .receiver_handle
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());
    if let Some(handle) = receiver_handle {
        let _ = tokio::task::spawn_blocking(move || handle.join()).await;
    }

    let groq_state = app.state::<GroqState>();
    let audio_data = groq_state.get_buffer()?;

    println!("[Dictato] Audio buffer size: {} bytes", audio_data.len());

    groq_state.clear_buffer();

    let stt_provider = get_stt_provider_from_store(&app);
    let llm_backend = resolve_llm_backend(&app);
    let language = get_language_from_store(&app);
    let dictionary = get_dictionary_from_store(&app);
    let vocabulary_prompt = build_vocabulary_prompt(&dictionary);
    let transcript = if audio_data.is_empty() {
        println!("[Dictato] Skipping transcription: audio buffer empty");
        String::new()
    } else if let Some(model) = stt_provider.local_model() {
        println!(
            "[Dictato] Transcribing {} bytes locally with {}",
            audio_data.len(),
            model.name()
        );
        app.emit("processing-state", true).ok();
        let result = async {
            let samples = local_audio::pcm16_24k_to_16k(&audio_data)?;
            run_local_transcription(
                &app,
                model,
                samples,
                language.clone(),
                vocabulary_prompt.clone(),
            )
            .await
        }
        .await;
        match result {
            Ok(text) => text,
            Err(e) => {
                app.emit("processing-state", false).ok();
                return Err(e);
            }
        }
    } else {
        let groq_api_key = get_groq_api_key_from_store(&app).unwrap_or_default();
        if groq_api_key.is_empty() {
            println!("[Dictato] Skipping transcription: groq_api_key_empty");
            String::new()
        } else {
            println!("[Dictato] Sending {} bytes to Groq API", audio_data.len());
            app.emit("processing-state", true).ok();
            let result =
                groq::transcribe(&groq_api_key, audio_data, &language, vocabulary_prompt.as_deref())
                    .await;
            match result {
                Ok(text) => text,
                Err(e) => {
                    app.emit("processing-state", false).ok();
                    return Err(e);
                }
            }
        }
    };

    // Apply mode transformation or rules (modes take priority over rules)
    // Uses the selected LLM provider for processing
    let mut had_llm_error = false;
    // What produced the final text, recorded in dictation history
    let mut processing_kind = "none";
    let mut processing_label: Option<String> = None;
    let raw_transcript = transcript.clone();
    let final_text = if !transcript.is_empty() {
        let skip_rules = should_skip_rules(&app);
        if skip_rules {
            println!("[Dictato] Transformation skipped for this recording");
            transcript
        } else if let Some(mode_id) = get_active_mode_from_store(&app) {
            // Mode is active - get prompt and apply transformation (rules are ignored)
            if let Some(prompt) = get_mode_prompt_from_store(&app, &mode_id) {
                match &llm_backend {
                    Ok(backend) => {
                        app.emit("processing-message", "Applying mode...").ok();
                        match llm::process_with_prompt(backend, &transcript, &prompt, &language, &dictionary).await {
                            Ok(processed) => {
                                println!("[Dictato] Mode '{}' applied successfully using {}", mode_id, backend.display_name());
                                processing_kind = "mode";
                                processing_label = Some(get_mode_name_from_store(&app, &mode_id));
                                processed
                            }
                            Err(e) => {
                                eprintln!("[Dictato] Mode processing failed, using raw transcript: {}", e);
                                had_llm_error = true;
                                show_error(&app, &format_llm_error(&e));
                                transcript
                            }
                        }
                    }
                    Err(reason) => {
                        // Provider not usable - show error and return raw transcript
                        had_llm_error = true;
                        show_error(&app, &format!("{} - mode skipped. Raw transcription copied.", reason));
                        transcript
                    }
                }
            } else {
                println!("[Dictato] Mode '{}' not found, using raw transcript", mode_id);
                transcript
            }
        } else {
            // No mode active - apply rules if any are enabled
            let rules = get_transcription_rules_from_store(&app);
            let has_enabled_rules = rules.iter().any(|r| r.enabled);
            if has_enabled_rules {
                match &llm_backend {
                    Ok(backend) => {
                        app.emit("processing-message", "Applying rules...").ok();
                        match llm::process_with_rules(backend, &transcript, rules, &language, &dictionary).await {
                            Ok(processed) => {
                                println!("[Dictato] Rules applied successfully using {}", backend.display_name());
                                processing_kind = "rules";
                                processed
                            }
                            Err(e) => {
                                eprintln!("[Dictato] Rule processing failed, using raw transcript: {}", e);
                                had_llm_error = true;
                                show_error(&app, &format_llm_error(&e));
                                transcript
                            }
                        }
                    }
                    Err(reason) => {
                        had_llm_error = true;
                        show_error(&app, &format!("{} - rules skipped. Raw transcription copied.", reason));
                        transcript
                    }
                }
            } else {
                transcript
            }
        }
    } else {
        transcript
    };

    app.emit("processing-state", false).ok();

    if !raw_transcript.is_empty() {
        add_dictation_to_history(
            &app,
            &raw_transcript,
            &final_text,
            processing_kind,
            processing_label.as_deref(),
        );
    }

    // Don't collapse window if there was an LLM error - let show_error handle it
    if !had_llm_error {
        collapse_floating_window(&app)?;
    }

    if !final_text.is_empty() {
        // Update statistics
        if let Ok(store) = app.store("settings.json") {
            let word_count = final_text.split_whitespace().count() as i64;

            let current_words = store
                .get(store_keys::STATS_TOTAL_WORDS)
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let current_transcriptions = store
                .get(store_keys::STATS_TOTAL_TRANSCRIPTIONS)
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let current_time = store
                .get(store_keys::STATS_TOTAL_TIME_SAVED_SECONDS)
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);

            // Calculate time saved: (words / WPM) * 60 = seconds
            let time_saved_seconds = (word_count as f64 / AVERAGE_TYPING_WPM) * 60.0;

            store.set(
                store_keys::STATS_TOTAL_WORDS,
                serde_json::json!(current_words + word_count),
            );
            store.set(
                store_keys::STATS_TOTAL_TRANSCRIPTIONS,
                serde_json::json!(current_transcriptions + 1),
            );
            store.set(
                store_keys::STATS_TOTAL_TIME_SAVED_SECONDS,
                serde_json::json!(current_time + time_saved_seconds),
            );
            store.save().ok();

            // Emit stats update event for frontend
            app.emit(
                "stats-updated",
                serde_json::json!({
                    "totalWords": current_words + word_count,
                    "totalTranscriptions": current_transcriptions + 1,
                    "totalTimeSavedSeconds": current_time + time_saved_seconds
                }),
            )
            .ok();
        }

        copy_and_paste(app, final_text).await?;
    }

    Ok(())
}

#[tauri::command]
async fn cancel_recording(app: AppHandle) -> Result<(), String> {
    if !IS_RECORDING.load(Ordering::SeqCst) {
        return Ok(());
    }

    IS_RECORDING.store(false, Ordering::SeqCst);
    app.emit("recording-state", false).ok();

    // Unregister cancel shortcut since recording stopped
    unregister_cancel_shortcut(&app);

    // Stop native audio capture
    let audio_state = app.state::<AudioCaptureState>();
    audio_state.handle.stop();

    // Drop receiver handle (thread will exit when audio_sender is dropped)
    if let Ok(mut guard) = audio_state.receiver_handle.lock() {
        guard.take();
    }

    // Clear buffer without transcribing
    let groq_state = app.state::<GroqState>();
    groq_state.clear_buffer();

    collapse_floating_window(&app)?;
    println!("[Dictato] Recording cancelled");

    Ok(())
}

/// Check if accessibility permissions are granted on macOS using the proper API.
/// Uses both AXIsProcessTrusted and AXIsProcessTrustedWithOptions for reliability —
/// the latter can return stale results when code signatures change between builds.
#[cfg(target_os = "macos")]
fn check_accessibility_permissions(prompt: bool) -> bool {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: core_foundation::base::CFTypeRef) -> bool;
    }

    if prompt {
        // Trigger the native macOS accessibility permission dialog
        // This also forces a fresh trust evaluation, working around stale code signature issues
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let value = CFBoolean::true_value();
        let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
        let result = unsafe { AXIsProcessTrustedWithOptions(options.as_CFTypeRef()) };
        println!("[Dictato] AXIsProcessTrustedWithOptions(prompt=true) = {}", result);
        result
    } else {
        // Try both APIs — AXIsProcessTrusted() can be more reliable than
        // AXIsProcessTrustedWithOptions(null) in some macOS versions
        let trusted_simple = unsafe { AXIsProcessTrusted() };
        let options = std::ptr::null();
        let trusted_with_opts = unsafe { AXIsProcessTrustedWithOptions(options) };
        println!(
            "[Dictato] Accessibility check: AXIsProcessTrusted()={}, AXIsProcessTrustedWithOptions(null)={}",
            trusted_simple, trusted_with_opts
        );
        // Return true if either check passes
        trusted_simple || trusted_with_opts
    }
}

#[cfg(not(target_os = "macos"))]
fn check_accessibility_permissions(_prompt: bool) -> bool {
    true
}

/// Perform the actual paste operation using CGEvent (native macOS API)
/// CGEvent is thread-safe and doesn't require main thread, unlike enigo's TIS/TSM calls
#[cfg(target_os = "macos")]
fn perform_paste() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    // macOS virtual keycode for 'V' = 9 (kVK_ANSI_V)
    const KEYCODE_V: u16 = 9;

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "Failed to create CGEventSource".to_string())?;

    let key_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_V, true)
        .map_err(|_| "Failed to create key-down event".to_string())?;
    let key_up = CGEvent::new_keyboard_event(source, KEYCODE_V, false)
        .map_err(|_| "Failed to create key-up event".to_string())?;

    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    key_down.post(CGEventTapLocation::HID);
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

/// Fallback paste using AppleScript/osascript (used if CGEvent fails)
#[cfg(target_os = "macos")]
fn perform_paste_fallback() -> Result<(), String> {
    use std::process::Command;

    let output = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events" to keystroke "v" using command down"#,
        ])
        .output()
        .map_err(|e| format!("Failed to run osascript: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("AppleScript paste failed: {}", stderr))
    }
}

#[cfg(not(target_os = "macos"))]
fn perform_paste() -> Result<(), String> {
    let settings = Settings::default();
    let mut enigo = Enigo::new(&settings).map_err(|e| format!("Failed to create Enigo: {:?}", e))?;

    enigo.key(Key::Control, enigo::Direction::Press).ok();
    enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
    enigo.key(Key::Control, enigo::Direction::Release).ok();

    Ok(())
}

#[tauri::command]
fn check_accessibility(prompt: bool) -> bool {
    check_accessibility_permissions(prompt)
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map_err(|e| format!("Failed to open Accessibility settings: {}", e))?;
    }
    Ok(())
}

/// Execute paste via the platform-appropriate method with fallback.
/// `context` is a label for log messages (e.g. "Auto-paste", "Pure paste").
async fn execute_paste(context: &str) {
    let ctx = context.to_string();
    let paste_result = tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            match perform_paste_fallback() {
                Ok(()) => {
                    println!("[Dictato] {} (AppleScript)", ctx);
                    return Ok(());
                }
                Err(e) => {
                    println!(
                        "[Dictato] {} AppleScript failed: {}. Trying CGEvent...",
                        ctx, e
                    );
                }
            }
            match perform_paste() {
                Ok(()) => {
                    println!("[Dictato] {} (CGEvent)", ctx);
                    Ok(())
                }
                Err(e) => {
                    println!("[Dictato] {} CGEvent also failed: {}", ctx, e);
                    Err(e)
                }
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            match perform_paste() {
                Ok(()) => {
                    println!("[Dictato] {}", ctx);
                    Ok(())
                }
                Err(e) => Err(e),
            }
        }
    })
    .await;

    match paste_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            println!(
                "[Dictato] {} failed: {}. Text is in clipboard - press Cmd+V to paste.",
                context, e
            );
        }
        Err(e) => {
            println!(
                "[Dictato] {} task failed: {:?}. Text is in clipboard - press Cmd+V to paste.",
                context, e
            );
        }
    }
}

#[tauri::command]
async fn copy_and_paste(app: AppHandle, text: String) -> Result<(), String> {
    // Always copy to clipboard first
    app.clipboard()
        .write_text(&text)
        .map_err(|e| e.to_string())?;

    println!("[Dictato] Text copied to clipboard");

    // Check if auto-paste is enabled
    let auto_paste_enabled = get_store_string(&app, store_keys::AUTO_PASTE)
        .map(|v| v == "true")
        .unwrap_or(true); // Default to enabled

    if !auto_paste_enabled {
        println!("[Dictato] Auto-paste disabled. Press Cmd+V to paste.");
        return Ok(());
    }

    // Log accessibility status for diagnostics (but don't gate on it — the check can
    // return false even when the app actually has permission due to TCC/code-signing mismatches)
    #[cfg(target_os = "macos")]
    {
        let trusted = check_accessibility_permissions(false);
        println!("[Dictato] Accessibility check: trusted={}", trusted);
    }

    // Small delay to let clipboard propagate through the pasteboard system
    tokio::time::sleep(std::time::Duration::from_millis(CLIPBOARD_PROPAGATION_DELAY_MS)).await;

    execute_paste("Auto-paste").await;

    Ok(())
}

#[tauri::command]
fn unregister_shortcuts(app: AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn register_shortcut(app: AppHandle, shortcut_str: String) -> Result<(), String> {
    let shortcut: Shortcut = shortcut_str.parse().map_err(|e| format!("{:?}", e))?;

    // Unregister all shortcuts first to avoid duplicates
    app.global_shortcut().unregister_all().ok();

    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let app = app_clone.clone();
            tauri::async_runtime::spawn(async move {
                if IS_RECORDING.load(Ordering::SeqCst) {
                    if let Err(e) = stop_recording(app).await {
                        eprintln!("Failed to stop recording: {}", e);
                    }
                } else {
                    let stt_provider = get_stt_provider_from_store(&app);
                    let can_record = match stt_provider {
                        SttProvider::Local(model) => is_local_model_loaded(&app, model),
                        SttProvider::Groq => get_groq_api_key_from_store(&app).is_some(),
                    };

                    if can_record {
                        if let Err(e) = start_recording(app).await {
                            eprintln!("Failed to start recording: {}", e);
                        }
                    } else {
                        match stt_provider {
                            SttProvider::Local(model) => {
                                show_error(
                                    &app,
                                    &format!(
                                        "{} model not loaded. Download it in Settings → Models.",
                                        model.name()
                                    ),
                                );
                            }
                            SttProvider::Groq => {
                                show_error(&app, "No API key configured. Add your Groq API key in Settings.");
                            }
                        }
                    }
                }
            });
        })
        .map_err(|e| e.to_string())?;

    // Also re-register the pure paste shortcut (since unregister_all() cleared it)
    register_pure_paste_shortcut_internal(&app).ok();

    Ok(())
}

fn register_cancel_shortcut_internal(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    let shortcut: Shortcut = shortcut_str.parse().map_err(|e| format!("{:?}", e))?;

    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let app = app_clone.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = cancel_recording(app).await {
                    eprintln!("Failed to cancel recording: {}", e);
                }
            });
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn unregister_cancel_shortcut(app: &AppHandle) {
    let cancel_shortcut_str = get_cancel_shortcut_from_store(app);
    if let Ok(shortcut) = cancel_shortcut_str.parse::<Shortcut>() {
        app.global_shortcut().unregister(shortcut).ok();
    }
}

#[tauri::command]
async fn register_cancel_shortcut(app: AppHandle, shortcut_str: String) -> Result<(), String> {
    // Validate the shortcut format
    let _: Shortcut = shortcut_str.parse().map_err(|e| format!("{:?}", e))?;

    // If currently recording, re-register the cancel shortcut with the new value
    if IS_RECORDING.load(Ordering::SeqCst) {
        // Unregister old cancel shortcut
        unregister_cancel_shortcut(&app);
        // Register new one
        register_cancel_shortcut_internal(&app, &shortcut_str)?;
    }
    // Otherwise, the new shortcut will be used next time recording starts

    Ok(())
}

fn get_store_string(app: &AppHandle, key: &str) -> Option<String> {
    let store = app.store("settings.json").ok()?;
    store
        .get(key)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
}

fn get_groq_api_key_from_store(app: &AppHandle) -> Option<String> {
    get_store_string(app, store_keys::GROQ_API_KEY)
}

fn get_openai_api_key_from_store(app: &AppHandle) -> Option<String> {
    get_store_string(app, store_keys::OPENAI_API_KEY)
}

fn get_google_api_key_from_store(app: &AppHandle) -> Option<String> {
    get_store_string(app, store_keys::GOOGLE_API_KEY)
}

fn get_anthropic_api_key_from_store(app: &AppHandle) -> Option<String> {
    get_store_string(app, store_keys::ANTHROPIC_API_KEY)
}

fn get_llm_provider_from_store(app: &AppHandle) -> llm::LlmProvider {
    get_store_string(app, store_keys::LLM_PROVIDER)
        .map(|s| llm::LlmProvider::from_store_value(&s))
        .unwrap_or_default()
}

/// Get the API key for a hosted LLM provider
fn get_llm_api_key_for_provider(app: &AppHandle, provider: llm::CloudProvider) -> Option<String> {
    match provider {
        llm::CloudProvider::OpenAI => get_openai_api_key_from_store(app),
        llm::CloudProvider::Google => get_google_api_key_from_store(app),
        llm::CloudProvider::Anthropic => get_anthropic_api_key_from_store(app),
    }
    .filter(|k| !k.trim().is_empty())
}

/// Get the user-selected model for a hosted provider, falling back to the provider default
fn get_llm_model_for_provider(app: &AppHandle, provider: llm::CloudProvider) -> String {
    let key = match provider {
        llm::CloudProvider::OpenAI => store_keys::OPENAI_MODEL,
        llm::CloudProvider::Google => store_keys::GOOGLE_MODEL,
        llm::CloudProvider::Anthropic => store_keys::ANTHROPIC_MODEL,
    };
    get_store_string(app, key)
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| provider.default_model().to_string())
}

/// Turn the selected AI provider into something callable. The error is a
/// user-facing reason the provider can't be used right now (missing API
/// key, model not downloaded or still loading).
fn resolve_llm_backend(app: &AppHandle) -> Result<LlmBackend, String> {
    match get_llm_provider_from_store(app) {
        llm::LlmProvider::Cloud(provider) => {
            let api_key = get_llm_api_key_for_provider(app, provider).ok_or_else(|| {
                format!(
                    "No {} API key. Add it in Settings → General",
                    provider.display_name()
                )
            })?;
            let model = get_llm_model_for_provider(app, provider);
            Ok(LlmBackend::Cloud {
                provider,
                api_key,
                model,
            })
        }
        llm::LlmProvider::Local(model) => {
            let engine = app.state::<local_llm::LocalLlmState>().inner().clone();
            if !models::is_downloaded(app, model) {
                return Err(format!(
                    "{} is not downloaded. Get it in Settings → Models",
                    model.name()
                ));
            }
            if !local_llm::is_model_loaded(&engine, model) {
                if !models::is_loading(model) {
                    spawn_load_local_model(app, model);
                }
                return Err(format!("{} is still loading, try again in a moment", model.name()));
            }
            Ok(LlmBackend::Local { model, engine })
        }
    }
}

fn get_stt_provider_from_store(app: &AppHandle) -> SttProvider {
    get_store_string(app, store_keys::STT_PROVIDER)
        .map(|s| SttProvider::from_store_value(&s))
        .unwrap_or(SttProvider::Groq)
}

fn get_language_from_store(app: &AppHandle) -> String {
    get_store_string(app, store_keys::LANGUAGE).unwrap_or_else(|| "en".to_string())
}

fn get_cancel_shortcut_from_store(app: &AppHandle) -> String {
    get_store_string(app, store_keys::CANCEL_SHORTCUT).unwrap_or_else(|| "Escape".to_string())
}

fn get_dictionary_from_store(app: &AppHandle) -> Vec<String> {
    get_store_string(app, store_keys::DICTIONARY_WORDS)
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|w| w.trim().to_string())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Comma-separated glossary passed as Whisper's prompt: the decoder conditions
/// on it as preceding context, making these spellings more probable.
fn build_vocabulary_prompt(dictionary: &[String]) -> Option<String> {
    if dictionary.is_empty() {
        None
    } else {
        Some(format!("Glossary: {}.", dictionary.join(", ")))
    }
}

fn get_transcription_rules_from_store(app: &AppHandle) -> Vec<llm::TranscriptionRule> {
    get_store_string(app, store_keys::TRANSCRIPTION_RULES)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn should_skip_rules(app: &AppHandle) -> bool {
    get_store_string(app, store_keys::SKIP_RULES_ONCE)
        .map(|s| s == "true")
        .unwrap_or(false)
}

fn get_active_mode_from_store(app: &AppHandle) -> Option<String> {
    get_store_string(app, store_keys::ACTIVE_MODE).filter(|s| s != "none" && !s.is_empty())
}

#[derive(serde::Deserialize)]
struct CustomMode {
    id: String,
    prompt: String,
    #[serde(default)]
    name: String,
}

/// Get the prompt for the active mode (built-in or custom)
fn get_mode_prompt_from_store(app: &AppHandle, mode_id: &str) -> Option<String> {
    // Check built-in modes first
    match mode_id {
        "vibe-coding" => return Some(VIBE_CODING_PROMPT.to_string()),
        "professional-email" => return Some(PROFESSIONAL_EMAIL_PROMPT.to_string()),
        _ => {}
    }

    // Check custom modes
    if let Some(custom_modes_json) = get_store_string(app, store_keys::CUSTOM_MODES) {
        if let Ok(custom_modes) = serde_json::from_str::<Vec<CustomMode>>(&custom_modes_json) {
            if let Some(mode) = custom_modes.iter().find(|m| m.id == mode_id) {
                if !mode.prompt.is_empty() {
                    return Some(mode.prompt.clone());
                }
            }
        }
    }

    None
}

/// Display name for a mode, used to label dictation history entries
fn get_mode_name_from_store(app: &AppHandle, mode_id: &str) -> String {
    match mode_id {
        "vibe-coding" => return "Vibe Coding".to_string(),
        "professional-email" => return "Professional Email".to_string(),
        _ => {}
    }

    get_store_string(app, store_keys::CUSTOM_MODES)
        .and_then(|s| serde_json::from_str::<Vec<CustomMode>>(&s).ok())
        .and_then(|modes| {
            modes
                .iter()
                .find(|m| m.id == mode_id)
                .map(|m| m.name.clone())
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| mode_id.to_string())
}

/// Append a voice dictation to the persisted history (raw vs processed text),
/// newest first, capped at MAX_DICTATION_HISTORY entries.
fn add_dictation_to_history(
    app: &AppHandle,
    raw_text: &str,
    processed_text: &str,
    kind: &str,
    label: Option<&str>,
) {
    let Ok(store) = app.store("settings.json") else {
        return;
    };

    let mut history: Vec<serde_json::Value> = store
        .get(store_keys::DICTATION_HISTORY)
        .and_then(|v| v.as_str().map(String::from))
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    history.insert(
        0,
        serde_json::json!({
            "id": format!("dictation-{}", timestamp),
            "timestamp": timestamp,
            "rawText": raw_text,
            "processedText": processed_text,
            "kind": kind,
            "label": label,
        }),
    );
    history.truncate(MAX_DICTATION_HISTORY);

    if let Ok(json) = serde_json::to_string(&history) {
        store.set(store_keys::DICTATION_HISTORY, serde_json::json!(json));
        store.save().ok();
        app.emit("dictation-history-updated", ()).ok();
    }
}

fn get_pure_paste_shortcut_from_store(app: &AppHandle) -> String {
    get_store_string(app, store_keys::PURE_PASTE_SHORTCUT)
        .unwrap_or_else(|| DEFAULT_PURE_PASTE_SHORTCUT.to_string())
}

fn is_pure_paste_enabled(app: &AppHandle) -> bool {
    get_store_string(app, store_keys::PURE_PASTE_ENABLED)
        .map(|v| v == "true")
        .unwrap_or(false)
}

async fn pure_paste(app: AppHandle) -> Result<(), String> {
    let text = match app.clipboard().read_text() {
        Ok(t) if !t.is_empty() => t,
        _ => {
            println!("[Dictato] Pure paste: clipboard empty or non-text, no-op");
            return Ok(());
        }
    };

    // Re-write as plain text only (strips rich formatting representations)
    app.clipboard()
        .write_text(&text)
        .map_err(|e| e.to_string())?;

    println!(
        "[Dictato] Pure paste: wrote plain text back to clipboard ({} chars)",
        text.len()
    );

    // Small delay to let clipboard propagate through the pasteboard system
    tokio::time::sleep(std::time::Duration::from_millis(CLIPBOARD_PROPAGATION_DELAY_MS)).await;

    execute_paste("Pure paste").await;

    Ok(())
}

/// Atomically unregister the old pure-paste shortcut and (if enabled) register
/// the current one.  Holds the mutex across both operations to prevent races.
fn register_pure_paste_shortcut_internal(app: &AppHandle) -> Result<(), String> {
    let mut guard = REGISTERED_PURE_PASTE_SHORTCUT
        .lock()
        .map_err(|e| format!("Mutex poisoned: {}", e))?;

    // Unregister the previous shortcut if any
    if let Some(ref old_str) = *guard {
        if let Ok(old) = old_str.parse::<Shortcut>() {
            app.global_shortcut().unregister(old).ok();
        }
    }
    *guard = None;

    if !is_pure_paste_enabled(app) {
        return Ok(());
    }

    let shortcut_str = get_pure_paste_shortcut_from_store(app);
    let shortcut: Shortcut = shortcut_str.parse().map_err(|e| format!("{:?}", e))?;

    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let app = app_clone.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = pure_paste(app).await {
                    eprintln!("Pure paste failed: {}", e);
                }
            });
        })
        .map_err(|e| e.to_string())?;

    *guard = Some(shortcut_str);

    Ok(())
}

#[tauri::command]
async fn update_pure_paste_shortcut(app: AppHandle) -> Result<(), String> {
    register_pure_paste_shortcut_internal(&app)
}

#[tauri::command]
fn get_recording_state() -> bool {
    IS_RECORDING.load(Ordering::SeqCst)
}

fn get_floating_position_from_store(app: &AppHandle) -> Option<(f64, f64)> {
    let store = app.store("settings.json").ok()?;
    let x = store.get(store_keys::FLOATING_X).and_then(|v| v.as_f64());
    let y = store.get(store_keys::FLOATING_Y).and_then(|v| v.as_f64());
    match (x, y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    }
}

#[tauri::command]
fn save_floating_position(app: AppHandle, x: f64, y: f64) {
    if let Ok(store) = app.store("settings.json") {
        store.set(store_keys::FLOATING_X, serde_json::json!(x));
        store.set(store_keys::FLOATING_Y, serde_json::json!(y));
        store.save().ok();
    }
}

#[tauri::command]
fn resize_floating_window(app: AppHandle, width: f64, height: f64) {
    if let Some(window) = app.get_webview_window("floating") {
        let scale = window.scale_factor().unwrap_or(1.0);
        // Keep the horizontal center fixed so the pill doesn't shift when its
        // content width changes (e.g. bars -> processing spinner).
        let recentered = window
            .outer_position()
            .ok()
            .zip(window.outer_size().ok())
            .map(|(pos, size)| {
                let old_width = size.width as f64 / scale;
                let x = pos.x as f64 / scale + (old_width - width) / 2.0;
                let y = pos.y as f64 / scale;
                (x, y)
            });
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
            .ok();
        if let Some((x, y)) = recentered {
            window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
                .ok();
        }
    }
}

#[tauri::command]
async fn generate_mode_prompt(app: AppHandle, name: String, description: String) -> Result<String, String> {
    let backend = resolve_llm_backend(&app)
        .map_err(|reason| format!("{} (needed for prompt generation)", reason))?;
    llm::generate_mode_prompt(&backend, &name, &description).await
}

/// List selectable chat models for a hosted provider, fetched live from its
/// API. Uses the API key stored in settings for that provider.
#[tauri::command]
async fn list_llm_models(app: AppHandle, provider: String) -> Result<Vec<llm::ModelInfo>, String> {
    let provider = llm::CloudProvider::from_id(&provider)
        .ok_or_else(|| format!("Unknown LLM provider: {}", provider))?;
    let api_key = get_llm_api_key_for_provider(&app, provider)
        .ok_or_else(|| format!("{} API key required to list models. Add it in Settings.", provider.display_name()))?;
    llm::list_models(provider, &api_key).await
}

// ============== API Key Validation commands ==============

#[tauri::command]
async fn validate_groq_key(api_key: String) -> Result<(), String> {
    groq::validate_groq_key(&api_key).await
}

#[tauri::command]
async fn validate_openai_key(api_key: String) -> Result<(), String> {
    llm::validate_openai_key(&api_key).await
}

#[tauri::command]
async fn validate_google_key(api_key: String) -> Result<(), String> {
    llm::validate_google_key(&api_key).await
}

#[tauri::command]
async fn validate_anthropic_key(api_key: String) -> Result<(), String> {
    llm::validate_anthropic_key(&api_key).await
}

// ============== Local model commands ==============

fn is_local_model_loaded(app: &AppHandle, model: LocalModel) -> bool {
    match model.kind() {
        ModelKind::Stt => whisper::is_model_loaded(&app.state::<whisper::WhisperState>()),
        ModelKind::Llm => local_llm::is_model_loaded(&app.state::<local_llm::LocalLlmState>(), model),
    }
}

/// Blocking: read `model` from disk into memory.
fn load_local_model_blocking(app: &AppHandle, model: LocalModel) -> Result<(), String> {
    let dir = models::model_dir(app, model)?;
    match model.kind() {
        ModelKind::Stt => whisper::load_model(&app.state::<whisper::WhisperState>(), &dir),
        ModelKind::Llm => local_llm::load_model(&app.state::<local_llm::LocalLlmState>(), model, &dir),
    }
}

fn unload_local_model(app: &AppHandle, model: LocalModel) {
    match model.kind() {
        ModelKind::Stt => whisper::unload_model(&app.state::<whisper::WhisperState>()),
        ModelKind::Llm => {
            let state = app.state::<local_llm::LocalLlmState>();
            // One engine holds one LLM; only drop it if it's this model.
            if local_llm::is_model_loaded(&state, model) {
                local_llm::unload_model(&state);
            }
        }
    }
}

/// Blocking: run inference on 16 kHz mono samples.
fn transcribe_local_blocking(
    app: &AppHandle,
    model: LocalModel,
    samples: &[f32],
    language: &str,
    vocabulary_prompt: Option<&str>,
) -> Result<String, String> {
    match model {
        LocalModel::Whisper => whisper::transcribe(
            &app.state::<whisper::WhisperState>(),
            samples,
            language,
            vocabulary_prompt,
        ),
        other => Err(format!("{} is not a speech-to-text model", other.name())),
    }
}

/// Run local inference off the async runtime. The in-use flag blocks
/// model deletion while inference holds the model.
async fn run_local_transcription(
    app: &AppHandle,
    model: LocalModel,
    samples: Vec<f32>,
    language: String,
    vocabulary_prompt: Option<String>,
) -> Result<String, String> {
    models::set_in_use(model, true);
    let app_clone = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        transcribe_local_blocking(
            &app_clone,
            model,
            &samples,
            &language,
            vocabulary_prompt.as_deref(),
        )
    })
    .await;
    models::set_in_use(model, false);
    result.map_err(|e| format!("Transcription task failed: {}", e))?
}

/// Load `model` on a background thread, flagging progress for the UI.
fn spawn_load_local_model(app: &AppHandle, model: LocalModel) {
    if is_local_model_loaded(app, model) || models::is_loading(model) {
        return;
    }
    models::set_loading(model, true);
    models::emit_changed(app);
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = load_local_model_blocking(&app, model) {
            eprintln!("[{}] Failed to load model: {}", model.name(), e);
        }
        models::set_loading(model, false);
        models::emit_changed(&app);
    });
}

/// Make `selected` the only loaded model of its kind: unload the others to
/// free memory and load it if it's on disk.
fn activate_local_model(app: &AppHandle, kind: ModelKind, selected: Option<LocalModel>) {
    for model in LocalModel::of_kind(kind) {
        if Some(model) != selected {
            unload_local_model(app, model);
        }
    }
    if let Some(model) = selected {
        if models::is_downloaded(app, model) {
            spawn_load_local_model(app, model);
        }
    }
    models::emit_changed(app);
}

fn activate_provider(app: &AppHandle, provider: SttProvider) {
    activate_local_model(app, ModelKind::Stt, provider.local_model());
}

fn parse_model_id(model_id: &str) -> Result<LocalModel, String> {
    LocalModel::from_id(model_id).ok_or_else(|| format!("Unknown model: {}", model_id))
}

fn is_accelerator_active(app: &AppHandle, model: LocalModel) -> bool {
    match model {
        LocalModel::Whisper => whisper::is_coreml_active(&app.state::<whisper::WhisperState>()),
        _ => false,
    }
}

#[tauri::command]
fn get_local_models_status(app: AppHandle) -> Vec<models::LocalModelStatus> {
    LocalModel::ALL
        .iter()
        .map(|&model| {
            models::status(
                &app,
                model,
                is_local_model_loaded(&app, model),
                is_accelerator_active(&app, model),
            )
        })
        .collect()
}

/// Load the model if it's the selected provider of its kind; used after downloads.
fn load_if_selected(app: &AppHandle, model: LocalModel) {
    let selected = match model.kind() {
        ModelKind::Stt => get_stt_provider_from_store(app).local_model(),
        ModelKind::Llm => get_llm_provider_from_store(app).local_model(),
    };
    if selected == Some(model) {
        spawn_load_local_model(app, model);
    }
}

#[tauri::command]
async fn download_local_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let model = parse_model_id(&model_id)?;
    models::download(app.clone(), model, false).await?;
    load_if_selected(&app, model);
    Ok(())
}

/// Fetch the optional accelerator and reload the engine so it picks it up.
#[tauri::command]
async fn download_model_accelerator(app: AppHandle, model_id: String) -> Result<(), String> {
    let model = parse_model_id(&model_id)?;
    if IS_RECORDING.load(Ordering::SeqCst) || models::is_in_use(model) {
        return Err("Cannot change models during active recording or processing".to_string());
    }
    models::download(app.clone(), model, true).await?;
    unload_local_model(&app, model);
    load_if_selected(&app, model);
    models::emit_changed(&app);
    Ok(())
}

#[tauri::command]
async fn delete_model_accelerator(app: AppHandle, model_id: String) -> Result<(), String> {
    let model = parse_model_id(&model_id)?;
    if IS_RECORDING.load(Ordering::SeqCst) || models::is_in_use(model) {
        return Err("Cannot change models during active recording or processing".to_string());
    }
    unload_local_model(&app, model);
    models::delete_accelerator(&app, model)?;
    load_if_selected(&app, model);
    models::emit_changed(&app);
    Ok(())
}

#[tauri::command]
fn cancel_local_model_download(model_id: String) -> Result<(), String> {
    models::cancel_download(parse_model_id(&model_id)?);
    Ok(())
}

#[tauri::command]
async fn delete_local_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let model = parse_model_id(&model_id)?;
    if IS_RECORDING.load(Ordering::SeqCst) || models::is_in_use(model) {
        return Err("Cannot delete a model while it is recording or processing".to_string());
    }
    if models::is_downloading(model) {
        return Err("Cancel the download first".to_string());
    }
    unload_local_model(&app, model);
    models::delete(&app, model)?;
    models::emit_changed(&app);
    Ok(())
}

/// Called by the frontend after it persists a new STT provider.
#[tauri::command]
async fn activate_stt_provider(app: AppHandle, provider: String) {
    activate_provider(&app, SttProvider::from_store_value(&provider));
}

/// Called by the frontend after it persists a new AI processing provider.
/// Loads the local model when one is picked and frees it when switching to
/// a hosted provider.
#[tauri::command]
async fn activate_llm_provider(app: AppHandle, provider: String) {
    let provider = llm::LlmProvider::from_store_value(&provider);
    activate_local_model(&app, ModelKind::Llm, provider.local_model());
}

// ============== Autostart commands (Windows only) ==============

#[tauri::command]
#[cfg(target_os = "windows")]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())
    } else {
        autostart.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
fn set_autostart(_app: AppHandle, _enabled: bool) -> Result<(), String> {
    // No-op on non-Windows platforms
    Ok(())
}

#[tauri::command]
#[cfg(target_os = "windows")]
fn get_autostart(app: AppHandle) -> Result<bool, String> {
    let autostart = app.autolaunch();
    autostart.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
fn get_autostart(_app: AppHandle) -> Result<bool, String> {
    // Always return false on non-Windows platforms
    Ok(false)
}

// ============== Transcribe commands ==============

/// Progress stages for transcription
mod progress_stages {
    pub const PREPARING: &str = "preparing";
    pub const EXTRACTING: &str = "extracting";
    pub const SPLITTING: &str = "splitting";
    pub const TRANSCRIBING: &str = "transcribing";
    pub const DOWNLOADING: &str = "downloading";
    pub const PROCESSING: &str = "processing";
    pub const COMPLETE: &str = "complete";
}

/// Progress percentages for transcription stages
mod progress_percent {
    pub const PREPARING: u32 = 0;
    pub const EXTRACTING: u32 = 10;
    pub const SPLITTING: u32 = 20;
    pub const TRANSCRIBE_START: u32 = 30;
    pub const TRANSCRIBE_SINGLE: u32 = 50;
    pub const PROCESSING: u32 = 85;
    pub const COMPLETE: u32 = 100;
    pub const YOUTUBE_START: u32 = 5;
    pub const YOUTUBE_DOWNLOAD_COMPLETE: u32 = 40;
}

/// Helper function to emit transcription progress events
fn emit_transcribe_progress(app: &AppHandle, stage: &str, percent: u32, message: &str) {
    app.emit("transcribe-progress", serde_json::json!({
        "stage": stage,
        "percent": percent,
        "message": message
    })).ok();
}

#[tauri::command]
fn check_transcribe_dependencies() -> transcribe::DependencyStatus {
    transcribe::check_dependencies()
}

#[tauri::command]
async fn transcribe_file(
    app: AppHandle,
    file_path: String,
    language: String,
    mode_id: Option<String>,
    apply_rules: bool,
) -> Result<transcribe::TranscriptionResult, String> {
    use std::path::Path;

    let path = Path::new(&file_path);

    // Validate file exists
    if !path.exists() {
        return Err("File not found".to_string());
    }

    // Validate format
    if !transcribe::is_supported_format(path) {
        return Err("Unsupported file format. Supported: MP3, WAV, M4A, OGG, FLAC, MP4, MOV, WebM".to_string());
    }

    let stt_provider = get_stt_provider_from_store(&app);
    let llm_backend = resolve_llm_backend(&app);
    let dictionary = get_dictionary_from_store(&app);
    let vocabulary_prompt = build_vocabulary_prompt(&dictionary);

    emit_transcribe_progress(&app, progress_stages::PREPARING, progress_percent::PREPARING, "Preparing file...");

    // Create temp dir for processing
    let temp_dir = transcribe::create_temp_dir()?;
    let temp_path = temp_dir.path();

    // Get audio file path (extract from video if needed)
    let audio_path = if transcribe::is_supported_video(path) {
        emit_transcribe_progress(&app, progress_stages::EXTRACTING, progress_percent::EXTRACTING, "Extracting audio from video...");

        transcribe::extract_audio_from_video(path, temp_path)?
    } else {
        path.to_path_buf()
    };

    // Get duration for stats
    let duration = transcribe::get_audio_duration(&audio_path).unwrap_or(0.0);

    // Transcribe using the selected STT provider
    let raw_text = if let Some(model) = stt_provider.local_model() {
        emit_transcribe_progress(
            &app,
            progress_stages::TRANSCRIBING,
            progress_percent::TRANSCRIBE_SINGLE,
            &format!("Transcribing locally with {}...", model.name()),
        );

        // Local engines take 16 kHz mono PCM; ffmpeg normalizes whatever came in
        let wav_path = transcribe::convert_to_wav_16k(&audio_path, temp_path)?;
        let samples = local_audio::read_wav_as_f32_16k(&wav_path)?;
        run_local_transcription(&app, model, samples, language.clone(), vocabulary_prompt.clone())
            .await?
    } else {
        let groq_api_key = get_groq_api_key_from_store(&app)
            .ok_or("Groq API key required. Add it in Settings.")?;

        if transcribe::needs_chunking(&audio_path)? {
            emit_transcribe_progress(&app, progress_stages::SPLITTING, progress_percent::SPLITTING, "Splitting large file...");

            let chunks = transcribe::split_audio_file(&audio_path, temp_path, transcribe::CHUNK_DURATION_SECONDS)?;
            let total_chunks = chunks.len();
            let mut transcripts = Vec::new();

            for (i, chunk_path) in chunks.iter().enumerate() {
                let progress = progress_percent::TRANSCRIBE_START + ((i as f32 / total_chunks as f32) * 50.0) as u32;
                emit_transcribe_progress(&app, progress_stages::TRANSCRIBING, progress, "Transcribing audio...");

                let chunk_text = groq::transcribe_file(&groq_api_key, chunk_path, &language, vocabulary_prompt.as_deref()).await?;
                transcripts.push(chunk_text);
            }

            transcripts.join(" ")
        } else {
            emit_transcribe_progress(&app, progress_stages::TRANSCRIBING, progress_percent::TRANSCRIBE_SINGLE, "Transcribing audio...");

            groq::transcribe_file(&groq_api_key, &audio_path, &language, vocabulary_prompt.as_deref()).await?
        }
    };

    // Apply mode or rules if requested
    let processed_text = if !raw_text.is_empty() {
        if let Some(ref mode) = mode_id {
            if let Some(prompt) = get_mode_prompt_from_store(&app, mode) {
                if let Ok(ref backend) = llm_backend {
                    emit_transcribe_progress(&app, progress_stages::PROCESSING, progress_percent::PROCESSING, "Applying mode...");

                    match llm::process_with_prompt(backend, &raw_text, &prompt, &language, &dictionary).await {
                        Ok(processed) => Some(processed),
                        Err(_) => None,
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else if apply_rules {
            let rules = get_transcription_rules_from_store(&app);
            let has_enabled_rules = rules.iter().any(|r| r.enabled);
            if has_enabled_rules {
                if let Ok(ref backend) = llm_backend {
                    emit_transcribe_progress(&app, progress_stages::PROCESSING, progress_percent::PROCESSING, "Applying rules...");

                    match llm::process_with_rules(backend, &raw_text, rules, &language, &dictionary).await {
                        Ok(processed) => Some(processed),
                        Err(_) => None,
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    emit_transcribe_progress(&app, progress_stages::COMPLETE, progress_percent::COMPLETE, "Complete!");

    let final_text = processed_text.as_ref().unwrap_or(&raw_text);
    let word_count = final_text.split_whitespace().count();

    Ok(transcribe::TranscriptionResult {
        raw_text,
        processed_text,
        duration_seconds: duration,
        word_count,
    })
}

#[tauri::command]
async fn transcribe_youtube(
    app: AppHandle,
    url: String,
    language: String,
    mode_id: Option<String>,
    apply_rules: bool,
) -> Result<transcribe::TranscriptionResult, String> {
    println!("[YouTube] Starting transcription for: {}", url);

    // Validate URL
    if !transcribe::is_valid_youtube_url(&url) {
        println!("[YouTube] Invalid URL: {}", url);
        return Err("Invalid YouTube URL".to_string());
    }

    // Check dependencies
    println!("[YouTube] Checking dependencies...");
    let deps = transcribe::check_dependencies();
    if !deps.yt_dlp_installed {
        println!("[YouTube] yt-dlp not found!");
        return Err("yt-dlp is not installed. Please install it to use YouTube transcription.".to_string());
    }
    if !deps.ffmpeg_installed {
        println!("[YouTube] ffmpeg not found!");
        return Err("ffmpeg is not installed. Please install it to use YouTube transcription.".to_string());
    }
    println!("[YouTube] Dependencies OK: yt-dlp={:?}, ffmpeg={:?}", deps.yt_dlp_version, deps.ffmpeg_version);

    // Validate STT provider is ready
    let stt_provider = get_stt_provider_from_store(&app);
    match stt_provider {
        SttProvider::Local(model) => {
            if !is_local_model_loaded(&app, model) {
                return Err(format!(
                    "{} model not loaded. Download it in Settings → Models.",
                    model.name()
                ));
            }
        }
        SttProvider::Groq => {
            get_groq_api_key_from_store(&app)
                .ok_or("Groq API key required. Add it in Settings.")?;
        }
    }

    emit_transcribe_progress(&app, progress_stages::DOWNLOADING, progress_percent::YOUTUBE_START, "Starting YouTube download...");

    // Create temp dir for processing
    println!("[YouTube] Creating temp directory...");
    let temp_dir = transcribe::create_temp_dir()?;
    let temp_path = temp_dir.path().to_path_buf();
    println!("[YouTube] Temp dir: {:?}", temp_path);

    // Download audio with progress callback
    let app_clone = app.clone();
    let progress_callback: transcribe::ProgressCallback = Box::new(move |percent, _message| {
        // Scale download progress from YOUTUBE_START to YOUTUBE_DOWNLOAD_COMPLETE
        let scaled_percent = progress_percent::YOUTUBE_START as f32 + (percent * 0.35);
        emit_transcribe_progress(
            &app_clone,
            progress_stages::DOWNLOADING,
            scaled_percent as u32,
            &format!("Downloading: {:.0}%", percent)
        );
    });

    println!("[YouTube] Starting download...");
    let audio_path = transcribe::download_youtube_audio_with_progress(&url, &temp_path, Some(progress_callback))?;
    println!("[YouTube] Download complete: {:?}", audio_path);

    emit_transcribe_progress(&app, progress_stages::DOWNLOADING, progress_percent::YOUTUBE_DOWNLOAD_COMPLETE, "Download complete, preparing for transcription...");

    // Now process like a regular file
    let file_path = audio_path.to_string_lossy().to_string();
    transcribe_file(app, file_path, language, mode_id, apply_rules).await
}

fn create_floating_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("floating").is_some() {
        return Ok(());
    }

    #[allow(unused_mut)]
    let mut builder =
        WebviewWindowBuilder::new(app, "floating", WebviewUrl::App("/?window=floating".into()))
            .title("Whisper")
            .inner_size(FLOATING_WINDOW_WIDTH, FLOATING_WINDOW_HEIGHT)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .visible(false)
            .transparent(true);

    // Disable shadow to fix transparency on Windows and macOS
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        builder = builder.shadow(false);
    }

    let window = builder.build().map_err(|e| e.to_string())?;

    // Use saved position or default to centered at top
    if let Some((x, y)) = get_floating_position_from_store(app) {
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
            .ok();
    } else if let Ok(Some(monitor)) = window.primary_monitor() {
        let screen_width = monitor.size().width as f64 / monitor.scale_factor();
        let x = (screen_width - FLOATING_WINDOW_WIDTH) / 2.0;
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition {
                x,
                y: FLOATING_WINDOW_DEFAULT_Y,
            }))
            .ok();
    }

    Ok(())
}

const CLEANING_GRACE_MS: u64 = 3_000;
const CLEANING_GRACE_TICK_MS: u64 = 50;

fn create_cleaning_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("cleaning") {
        window.show().ok();
        window.set_focus().ok();
        return Ok(());
    }

    let (width, height) = {
        if let Some(monitor) = app
            .get_webview_window("main")
            .and_then(|w| w.primary_monitor().ok().flatten())
        {
            let scale = monitor.scale_factor();
            (
                monitor.size().width as f64 / scale,
                monitor.size().height as f64 / scale,
            )
        } else {
            (1440.0, 900.0)
        }
    };

    let builder =
        WebviewWindowBuilder::new(app, "cleaning", WebviewUrl::App("/?window=cleaning".into()))
            .title("Cleaning Mode")
            .inner_size(width, height)
            .position(0.0, 0.0)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(true)
            .visible(true);

    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

fn close_cleaning_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("cleaning") {
        window.close().ok();
    }
}

#[tauri::command]
async fn engage_cleaning_mode(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !check_accessibility_permissions(true) {
            return Err("Accessibility permission required. Grant it in System Settings → Privacy & Security → Accessibility, then try again.".into());
        }
    }

    create_cleaning_window(&app)?;

    // Grace countdown: user lifts hands before the tap engages.
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let start = std::time::Instant::now();
        let total = std::time::Duration::from_millis(CLEANING_GRACE_MS);
        loop {
            let elapsed = start.elapsed();
            let pct = ((elapsed.as_millis() as u64 * 100) / CLEANING_GRACE_MS).min(100) as u32;
            app_clone.emit("cleaning-grace-progress", pct).ok();
            if elapsed >= total {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(CLEANING_GRACE_TICK_MS)).await;
        }

        let state = app_clone.state::<keyboard_lock::LockState>();
        if let Err(e) = keyboard_lock::engage(app_clone.clone(), &state) {
            eprintln!("[CleaningMode] Failed to engage: {e}");
            app_clone.emit("cleaning-mode-error", e).ok();
            close_cleaning_window(&app_clone);
        }
    });

    Ok(())
}

#[tauri::command]
fn close_cleaning_overlay(
    app: AppHandle,
    state: tauri::State<'_, keyboard_lock::LockState>,
) -> Result<(), String> {
    keyboard_lock::disengage(&state);
    close_cleaning_window(&app);
    Ok(())
}

#[tauri::command]
fn get_cleaning_mode_state(state: tauri::State<'_, keyboard_lock::LockState>) -> bool {
    keyboard_lock::is_active(&state)
}

fn expand_floating_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("floating") {
        window.show().ok();
        app.emit("floating-expanded", true).ok();
    }
    Ok(())
}

/// Format LLM API error into a user-friendly message
fn format_llm_error(error: &str) -> String {
    // Local engine errors are already written for the user
    if error.contains("Local model") || error.contains("Transcript too long") {
        return error.to_string();
    }
    // Check for common error patterns and provide user-friendly messages
    if error.contains("429") || error.contains("RESOURCE_EXHAUSTED") || error.contains("quota") {
        return "API quota exceeded. Check your plan and billing.".to_string();
    }
    if error.contains("401") || error.contains("Unauthorized") || error.contains("invalid_api_key") {
        return "Invalid API key. Check your key in Settings.".to_string();
    }
    if error.contains("403") || error.contains("Forbidden") {
        return "API access denied. Check your API key permissions.".to_string();
    }
    if error.contains("timeout") || error.contains("Timeout") {
        return "Request timed out. Try again.".to_string();
    }
    if error.contains("500") || error.contains("502") || error.contains("503") {
        return "API service error. Try again later.".to_string();
    }
    // Default: show a generic message
    "Processing failed. Check your API key and try again.".to_string()
}

fn show_error(app: &AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("floating") {
        window.show().ok();
        app.emit("floating-expanded", true).ok();
        app.emit("transcription-error", message).ok();

        // Auto-hide after 3 seconds
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            if let Some(window) = app_clone.get_webview_window("floating") {
                window.hide().ok();
                app_clone.emit("floating-expanded", false).ok();
            }
        });
    }
}

fn collapse_floating_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("floating") {
        window.hide().ok();
        app.emit("floating-expanded", false).ok();
    }
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        window.show().ok();
        window.set_focus().ok();
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().ok();
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let icon = match app.default_window_icon() {
        Some(icon) => icon.clone(),
        None => return Ok(()),
    };

    let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let cleaning_item = MenuItem::with_id(
        app,
        "cleaning_mode",
        "Start Cleaning Mode",
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &cleaning_item, &quit_item])?;

    let _ = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Dictato")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                show_main_window(app);
            }
            "cleaning_mode" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = engage_cleaning_mode(app_handle.clone()).await {
                        eprintln!("[CleaningMode] Tray activation failed: {e}");
                        app_handle.emit("cleaning-mode-error", e).ok();
                    }
                });
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app);

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    // Autostart plugin only on Windows
    #[cfg(target_os = "windows")]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .manage(GroqState::default())
        .manage(AudioCaptureState::default())
        .manage(whisper::WhisperState::default())
        .manage(local_llm::LocalLlmState::default())
        .manage(keyboard_lock::LockState::default())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            cancel_recording,
            copy_and_paste,
            check_accessibility,
            open_accessibility_settings,
            register_shortcut,
            register_cancel_shortcut,
            unregister_shortcuts,
            update_pure_paste_shortcut,
            get_recording_state,
            list_audio_devices,
            save_floating_position,
            resize_floating_window,
            generate_mode_prompt,
            list_llm_models,
            validate_groq_key,
            validate_openai_key,
            validate_google_key,
            validate_anthropic_key,
            set_autostart,
            get_autostart,
            check_transcribe_dependencies,
            transcribe_file,
            transcribe_youtube,
            get_local_models_status,
            download_local_model,
            download_model_accelerator,
            delete_model_accelerator,
            cancel_local_model_download,
            delete_local_model,
            activate_stt_provider,
            activate_llm_provider,
            engage_cleaning_mode,
            get_cleaning_mode_state,
            close_cleaning_overlay,
        ])
        .setup(|app| {
            // Hide app from macOS dock (stealth mode - tray icon only)
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            setup_tray(app.handle())?;
            create_floating_window(app.handle()).ok();

            // Register pure paste shortcut on startup (if previously enabled)
            register_pure_paste_shortcut_internal(app.handle()).ok();

            // Load the selected local model in the background; open Settings
            // when the provider isn't usable yet so the user can fix it.
            let stt_provider = get_stt_provider_from_store(app.handle());
            let ready = match stt_provider {
                SttProvider::Local(model) => {
                    if models::is_downloaded(app.handle(), model) {
                        spawn_load_local_model(app.handle(), model);
                        true
                    } else {
                        false
                    }
                }
                SttProvider::Groq => get_groq_api_key_from_store(app.handle()).is_some(),
            };
            if !ready {
                show_main_window(app.handle());
            }

            // Warm up the local AI model too so the first dictation isn't
            // delayed by a multi-second load.
            if let Some(model) = get_llm_provider_from_store(app.handle()).local_model() {
                if models::is_downloaded(app.handle(), model) {
                    spawn_load_local_model(app.handle(), model);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                if label == "main" {
                    api.prevent_close();
                    hide_main_window(app);
                }
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Moved(_),
                ..
            } => {
                if label == "floating" {
                    // Save logical position for consistent storage
                    if let Some(window) = app.get_webview_window("floating") {
                        if let Ok(pos) = window.outer_position() {
                            let scale = window.scale_factor().unwrap_or(1.0);
                            let x = pos.x as f64 / scale;
                            let y = pos.y as f64 / scale;
                            if let Ok(store) = app.store("settings.json") {
                                store.set(store_keys::FLOATING_X, serde_json::json!(x));
                                store.set(store_keys::FLOATING_Y, serde_json::json!(y));
                            }
                        }
                    }
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                show_main_window(app);
            }
            RunEvent::Exit => {
                let state = app.state::<keyboard_lock::LockState>();
                keyboard_lock::disengage(&state);
            }
            _ => {}
        });
}
