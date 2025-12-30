mod groq;
mod realtime;

use enigo::{Enigo, Key, Keyboard, Settings};
use groq::GroqState;
use realtime::RealtimeState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static CURRENT_PROVIDER: RwLock<String> = RwLock::new(String::new());

#[tauri::command]
async fn start_recording(app: AppHandle, api_key: String, provider: String) -> Result<(), String> {
    IS_RECORDING.store(true, Ordering::SeqCst);

    if let Ok(mut p) = CURRENT_PROVIDER.write() {
        *p = provider.clone();
    }

    app.emit("recording-state", true).ok();
    expand_floating_window(&app)?;

    if provider == "groq" {
        let groq_state = app.state::<GroqState>();
        groq_state.clear_buffer();
        Ok(())
    } else {
        realtime::start_session(app, api_key).await
    }
}

#[tauri::command]
async fn stop_recording(app: AppHandle) -> Result<(), String> {
    IS_RECORDING.store(false, Ordering::SeqCst);
    app.emit("recording-state", false).ok();

    let provider = CURRENT_PROVIDER
        .read()
        .map(|p| p.clone())
        .unwrap_or_default();

    let transcript = if provider == "groq" {
        let groq_state = app.state::<GroqState>();
        let audio_data = groq_state.get_buffer()?;
        groq_state.clear_buffer();

        let api_key = get_groq_api_key_from_store(&app).unwrap_or_default();
        let language = get_language_from_store(&app);
        if audio_data.is_empty() || api_key.is_empty() {
            String::new()
        } else {
            app.emit("processing-state", true).ok();
            let result = groq::transcribe(&api_key, audio_data, &language).await;
            app.emit("processing-state", false).ok();
            result?
        }
    } else {
        realtime::stop_session(&app).await?
    };

    collapse_floating_window(&app)?;

    if !transcript.is_empty() {
        copy_and_paste(app, transcript).await?;
    }

    Ok(())
}

#[tauri::command]
async fn send_audio_chunk(app: AppHandle, audio: Vec<u8>) -> Result<(), String> {
    if IS_RECORDING.load(Ordering::SeqCst) {
        let provider = CURRENT_PROVIDER
            .read()
            .map(|p| p.clone())
            .unwrap_or_default();
        if provider == "groq" {
            let groq_state = app.state::<GroqState>();
            if let Err(e) = groq_state.append_audio(audio) {
                app.emit("transcription-error", &e).ok();
                return Err(e);
            }
        } else {
            realtime::send_audio(&app, audio).await?;
        }
    }
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
    let auto_paste_enabled = get_store_string(&app, "autoPaste")
        .map(|v| v == "true")
        .unwrap_or(true); // Default to enabled

    if !auto_paste_enabled {
        println!("[Dictato] Auto-paste disabled. Press Cmd+V to paste.");
        return Ok(());
    }

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Try to auto-paste
    match Enigo::new(&Settings::default()) {
        Ok(mut enigo) => {
            #[cfg(target_os = "macos")]
            {
                enigo.key(Key::Meta, enigo::Direction::Press).ok();
                enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
                enigo.key(Key::Meta, enigo::Direction::Release).ok();
            }

            #[cfg(not(target_os = "macos"))]
            {
                enigo.key(Key::Control, enigo::Direction::Press).ok();
                enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
                enigo.key(Key::Control, enigo::Direction::Release).ok();
            }
            println!("[Dictato] Auto-pasted");
        }
        Err(e) => {
            println!("[Dictato] Auto-paste failed: {:?}. Grant Accessibility permissions in System Settings → Privacy & Security → Accessibility", e);
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
                    let provider = get_provider_from_store(&app);
                    let api_key = if provider == "groq" {
                        get_groq_api_key_from_store(&app)
                    } else {
                        get_api_key_from_store(&app)
                    };

                    if let Some(key) = api_key {
                        if let Err(e) = start_recording(app, key, provider).await {
                            eprintln!("Failed to start recording: {}", e);
                        }
                    } else {
                        eprintln!("No API key configured for provider: {}", provider);
                    }
                }
            });
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn get_store_string(app: &AppHandle, key: &str) -> Option<String> {
    let store = app.store("settings.json").ok()?;
    store
        .get(key)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
}

fn get_api_key_from_store(app: &AppHandle) -> Option<String> {
    get_store_string(app, "apiKey")
}

fn get_groq_api_key_from_store(app: &AppHandle) -> Option<String> {
    get_store_string(app, "groqApiKey")
}

fn get_provider_from_store(app: &AppHandle) -> String {
    get_store_string(app, "provider").unwrap_or_else(|| "openai".to_string())
}

fn get_language_from_store(app: &AppHandle) -> String {
    get_store_string(app, "language").unwrap_or_else(|| "en".to_string())
}

#[tauri::command]
fn get_recording_state() -> bool {
    IS_RECORDING.load(Ordering::SeqCst)
}

#[tauri::command]
fn set_floating_x(app: AppHandle, x: f64) {
    if let Some(window) = app.get_webview_window("floating") {
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition {
                x,
                y: 8.0,
            }))
            .ok();
    }
}

fn create_floating_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("floating").is_some() {
        return Ok(());
    }

    let window =
        WebviewWindowBuilder::new(app, "floating", WebviewUrl::App("/?window=floating".into()))
            .title("Whisper")
            .inner_size(300.0, 50.0)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;

    if let Ok(Some(monitor)) = window.primary_monitor() {
        let screen_width = monitor.size().width as f64 / monitor.scale_factor();
        let x = (screen_width - 300.0) / 2.0;
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition {
                x,
                y: 8.0,
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
        .manage(RealtimeState::default())
        .manage(GroqState::default())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            send_audio_chunk,
            copy_and_paste,
            register_shortcut,
            unregister_shortcuts,
            get_recording_state,
            set_floating_x,
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
