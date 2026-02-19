use parakeet_rs::{ParakeetTDT, Transcriber};
use rubato::{FftFixedIn, Resampler};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager};

// Audio constants
const PCM16_NORMALIZE: f32 = 32768.0; // i16::MAX + 1, for normalizing PCM16 to [-1.0, 1.0]
const INPUT_SAMPLE_RATE: u32 = 24000;
const PARAKEET_SAMPLE_RATE: u32 = 16000;

/// Silence padding appended before transcription so the model can finalize
/// the last speech tokens. Without this, abrupt audio endings cause the TDT
/// decoder to cut off the trailing words.
const SILENCE_PADDING_SECS: f32 = 0.5;

/// Minimum interval between download progress events
const PROGRESS_THROTTLE_MS: u128 = 100;

const MODEL_DIR_NAME: &str = "models/parakeet-tdt-v3";

const HF_BASE_URL: &str =
    "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main";

/// (HuggingFace filename, local filename, description, is_primary)
const MODEL_FILES: &[(&str, &str, &str, bool)] = &[
    (
        "encoder-model.int8.onnx",
        "encoder-model.onnx",
        "Encoder model",
        true,
    ),
    (
        "decoder_joint-model.int8.onnx",
        "decoder_joint-model.onnx",
        "Decoder model",
        false,
    ),
    ("vocab.txt", "vocab.txt", "Vocabulary", false),
];

// Event names
pub const EVENT_DOWNLOAD_PROGRESS: &str = "parakeet-download-progress";
pub const EVENT_LOADING: &str = "parakeet-loading";

/// STT provider for speech-to-text
#[derive(Debug, Clone, PartialEq)]
pub enum SttProvider {
    Groq,
    Parakeet,
}

impl SttProvider {
    pub fn from_store_value(s: &str) -> Self {
        match s {
            "parakeet" => Self::Parakeet,
            _ => Self::Groq,
        }
    }
}

/// Flag to prevent model deletion during active transcription.
static IS_TRANSCRIBING: AtomicBool = AtomicBool::new(false);

pub fn set_transcribing(active: bool) {
    IS_TRANSCRIBING.store(active, Ordering::SeqCst);
}

pub fn is_transcribing() -> bool {
    IS_TRANSCRIBING.load(Ordering::SeqCst)
}

#[derive(Clone)]
pub struct ParakeetState {
    model: Arc<Mutex<Option<ParakeetTDT>>>,
}

impl Default for ParakeetState {
    fn default() -> Self {
        Self {
            model: Arc::new(Mutex::new(None)),
        }
    }
}

impl ParakeetState {
    /// Lock the model mutex, recovering from poison if needed.
    /// In a desktop app, recovering is preferable to crashing.
    fn lock_model(&self) -> MutexGuard<'_, Option<ParakeetTDT>> {
        match self.model.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("[Parakeet] Mutex poisoned, recovering");
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
    MODEL_FILES.iter().all(|(_, local_name, _, _)| {
        let path = model_dir.join(local_name);
        path.exists() && path.metadata().map(|m| m.len() > 0).unwrap_or(false)
    })
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

    let client = reqwest::Client::new();

    for (hf_name, local_name, description, is_primary) in MODEL_FILES {
        let local_path = model_dir.join(local_name);

        // Skip if already downloaded
        if local_path.exists()
            && local_path
                .metadata()
                .map(|m| m.len() > 0)
                .unwrap_or(false)
        {
            println!("[Parakeet] {} already downloaded, skipping", description);
            continue;
        }

        // For non-primary files, emit "finishing up"
        if !is_primary {
            app.emit(
                EVENT_DOWNLOAD_PROGRESS,
                serde_json::json!({
                    "finishing": true,
                    "percent": 100.0,
                }),
            )
            .ok();
        }

        let url = format!("{}/{}", HF_BASE_URL, hf_name);
        println!("[Parakeet] Downloading {} from {}", description, url);

        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to download {}: {}", description, e))?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to download {} (HTTP {})",
                description,
                response.status()
            ));
        }

        let total_bytes = response.content_length().unwrap_or(0);
        let mut bytes_downloaded: u64 = 0;

        // Use temp file then rename for atomic write
        let temp_path = model_dir.join(format!("{}.tmp", local_name));
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

            // Only emit granular progress for the primary (encoder) file, throttled
            if *is_primary && last_emit.elapsed().as_millis() >= PROGRESS_THROTTLE_MS {
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
                        "finishing": false,
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
            "[Parakeet] {} downloaded ({} bytes)",
            description, bytes_downloaded
        );
    }

    Ok(())
}

