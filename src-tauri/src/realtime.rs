use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Clone)]
pub struct RealtimeState {
    pub audio_tx: Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>>,
    pub is_connected: Arc<Mutex<bool>>,
    pub transcript: Arc<Mutex<String>>,
}

impl Default for RealtimeState {
    fn default() -> Self {
        Self {
            audio_tx: Arc::new(Mutex::new(None)),
            is_connected: Arc::new(Mutex::new(false)),
            transcript: Arc::new(Mutex::new(String::new())),
        }
    }
}

#[derive(Serialize)]
struct SessionUpdate {
    #[serde(rename = "type")]
    msg_type: String,
    session: SessionConfig,
}

#[derive(Serialize)]
struct SessionConfig {
    modalities: Vec<String>,
    input_audio_transcription: InputAudioTranscription,
    turn_detection: TurnDetection,
}

#[derive(Serialize)]
struct InputAudioTranscription {
    model: String,
}

#[derive(Serialize)]
struct TurnDetection {
    #[serde(rename = "type")]
    detection_type: String,
}

#[derive(Serialize)]
struct AudioAppend {
    #[serde(rename = "type")]
    msg_type: String,
    audio: String,
}

#[derive(Deserialize, Debug)]
struct RealtimeEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    transcript: Option<String>,
    #[serde(default)]
    delta: Option<String>,
    #[serde(default)]
    error: Option<ErrorDetail>,
}

#[derive(Deserialize, Debug)]
struct ErrorDetail {
    message: Option<String>,
    code: Option<String>,
}

pub async fn start_session(app: AppHandle, api_key: String) -> Result<(), String> {
    println!("[Realtime] Starting session...");
    
    let state = app.state::<RealtimeState>();

    let url = url::Url::parse_with_params(
        "wss://api.openai.com/v1/realtime",
        &[("model", "gpt-4o-mini-realtime-preview")],
    )
    .map_err(|e| e.to_string())?;

    println!("[Realtime] Connecting to: {}", url);

    let request = tokio_tungstenite::tungstenite::http::Request::builder()
        .uri(url.as_str())
        .header("Authorization", format!("Bearer {}", api_key))
        .header("OpenAI-Beta", "realtime=v1")
        .header("Host", "api.openai.com")
        .header("Upgrade", "websocket")
        .header("Connection", "Upgrade")
        .header("Sec-WebSocket-Key", tokio_tungstenite::tungstenite::handshake::client::generate_key())
        .header("Sec-WebSocket-Version", "13")
        .body(())
        .map_err(|e| e.to_string())?;

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| {
            let err_msg = format!("WebSocket connection failed: {}", e);
            println!("[Realtime] {}", err_msg);
            app.emit("transcription-error", &err_msg).ok();
            err_msg
        })?;

    println!("[Realtime] Connected!");

    let (mut write, mut read) = ws_stream.split();

    let session_update = SessionUpdate {
        msg_type: "session.update".to_string(),
        session: SessionConfig {
            modalities: vec!["text".to_string()],
            input_audio_transcription: InputAudioTranscription {
                model: "whisper-1".to_string(),
            },
            turn_detection: TurnDetection {
                detection_type: "server_vad".to_string(),
            },
        },
    };

    write
        .send(Message::Text(serde_json::to_string(&session_update).unwrap()))
        .await
        .map_err(|e| e.to_string())?;

    println!("[Realtime] Session configured");

    *state.is_connected.lock().await = true;
    app.emit("connection-state", true).ok();

    let (audio_tx, mut audio_rx) = mpsc::channel::<Vec<u8>>(100);
    *state.audio_tx.lock().await = Some(audio_tx);

    let is_connected = state.is_connected.clone();

    tokio::spawn(async move {
        let mut chunk_count = 0u64;
        while let Some(audio_data) = audio_rx.recv().await {
            chunk_count += 1;
            if chunk_count % 10 == 0 {
                println!("[Realtime] Sent {} audio chunks ({} bytes)", chunk_count, audio_data.len());
            }
            let encoded = base64::engine::general_purpose::STANDARD.encode(&audio_data);
            let msg = AudioAppend {
                msg_type: "input_audio_buffer.append".to_string(),
                audio: encoded,
            };
            if write
                .send(Message::Text(serde_json::to_string(&msg).unwrap()))
                .await
                .is_err()
            {
                println!("[Realtime] Audio send failed, closing");
                break;
            }
        }
        println!("[Realtime] Audio sender closed");
        *is_connected.lock().await = false;
    });

    let app_read = app.clone();
    let is_connected_read = state.is_connected.clone();
    let transcript_state = state.transcript.clone();

    *transcript_state.lock().await = String::new();

    tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(event) = serde_json::from_str::<RealtimeEvent>(&text) {
                        println!("[Realtime] Event: {}", event.event_type);
                        
                        match event.event_type.as_str() {
                            "session.created" | "session.updated" => {
                                println!("[Realtime] Session ready");
                            }
                            "conversation.item.input_audio_transcription.completed" => {
                                if let Some(transcript) = event.transcript {
                                    println!("[Realtime] Transcription: {}", transcript);
                                    let mut full = transcript_state.lock().await;
                                    full.push_str(&transcript);
                                    full.push(' ');
                                    app_read.emit("transcription-update", full.trim()).ok();
                                }
                            }
                            "response.audio_transcript.delta" => {
                                if let Some(delta) = event.delta {
                                    let mut full = transcript_state.lock().await;
                                    full.push_str(&delta);
                                    app_read.emit("transcription-update", full.trim()).ok();
                                }
                            }
                            "input_audio_buffer.speech_started" => {
                                println!("[Realtime] Speech detected!");
                                app_read.emit("speech-started", ()).ok();
                            }
                            "input_audio_buffer.speech_stopped" => {
                                println!("[Realtime] Speech ended");
                                app_read.emit("speech-stopped", ()).ok();
                            }
                            "error" => {
                                if let Some(err) = event.error {
                                    let err_msg = err.message.unwrap_or_else(|| "Unknown error".to_string());
                                    println!("[Realtime] API Error: {}", err_msg);
                                    app_read.emit("transcription-error", &err_msg).ok();
                                }
                            }
                            _ => {}
                        }
                    } else {
                        println!("[Realtime] Raw message: {}", &text[..text.len().min(200)]);
                    }
                }
                Ok(Message::Close(frame)) => {
                    println!("[Realtime] WebSocket closed: {:?}", frame);
                    break;
                }
                Err(e) => {
                    println!("[Realtime] WebSocket error: {}", e);
                    app_read.emit("transcription-error", format!("Connection error: {}", e)).ok();
                    break;
                }
                _ => {}
            }
        }

        *is_connected_read.lock().await = false;
        app_read.emit("connection-state", false).ok();
        println!("[Realtime] Session ended");
    });

    Ok(())
}

pub async fn send_audio(app: &AppHandle, audio_data: Vec<u8>) -> Result<(), String> {
    let state = app.state::<RealtimeState>();
    let tx = state.audio_tx.lock().await;

    if let Some(sender) = tx.as_ref() {
        sender.send(audio_data).await.map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub async fn stop_session(app: &AppHandle) -> Result<String, String> {
    println!("[Realtime] Stopping session...");
    let state = app.state::<RealtimeState>();

    *state.audio_tx.lock().await = None;
    *state.is_connected.lock().await = false;

    let transcript = state.transcript.lock().await.trim().to_string();
    println!("[Realtime] Final transcript: {}", transcript);

    app.emit("connection-state", false).ok();

    Ok(transcript)
}
