mod audio;
mod groq;
mod llm;

use audio::{AudioCaptureHandle, AudioDevice};
#[cfg(not(target_os = "macos"))]
use enigo::{Enigo, Key, Keyboard, Settings};
use groq::GroqState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

// Floating window constants
const FLOATING_WINDOW_WIDTH: f64 = 320.0;
const FLOATING_WINDOW_HEIGHT: f64 = 280.0;
const FLOATING_WINDOW_DEFAULT_Y: f64 = 8.0;

// Audio processing constants
const AUDIO_STOP_DRAIN_MS: u64 = 150; // Time to let receiver threads drain after audio stop

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
    pub const LANGUAGE: &str = "language";
    pub const CANCEL_SHORTCUT: &str = "cancelShortcut";
    pub const AUTO_PASTE: &str = "autoPaste";
    pub const MICROPHONE_DEVICE_ID: &str = "microphoneDeviceId";
    pub const ACTIVE_MODE: &str = "activeMode";
    pub const STATS_TOTAL_WORDS: &str = "statsTotalWords";
    pub const STATS_TOTAL_TRANSCRIPTIONS: &str = "statsTotalTranscriptions";
    pub const STATS_TOTAL_TIME_SAVED_SECONDS: &str = "statsTotalTimeSavedSeconds";
}

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

static IS_RECORDING: AtomicBool = AtomicBool::new(false);

pub struct AudioCaptureState {
    handle: AudioCaptureHandle,
}