pub fn load_model(state: &ParakeetState, model_dir: &Path) -> Result<(), String> {
    let mut model_guard = state.lock_model();

    if model_guard.is_some() {
        println!("[Parakeet] Model already loaded");
        return Ok(());
    }

    println!("[Parakeet] Loading model from {:?}", model_dir);
    let model = ParakeetTDT::from_pretrained(model_dir, None)
        .map_err(|e| format!("Failed to load model: {}", e))?;

    *model_guard = Some(model);
    println!("[Parakeet] Model loaded successfully");
    Ok(())
}

pub fn unload_model(state: &ParakeetState) -> Result<(), String> {
    let mut model_guard = state.lock_model();
    *model_guard = None;
    println!("[Parakeet] Model unloaded");
    Ok(())
}

pub fn is_model_loaded(state: &ParakeetState) -> bool {
    state.model.lock().map(|g| g.is_some()).unwrap_or(false)
}

pub fn transcribe_pcm16(state: &ParakeetState, pcm16_24khz: Vec<u8>) -> Result<String, String> {
    let mut model_guard = state.lock_model();
    let model = model_guard
        .as_mut()
        .ok_or("Parakeet model not loaded. Download it in Settings.")?;

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

    // Pad with silence so the TDT decoder can finalize the last tokens.
    // Without this, abrupt audio endings cause the model to drop trailing words.
    let silence_frames = (INPUT_SAMPLE_RATE as f32 * SILENCE_PADDING_SECS) as usize;
    let mut samples = samples;
    samples.extend(std::iter::repeat(0.0f32).take(silence_frames));

    // Resample from 24kHz to 16kHz (Parakeet expects 16kHz)
    let samples = resample_audio(&samples, INPUT_SAMPLE_RATE, PARAKEET_SAMPLE_RATE)?;

    println!(
        "[Parakeet] Transcribing {} samples at {}Hz",
        samples.len(),
        PARAKEET_SAMPLE_RATE
    );

    let result = model
        .transcribe_samples(samples, PARAKEET_SAMPLE_RATE, 1, None)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    Ok(result.text)
}

pub fn transcribe_file_local(state: &ParakeetState, file_path: &Path) -> Result<String, String> {
    let mut model_guard = state.lock_model();
    let model = model_guard
        .as_mut()
        .ok_or("Parakeet model not loaded. Download it in Settings.")?;

    println!("[Parakeet] Transcribing file: {:?}", file_path);

    let result = model
        .transcribe_file(file_path, None)
        .map_err(|e| format!("File transcription failed: {}", e))?;

    Ok(result.text)
}

/// Resample audio using FFT-based resampling with proper anti-aliasing.
/// Processes in fixed-size chunks so the internal resampler state carries over
/// and no tail audio is lost.
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
        chunk.resize(frames_needed, 0.0); // zero-pad final chunk

        let resampled = resampler
            .process(&[chunk], None)
            .map_err(|e| format!("Resampling failed: {}", e))?;

        if let Some(channel) = resampled.into_iter().next() {
            output.extend(channel);
        }

        pos += frames_needed;
    }

    // Flush: one extra zero-padded chunk to push remaining samples through the filter
    let frames_needed = resampler.input_frames_next();
    let flush = vec![0.0f32; frames_needed];
    if let Ok(resampled) = resampler.process(&[flush], None) {
        if let Some(channel) = resampled.into_iter().next() {
            output.extend(channel);
        }
    }

    Ok(output)
}

pub fn delete_model(model_dir: &Path) -> Result<(), String> {
    if model_dir.exists() {
        std::fs::remove_dir_all(model_dir)
            .map_err(|e| format!("Failed to delete model: {}", e))?;
        println!("[Parakeet] Model deleted from {:?}", model_dir);
    }
    Ok(())
}
