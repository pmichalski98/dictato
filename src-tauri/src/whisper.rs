use rubato::{FftFixedIn, Resampler};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

// Audio constants
const PCM16_NORMALIZE: f32 = 32768.0;
const INPUT_SAMPLE_RATE: u32 = 24000;
const WHISPER_SAMPLE_RATE: u32 = 16000;

/// Minimum interval between download progress events
const PROGRESS_THROTTLE_MS: u128 = 100;

const MODEL_DIR_NAME: &str = "models/whisper-large-v3-turbo";
const MODEL_FILE_NAME: &str = "ggml-large-v3-turbo-q5_0.bin";
const MODEL_DOWNLOAD_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";

// Event names
pub const EVENT_DOWNLOAD_PROGRESS: &str = "whisper-download-progress";
pub const EVENT_LOADING: &str = "whisper-loading";

#[derive(Clone)]
pub struct WhisperState {
    model: Arc<Mutex<Option<WhisperContext>>>,
}

impl Default for WhisperState {
    fn default() -> Self {
        Self {
            model: Arc::new(Mutex::new(None)),
        }
    }
}

impl WhisperState {
    fn lock_model(&self) -> MutexGuard<'_, Option<WhisperContext>> {
        match self.model.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("[Whisper] Mutex poisoned, recovering");
                poisoned.into_inner()
            }
        }
    }
}

pub fn get_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data.join(MODEL_DIR_NAME))
}

pub fn is_model_downloaded(model_dir: &Path) -> bool {
    let path = model_dir.join(MODEL_FILE_NAME);
    path.exists() && path.metadata().map(|m| m.len() > 0).unwrap_or(false)
}

pub async fn download_model(app: &AppHandle) -> Result<(), String> {
    let model_dir = get_model_dir(app)?;
    std::fs::create_dir_all(&model_dir)
        .map_err(|e| format!("Failed to create model dir: {}", e))?;

    // Clean up leftover temp files from interrupted downloads
    if let Ok(entries) = std::fs::read_dir(&model_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".tmp") {
                    std::fs::remove_file(entry.path()).ok();
                }
            }
        }
    }

    let local_path = model_dir.join(MODEL_FILE_NAME);

    // Skip if already downloaded
    if local_path.exists()
        && local_path
            .metadata()
            .map(|m| m.len() > 0)
            .unwrap_or(false)
    {
        println!("[Whisper] Model already downloaded, skipping");
        return Ok(());
    }

    println!("[Whisper] Downloading model from {}", MODEL_DOWNLOAD_URL);

    let client = reqwest::Client::new();
    let response = client
        .get(MODEL_DOWNLOAD_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to download model: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download model (HTTP {})",
            response.status()
        ));
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let mut bytes_downloaded: u64 = 0;

    // Use temp file then rename for atomic write
    let temp_path = model_dir.join(format!("{}.tmp", MODEL_FILE_NAME));
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    use std::io::Write;
    let mut stream = response;
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream
        .chunk()
        .await
        .map_err(|e| format!("Download error: {}", e))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("Write error: {}", e))?;
        bytes_downloaded += chunk.len() as u64;

        if last_emit.elapsed().as_millis() >= PROGRESS_THROTTLE_MS {
            let percent = if total_bytes > 0 {
                bytes_downloaded as f64 / total_bytes as f64 * 100.0
            } else {
                0.0
            };

            app.emit(
                EVENT_DOWNLOAD_PROGRESS,
                serde_json::json!({
                    "bytesDownloaded": bytes_downloaded,
                    "totalBytes": total_bytes,
                    "percent": percent,
                }),
            )
            .ok();

            last_emit = std::time::Instant::now();
        }
    }

    drop(file);

    // Rename temp file to final name
    std::fs::rename(&temp_path, &local_path)
        .map_err(|e| format!("Failed to finalize download: {}", e))?;

    println!(
        "[Whisper] Model downloaded ({} bytes)",
        bytes_downloaded
    );

    Ok(())
}