impl Default for AudioCaptureState {
    fn default() -> Self {
        Self {
            handle: AudioCaptureHandle::new(),
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
    std::thread::spawn(move || {
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

    // Stop native audio capture
    let audio_state = app.state::<AudioCaptureState>();
    audio_state.handle.stop();

    // Allow receiver threads to drain remaining audio data
    tokio::time::sleep(std::time::Duration::from_millis(AUDIO_STOP_DRAIN_MS)).await;

    let groq_state = app.state::<GroqState>();
    let audio_data = groq_state.get_buffer()?;

    println!("[Dictato] Audio buffer size: {} bytes", audio_data.len());

    groq_state.clear_buffer();

    let groq_api_key = get_groq_api_key_from_store(&app).unwrap_or_default();
    let openai_api_key = get_openai_api_key_from_store(&app);
    let language = get_language_from_store(&app);
    let transcript = if audio_data.is_empty() || groq_api_key.is_empty() {
        println!(
            "[Dictato] Skipping transcription: audio_empty={}, groq_api_key_empty={}",
            audio_data.is_empty(),
            groq_api_key.is_empty()
        );
        String::new()
    } else {
        println!("[Dictato] Sending {} bytes to Groq API", audio_data.len());
        app.emit("processing-state", true).ok();
        let result = groq::transcribe(&groq_api_key, audio_data, &language).await;
        match result {
            Ok(text) => text,
            Err(e) => {
                app.emit("processing-state", false).ok();
                return Err(e);
            }
        }
    };

    // Apply mode transformation or rules (modes take priority over rules)
    // Uses OpenAI API for LLM operations
    let mut had_openai_error = false;
    let final_text = if !transcript.is_empty() {
        let skip_rules = should_skip_rules(&app);
        if skip_rules {
            println!("[Dictato] Transformation skipped for this recording");
            transcript
        } else if let Some(mode_id) = get_active_mode_from_store(&app) {
            // Mode is active - get prompt and apply transformation (rules are ignored)
            if let Some(prompt) = get_mode_prompt_from_store(&app, &mode_id) {
                // Check for OpenAI API key
                if let Some(ref openai_key) = openai_api_key {
                    app.emit("processing-message", "Applying mode...").ok();
                    match llm::process_with_prompt(openai_key, &transcript, &prompt).await {
                        Ok(processed) => {
                            println!("[Dictato] Mode '{}' applied successfully", mode_id);
                            processed
                        }
                        Err(e) => {
                            eprintln!("[Dictato] Mode processing failed, using raw transcript: {}", e);
                            transcript
                        }
                    }
                } else {
                    // No OpenAI key - show error and return raw transcript
                    had_openai_error = true;
                    show_error(&app, "No OpenAI key - mode skipped. Raw transcription copied. Add key in Settings to use modes.");
                    transcript
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
                // Check for OpenAI API key
                if let Some(ref openai_key) = openai_api_key {
                    app.emit("processing-message", "Applying rules...").ok();
                    match llm::process_with_rules(openai_key, &transcript, rules).await {
                        Ok(processed) => {
                            println!("[Dictato] Rules applied successfully");
                            processed
                        }
                        Err(e) => {
                            eprintln!("[Dictato] Rule processing failed, using raw transcript: {}", e);
                            transcript
                        }
                    }
                } else {
                    // No OpenAI key - show error and return raw transcript
                    had_openai_error = true;
                    show_error(&app, "No OpenAI key - rules skipped. Raw transcription copied. Add key in Settings to use rules.");
                    transcript
                }
            } else {
                transcript
            }
        }
    } else {
        transcript
    };

    app.emit("processing-state", false).ok();

    // Don't collapse window if there was an OpenAI error - let show_error handle it
    if !had_openai_error {
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

    // Clear buffer without transcribing
    let groq_state = app.state::<GroqState>();
    groq_state.clear_buffer();

    collapse_floating_window(&app)?;
    println!("[Dictato] Recording cancelled");

    Ok(())
}

/// Check if accessibility permissions are granted on macOS using the proper API
#[cfg(target_os = "macos")]
fn check_accessibility_permissions() -> bool {
    // Use AXIsProcessTrusted from ApplicationServices framework
    // This is the proper way to check accessibility permissions
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    // SAFETY: AXIsProcessTrusted is a safe system call that just returns a boolean
    unsafe { AXIsProcessTrusted() }
}

#[cfg(not(target_os = "macos"))]
fn check_accessibility_permissions() -> bool {
    true
}

/// Perform the actual paste operation
/// On macOS, uses AppleScript which is more reliable than enigo for keyboard simulation
/// because it runs in a separate process and doesn't have threading issues
#[cfg(target_os = "macos")]
fn perform_paste() -> Result<(), String> {
    use std::process::Command;

    // Use AppleScript to simulate Cmd+V - this is more reliable than enigo
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

    // Check accessibility permissions first on macOS
    #[cfg(target_os = "macos")]
    {
        if !check_accessibility_permissions() {
            println!("[Dictato] Accessibility permissions not granted. Text copied to clipboard - press Cmd+V to paste.");
            println!("[Dictato] Grant permissions in System Settings → Privacy & Security → Accessibility");
            return Ok(());
        }
    }

    // Small delay to let the system settle
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Run enigo operations in a blocking task to avoid tokio runtime issues
    // This ensures enigo runs on a dedicated thread, not the tokio worker pool
    let paste_result = tokio::task::spawn_blocking(perform_paste).await;

    match paste_result {
        Ok(Ok(())) => {
            println!("[Dictato] Auto-pasted");
        }
        Ok(Err(e)) => {
            println!("[Dictato] Auto-paste failed: {}. Text is in clipboard - press Cmd+V to paste.", e);
        }
        Err(e) => {
            println!("[Dictato] Auto-paste task failed: {:?}. Text is in clipboard - press Cmd+V to paste.", e);
        }
    }

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
                    let api_key = get_groq_api_key_from_store(&app);
                    if api_key.is_some() {
                        if let Err(e) = start_recording(app).await {
                            eprintln!("Failed to start recording: {}", e);
                        }
                    } else {
                        // Show error to user when no API key configured
                        show_error(&app, "No API key configured. Add your Groq API key in Settings.");
                    }
                }
            });
        })
        .map_err(|e| e.to_string())?;

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

fn get_language_from_store(app: &AppHandle) -> String {
    get_store_string(app, store_keys::LANGUAGE).unwrap_or_else(|| "en".to_string())
}

fn get_cancel_shortcut_from_store(app: &AppHandle) -> String {
    get_store_string(app, store_keys::CANCEL_SHORTCUT).unwrap_or_else(|| "Escape".to_string())
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
async fn generate_mode_prompt(app: AppHandle, name: String, description: String) -> Result<String, String> {
    let api_key = get_openai_api_key_from_store(&app)
        .ok_or("OpenAI API key required for prompt generation. Add it in Settings.")?;
    llm::generate_mode_prompt(&api_key, &name, &description).await
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

fn expand_floating_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("floating") {
        window.show().ok();
        app.emit("floating-expanded", true).ok();
    }
    Ok(())
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

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let icon = match app.default_window_icon() {
        Some(icon) => icon.clone(),
        None => return Ok(()),
    };

    let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

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
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    window.show().ok();
                    window.set_focus().ok();
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    window.show().ok();
                    window.set_focus().ok();
                }
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(GroqState::default())
        .manage(AudioCaptureState::default())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            cancel_recording,
            copy_and_paste,
            register_shortcut,
            register_cancel_shortcut,
            unregister_shortcuts,
            get_recording_state,
            list_audio_devices,
            save_floating_position,
            generate_mode_prompt,
        ])
        .setup(|app| {
            use tauri_plugin_autostart::ManagerExt;
            let autostart = app.autolaunch();
            let _ = autostart.enable();

            setup_tray(app.handle())?;
            create_floating_window(app.handle()).ok();
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
                    if let Some(window) = app.get_webview_window("main") {
                        window.hide().ok();
                    }
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
                if let Some(window) = app.get_webview_window("main") {
                    window.show().ok();
                    window.set_focus().ok();
                }
            }
            _ => {}
        });
}
