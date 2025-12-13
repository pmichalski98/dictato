mod realtime;

use enigo::{Enigo, Key, Keyboard, Settings};
use realtime::RealtimeState;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

static IS_RECORDING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
async fn start_recording(app: AppHandle, api_key: String) -> Result<(), String> {
    IS_RECORDING.store(true, Ordering::SeqCst);
    app.emit("recording-state", true).ok();
    expand_floating_window(&app)?;
    realtime::start_session(app, api_key).await
}

#[tauri::command]
async fn stop_recording(app: AppHandle) -> Result<(), String> {
    IS_RECORDING.store(false, Ordering::SeqCst);
    app.emit("recording-state", false).ok();

    let transcript = realtime::stop_session(&app).await?;
    collapse_floating_window(&app)?;

    if !transcript.is_empty() {
        copy_and_paste(app, transcript).await?;
    }

    Ok(())
}

#[tauri::command]
async fn send_audio_chunk(app: AppHandle, audio: Vec<u8>) -> Result<(), String> {
    if IS_RECORDING.load(Ordering::SeqCst) {
        realtime::send_audio(&app, audio).await?;
    }
    Ok(())
}

#[tauri::command]
async fn copy_and_paste(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(&text).map_err(|e| e.to_string())?;

    std::thread::sleep(std::time::Duration::from_millis(100));

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

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

    Ok(())
}

#[tauri::command]
async fn register_shortcut(app: AppHandle, shortcut_str: String) -> Result<(), String> {
    let shortcut: Shortcut = shortcut_str.parse().map_err(|e| format!("{:?}", e))?;

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
                    let api_key = get_api_key_from_store(&app);
                    if let Some(key) = api_key {
                        if let Err(e) = start_recording(app, key).await {
                            eprintln!("Failed to start recording: {}", e);
                        }
                    } else {
                        eprintln!("No API key configured");
                    }
                }
            });
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn get_api_key_from_store(app: &AppHandle) -> Option<String> {
    let store = app.store("settings.json").ok()?;
    store.get("apiKey").and_then(|v| v.as_str().map(|s| s.to_string()))
}

#[tauri::command]
fn get_recording_state() -> bool {
    IS_RECORDING.load(Ordering::SeqCst)
}

#[tauri::command]
fn set_floating_x(app: AppHandle, x: f64) {
    if let Some(window) = app.get_webview_window("floating") {
        window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y: 8.0 })).ok();
    }
}

fn create_floating_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("floating").is_some() {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, "floating", WebviewUrl::App("/?window=floating".into()))
        .title("Whisper")
        .inner_size(44.0, 44.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;

    if let Ok(Some(monitor)) = window.primary_monitor() {
        let screen_width = monitor.size().width as f64 / monitor.scale_factor();
        let x = (screen_width - 44.0) / 2.0;
        window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y: 8.0 })).ok();
    }

    Ok(())
}

fn expand_floating_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("floating") {
        window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 340.0, height: 50.0 })).ok();
        app.emit("floating-expanded", true).ok();
    }
    Ok(())
}

fn collapse_floating_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("floating") {
        window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 44.0, height: 44.0 })).ok();
        app.emit("floating-expanded", false).ok();
    }
    Ok(())
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let icon = match app.default_window_icon() {
        Some(icon) => icon.clone(),
        None => return Ok(()),
    };

    let _ = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Whisper Clone")
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
        .manage(RealtimeState::default())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            send_audio_chunk,
            copy_and_paste,
            register_shortcut,
            get_recording_state,
            set_floating_x,
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
            create_floating_window(app.handle()).ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