pub fn load_model(state: &WhisperState, model_dir: &Path) -> Result<(), String> {
    let mut model_guard = state.lock_model();

    if model_guard.is_some() {
        println!("[Whisper] Model already loaded");
        return Ok(());
    }

    let model_path = model_dir.join(MODEL_FILE_NAME);
    println!("[Whisper] Loading model from {:?}", model_path);

    let ctx = WhisperContext::new_with_params(
        model_path.to_str().ok_or("Invalid model path")?,
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

    *model_guard = Some(ctx);
    println!("[Whisper] Model loaded successfully");
    Ok(())
}

pub fn unload_model(state: &WhisperState) -> Result<(), String> {
    let mut model_guard = state.lock_model();
    *model_guard = None;
    println!("[Whisper] Model unloaded");
    Ok(())
}

pub fn is_model_loaded(state: &WhisperState) -> bool {
    state.model.lock().map(|g| g.is_some()).unwrap_or(false)
}

pub fn transcribe_pcm16(state: &WhisperState, pcm16_24khz: Vec<u8>) -> Result<String, String> {
    let mut model_guard = state.lock_model();
    let ctx = model_guard
        .as_mut()
        .ok_or("Whisper model not loaded. Download it in Settings.")?;

    // Convert PCM16 LE bytes to f32 samples
    let samples: Vec<f32> = pcm16_24khz
        .chunks_exact(2)
        .map(|chunk| {
            let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
            sample as f32 / PCM16_NORMALIZE
        })
        .collect();

    if samples.is_empty() {
        return Ok(String::new());
    }

    // Resample from 24kHz to 16kHz (Whisper expects 16kHz)
    let samples = resample_audio(&samples, INPUT_SAMPLE_RATE, WHISPER_SAMPLE_RATE)?;

    println!(
        "[Whisper] Transcribing {} samples at {}Hz",
        samples.len(),
        WHISPER_SAMPLE_RATE
    );

    run_whisper_inference(ctx, &samples)
}

pub fn transcribe_file_local(state: &WhisperState, file_path: &Path) -> Result<String, String> {
    let mut model_guard = state.lock_model();
    let ctx = model_guard
        .as_mut()
        .ok_or("Whisper model not loaded. Download it in Settings.")?;

    println!("[Whisper] Transcribing file: {:?}", file_path);

    // Read WAV file and extract f32 samples at 16kHz
    // The file has already been converted to a suitable format by the transcribe pipeline
    let samples = read_audio_file_as_f32(file_path)?;

    run_whisper_inference(ctx, &samples)
}

/// Read an audio file (WAV format from ffmpeg pipeline) and return f32 samples at 16kHz mono.
fn read_audio_file_as_f32(file_path: &Path) -> Result<Vec<f32>, String> {
    let data = std::fs::read(file_path)
        .map_err(|e| format!("Failed to read audio file: {}", e))?;

    // Parse WAV header to extract sample rate and format
    // WAV files from ffmpeg/transcribe pipeline are PCM
    if data.len() < 44 || &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return Err("Not a valid WAV file".to_string());
    }

    // Find "fmt " chunk
    let mut pos = 12;
    let mut sample_rate = 16000u32;
    let mut bits_per_sample = 16u16;
    let mut num_channels = 1u16;

    while pos + 8 < data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]]) as usize;

        if chunk_id == b"fmt " && chunk_size >= 16 {
            num_channels = u16::from_le_bytes([data[pos + 10], data[pos + 11]]);
            sample_rate = u32::from_le_bytes([data[pos + 12], data[pos + 13], data[pos + 14], data[pos + 15]]);
            bits_per_sample = u16::from_le_bytes([data[pos + 22], data[pos + 23]]);
            break;
        }

        pos += 8 + chunk_size;
        // Align to 2-byte boundary
        if chunk_size % 2 != 0 {
            pos += 1;
        }
    }

    // Find "data" chunk
    pos = 12;
    let mut audio_data: &[u8] = &[];
    while pos + 8 < data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]]) as usize;

        if chunk_id == b"data" {
            let data_start = pos + 8;
            let data_end = (data_start + chunk_size).min(data.len());
            audio_data = &data[data_start..data_end];
            break;
        }

        pos += 8 + chunk_size;
        if chunk_size % 2 != 0 {
            pos += 1;
        }
    }

    if audio_data.is_empty() {
        return Err("No audio data found in WAV file".to_string());
    }

    // Convert to f32 mono samples
    let mut samples: Vec<f32> = match bits_per_sample {
        16 => audio_data
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / PCM16_NORMALIZE)
            .collect(),
        32 => audio_data
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect(),
        _ => return Err(format!("Unsupported bits per sample: {}", bits_per_sample)),
    };

    // Convert stereo to mono by averaging channels
    if num_channels == 2 {
        samples = samples
            .chunks_exact(2)
            .map(|pair| (pair[0] + pair[1]) / 2.0)
            .collect();
    }

    // Resample to 16kHz if needed
    if sample_rate != WHISPER_SAMPLE_RATE {
        samples = resample_audio(&samples, sample_rate, WHISPER_SAMPLE_RATE)?;
    }

    Ok(samples)
}

