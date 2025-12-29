use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use std::sync::Mutex;
use std::time::Duration;

const MAX_BUFFER_SIZE: usize = 24 * 1024 * 1024; // 24MB (under Groq's 25MB limit)
const SAMPLE_RATE: u32 = 24000;
const CHANNELS: u16 = 1;
const BITS_PER_SAMPLE: u16 = 16;
const REQUEST_TIMEOUT_SECS: u64 = 30;

pub struct GroqState {
    audio_buffer: Mutex<Vec<u8>>,
}

impl Default for GroqState {
    fn default() -> Self {
        Self {
            audio_buffer: Mutex::new(Vec::new()),
        }
    }
}

#[derive(Deserialize)]
struct GroqResponse {
    text: String,
}

impl GroqState {
    pub fn append_audio(&self, chunk: Vec<u8>) -> Result<(), String> {
        let mut buffer = self.audio_buffer.lock()
            .map_err(|e| format!("Buffer lock poisoned: {}", e))?;

        if buffer.len() + chunk.len() > MAX_BUFFER_SIZE {
            return Err(format!("Recording too long (max ~{}min)", MAX_BUFFER_SIZE / (SAMPLE_RATE as usize * 2) / 60));
        }

        buffer.extend(chunk);
        Ok(())
    }

    pub fn clear_buffer(&self) {
        if let Ok(mut buffer) = self.audio_buffer.lock() {
            buffer.clear();
        }
    }

    pub fn get_buffer(&self) -> Result<Vec<u8>, String> {
        self.audio_buffer.lock()
            .map(|b| b.clone())
            .map_err(|e| format!("Buffer lock poisoned: {}", e))
    }

    pub fn buffer_size(&self) -> usize {
        self.audio_buffer.lock().map(|b| b.len()).unwrap_or(0)
    }
}

fn create_wav_header(data_len: u32, sample_rate: u32, channels: u16, bits_per_sample: u16) -> Vec<u8> {
    let byte_rate = sample_rate * channels as u32 * bits_per_sample as u32 / 8;
    let block_align = channels * bits_per_sample / 8;
    let chunk_size = 36 + data_len;

    let mut header = Vec::with_capacity(44);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&chunk_size.to_le_bytes());
    header.extend_from_slice(b"WAVE");
    header.extend_from_slice(b"fmt ");
    header.extend_from_slice(&16u32.to_le_bytes()); // subchunk1 size
    header.extend_from_slice(&1u16.to_le_bytes()); // audio format (PCM)
    header.extend_from_slice(&channels.to_le_bytes());
    header.extend_from_slice(&sample_rate.to_le_bytes());
    header.extend_from_slice(&byte_rate.to_le_bytes());
    header.extend_from_slice(&block_align.to_le_bytes());
    header.extend_from_slice(&bits_per_sample.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&data_len.to_le_bytes());
    header
}

pub async fn transcribe(api_key: &str, audio_data: Vec<u8>, language: &str) -> Result<String, String> {
    if audio_data.is_empty() {
        return Ok(String::new());
    }

    let wav_header = create_wav_header(audio_data.len() as u32, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);
    let mut wav_data = wav_header;
    wav_data.extend(audio_data);

    let part = Part::bytes(wav_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let form = Form::new()
        .part("file", part)
        .text("model", "whisper-large-v3-turbo")
        .text("response_format", "json")
        .text("language", language.to_string());

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let response = client
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Groq API error {}: {}", status, body));
    }

    let result: GroqResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(result.text)
}