fn run_whisper_inference(ctx: &mut WhisperContext, samples: &[f32]) -> Result<String, String> {
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    params.set_language(Some("auto"));

    // Create a new state for this inference
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create Whisper state: {}", e))?;

    state
        .full(params, samples)
        .map_err(|e| format!("Whisper inference failed: {}", e))?;

    let num_segments = state.full_n_segments()
        .map_err(|e| format!("Failed to get segments: {}", e))?;

    let mut text = String::new();
    for i in 0..num_segments {
        if let Ok(segment_text) = state.full_get_segment_text(i) {
            text.push_str(&segment_text);
        }
    }

    Ok(text.trim().to_string())
}

pub fn delete_model(model_dir: &Path) -> Result<(), String> {
    if model_dir.exists() {
        std::fs::remove_dir_all(model_dir)
            .map_err(|e| format!("Failed to delete model: {}", e))?;
        println!("[Whisper] Model deleted from {:?}", model_dir);
    }
    Ok(())
}

/// Resample audio using FFT-based resampling with proper anti-aliasing.
fn resample_audio(samples: &[f32], from_rate: u32, to_rate: u32) -> Result<Vec<f32>, String> {
    if from_rate == to_rate || samples.is_empty() {
        return Ok(samples.to_vec());
    }

    let chunk_size = 1024;
    let mut resampler = FftFixedIn::<f32>::new(
        from_rate as usize,
        to_rate as usize,
        chunk_size,
        1, // sub_chunks
        1, // channels
    )
    .map_err(|e| format!("Failed to create resampler: {}", e))?;

    let mut output = Vec::with_capacity(samples.len() * to_rate as usize / from_rate as usize);
    let mut pos = 0;

    while pos < samples.len() {
        let frames_needed = resampler.input_frames_next();
        let end = (pos + frames_needed).min(samples.len());
        let mut chunk = samples[pos..end].to_vec();
        chunk.resize(frames_needed, 0.0);

        let resampled = resampler
            .process(&[chunk], None)
            .map_err(|e| format!("Resampling failed: {}", e))?;

        if let Some(channel) = resampled.into_iter().next() {
            output.extend(channel);
        }

        pos += frames_needed;
    }

    // Flush remaining samples
    let frames_needed = resampler.input_frames_next();
    let flush = vec![0.0f32; frames_needed];
    if let Ok(resampled) = resampler.process(&[flush], None) {
        if let Some(channel) = resampled.into_iter().next() {
            output.extend(channel);
        }
    }

    Ok(output)
}
