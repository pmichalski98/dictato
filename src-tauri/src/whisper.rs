//! OpenAI Whisper (large-v3-turbo) via whisper.cpp / whisper-rs.
//!
//! Latency notes (M3 Pro, 10 s clip): the encoder always processes a full
//! 30 s window and dominates the cost. Stock language auto-detection runs
//! that encoder a second time, so when the encoder runs on Metal this module
//! detects the language itself on a separate state whose encoder context is
//! trimmed to a few seconds, then runs the real pass with the language fixed.
//! Trimming the context of the *main* pass was measured too and rejected: it
//! halves the time but hallucinates repeats whenever the window contains
//! silence.
//!
//! On macOS the encoder can run on the Neural Engine through Core ML when
//! `<model>-encoder.mlmodelc` sits next to the ggml file (~30% faster).
//! That encoder has a fixed 30 s input shape, so the trimmed detector then
//! runs on a second, Metal-only context loaded from memory (whisper.cpp only
//! looks for the Core ML model next to a file path). Core ML contexts are
//! created per state, which is why states live as long as the engine.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::local_audio::TARGET_SAMPLE_RATE;
use crate::models::inference_threads;

const MODEL_FILE_NAME: &str = "ggml-large-v3-turbo-q5_0.bin";
/// Directory whisper.cpp derives from the model name for the Core ML encoder.
pub const COREML_ENCODER_DIR_NAME: &str = "ggml-large-v3-turbo-encoder.mlmodelc";

/// Encoder context (in 20 ms frames) used for language detection only.
/// 256 frames = ~5 s of audio, enough to tell Polish from English and about
/// 6x cheaper than the default 1500.
const LANG_DETECT_AUDIO_CTX: i32 = 256;
/// Seconds of audio handed to the detector (a little more than it encodes).
const LANG_DETECT_WINDOW_SECS: f32 = 6.0;
/// Below this softmax probability we let whisper.cpp do its own detection
/// on the full window rather than risk forcing a wrong language, which
/// makes Whisper translate instead of transcribe.
const LANG_DETECT_MIN_PROB: f32 = 0.5;
/// Frames whose RMS is below this fraction of the loudest frame count as
/// leading silence and are skipped before detection.
const SILENCE_RATIO: f32 = 0.1;
const SILENCE_FLOOR_RMS: f32 = 0.005;
/// Audio kept before the first detected speech frame.
const SPEECH_LEAD_IN_SECS: f32 = 0.2;

struct Engine {
    /// Kept alive for `main_state`; a Core ML encoder is attached on macOS
    /// when the mlmodelc directory exists.
    _ctx: WhisperContext,
    /// Reused across dictations. Creating a state loads the Core ML encoder,
    /// which is far too slow to do per call.
    main_state: whisper_rs::WhisperState,
    /// Metal-only context backing the language detector when Core ML is
    /// active (the Core ML encoder can't take a trimmed window). `None`
    /// when the detector shares `_ctx`.
    _lang_ctx: Option<WhisperContext>,
    /// Trimmed-context detector; see [`prime_lang_state`].
    lang_state: whisper_rs::WhisperState,
    /// Whether the Core ML encoder directory was present at load time.
    coreml: bool,
}

#[derive(Clone, Default)]
pub struct WhisperState {
    model: Arc<Mutex<Option<Engine>>>,
}

impl WhisperState {
    fn lock_model(&self) -> MutexGuard<'_, Option<Engine>> {
        match self.model.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("[Whisper] Mutex poisoned, recovering");
                poisoned.into_inner()
            }
        }
    }
}

fn base_params<'a>() -> FullParams<'a, 'a> {
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_n_threads(inference_threads() as i32);
    params
}

/// whisper.cpp stores `params.audio_ctx` on the state during `whisper_full`
/// and every later encode on that state reuses it. Running one throwaway
/// pass over a second of silence therefore leaves `lang_state` permanently
/// trimmed to [`LANG_DETECT_AUDIO_CTX`], which is what makes detection cheap.
fn prime_lang_state(ctx: &WhisperContext) -> Result<whisper_rs::WhisperState, String> {
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create Whisper language state: {}", e))?;
    let mut params = base_params();
    params.set_audio_ctx(LANG_DETECT_AUDIO_CTX);
    params.set_language(Some("en"));
    params.set_no_context(true);
    let silence = vec![0.0f32; TARGET_SAMPLE_RATE as usize];
    state
        .full(params, &silence)
        .map_err(|e| format!("Failed to prime Whisper language state: {}", e))?;
    Ok(state)
}

pub fn load_model(state: &WhisperState, model_dir: &Path) -> Result<(), String> {
    let mut model_guard = state.lock_model();

    if model_guard.is_some() {
        println!("[Whisper] Model already loaded");
        return Ok(());
    }

    let model_path = model_dir.join(MODEL_FILE_NAME);
    println!("[Whisper] Loading model from {:?}", model_path);

    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.flash_attn = true; // Fused QKV kernel — ~20-40% faster attention on Metal

    let ctx = WhisperContext::new_with_params(&model_path, ctx_params)
        .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

    let coreml = cfg!(target_os = "macos") && model_dir.join(COREML_ENCODER_DIR_NAME).is_dir();
    if coreml {
        println!("[Whisper] Core ML encoder found; first load on this machine compiles it and can take minutes");
    }

    let t = std::time::Instant::now();
    let main_state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create Whisper state: {}", e))?;
    println!("[Whisper] State ready in {} ms", t.elapsed().as_millis());

    let (lang_ctx, lang_state) = if coreml {
        // Loading from a buffer leaves whisper.cpp with no path to derive the
        // Core ML model from, so this context encodes on Metal and honours
        // the trimmed audio context. Costs the model size in RAM again.
        let bytes = std::fs::read(&model_path)
            .map_err(|e| format!("Failed to read Whisper model: {}", e))?;
        let mut lang_params = WhisperContextParameters::default();
        lang_params.flash_attn = true;
        let lang_ctx = WhisperContext::new_from_buffer_with_params(&bytes, lang_params)
            .map_err(|e| format!("Failed to load Whisper language context: {}", e))?;
        drop(bytes);
        let state = prime_lang_state(&lang_ctx)?;
        (Some(lang_ctx), state)
    } else {
        (None, prime_lang_state(&ctx)?)
    };

    *model_guard = Some(Engine {
        _ctx: ctx,
        main_state,
        _lang_ctx: lang_ctx,
        lang_state,
        coreml,
    });
    println!(
        "[Whisper] Model loaded successfully (encoder: {})",
        if coreml { "Core ML" } else { "Metal/CPU" }
    );
    Ok(())
}

pub fn is_coreml_active(state: &WhisperState) -> bool {
    state
        .model
        .lock()
        .map(|g| g.as_ref().map(|e| e.coreml).unwrap_or(false))
        .unwrap_or(false)
}

pub fn unload_model(state: &WhisperState) {
    let mut model_guard = state.lock_model();
    if model_guard.take().is_some() {
        println!("[Whisper] Model unloaded");
    }
}

pub fn is_model_loaded(state: &WhisperState) -> bool {
    state.model.lock().map(|g| g.is_some()).unwrap_or(false)
}

/// Index of the first sample of speech, or `None` if the clip is silent.
fn speech_start(samples: &[f32]) -> Option<usize> {
    let frame = TARGET_SAMPLE_RATE as usize / 50; // 20 ms
    if samples.len() < frame {
        return None;
    }
    let rms: Vec<f32> = samples
        .chunks_exact(frame)
        .map(|f| (f.iter().map(|s| s * s).sum::<f32>() / frame as f32).sqrt())
        .collect();
    let peak = rms.iter().cloned().fold(0.0f32, f32::max);
    if peak < SILENCE_FLOOR_RMS {
        return None;
    }
    let threshold = (peak * SILENCE_RATIO).max(SILENCE_FLOOR_RMS);
    let first = rms.iter().position(|&r| r >= threshold)?;
    let lead_in = (SPEECH_LEAD_IN_SECS * TARGET_SAMPLE_RATE as f32) as usize;
    Some((first * frame).saturating_sub(lead_in))
}

/// Detected language code with its probability, or `None` when the clip is
/// silent or the detector isn't confident.
fn detect_language(engine: &mut Engine, samples: &[f32]) -> Option<(String, f32)> {
    let state = &mut engine.lang_state;
    let start = speech_start(samples)?;
    let window = (LANG_DETECT_WINDOW_SECS * TARGET_SAMPLE_RATE as f32) as usize;
    let end = (start + window).min(samples.len());
    let threads = inference_threads();

    if let Err(e) = state.pcm_to_mel(&samples[start..end], threads) {
        eprintln!("[Whisper] Language detection mel failed: {}", e);
        return None;
    }
    let (id, probs) = match state.lang_detect(0, threads) {
        Ok(result) => result,
        Err(e) => {
            eprintln!("[Whisper] Language detection failed: {}", e);
            return None;
        }
    };
    let prob = probs.get(id as usize).copied().unwrap_or(0.0);
    let code = whisper_rs::get_lang_str(id)?;
    if prob < LANG_DETECT_MIN_PROB {
        println!(
            "[Whisper] Language detection unsure ({} at {:.2}), using full auto-detect",
            code, prob
        );
        return None;
    }
    Some((code.to_string(), prob))
}

/// Transcribe 16 kHz mono samples. `language` is an ISO 639-1 code or "auto".
pub fn transcribe(
    state: &WhisperState,
    samples: &[f32],
    language: &str,
    vocabulary_prompt: Option<&str>,
) -> Result<String, String> {
    let mut model_guard = state.lock_model();
    let engine = model_guard
        .as_mut()
        .ok_or("Whisper model not loaded. Download it in Settings → Models.")?;

    if samples.is_empty() {
        return Ok(String::new());
    }

    println!("[Whisper] Transcribing {} samples", samples.len());

    let resolved: String = if language == "auto" {
        let t = std::time::Instant::now();
        match detect_language(engine, samples) {
            Some((code, prob)) => {
                println!(
                    "[Whisper] Detected language {} (p = {:.2}) in {} ms",
                    code,
                    prob,
                    t.elapsed().as_millis()
                );
                code
            }
            None => "auto".to_string(),
        }
    } else {
        language.to_string()
    };

    run_inference(&mut engine.main_state, samples, &resolved, vocabulary_prompt)
}

fn run_inference(
    whisper_state: &mut whisper_rs::WhisperState,
    samples: &[f32],
    language: &str,
    vocabulary_prompt: Option<&str>,
) -> Result<String, String> {
    let mut params = base_params();
    params.set_suppress_blank(true);

    // Explicit codes skip whisper.cpp's own (expensive) detection pass;
    // "auto" only reaches here when detect_language declined to decide.
    params.set_language(Some(language));

    // Performance: disable temperature retry schedule (default retries up to 6x)
    params.set_temperature(0.0);
    params.set_temperature_inc(0.0);

    // No cross-segment context carryover needed for dictation
    params.set_no_context(true);

    // Bias the decoder toward the user's vocabulary (technical terms, names).
    // CString panics on null bytes, so strip them defensively.
    let sanitized_prompt = vocabulary_prompt
        .filter(|p| !p.is_empty())
        .map(|p| p.replace('\0', ""));
    if let Some(ref prompt) = sanitized_prompt {
        params.set_initial_prompt(prompt);
    }

    whisper_state
        .full(params, samples)
        .map_err(|e| format!("Whisper inference failed: {}", e))?;

    let mut text = String::new();
    for segment in whisper_state.as_iter() {
        if let Ok(segment_text) = segment.to_str_lossy() {
            text.push_str(&segment_text);
        }
    }

    Ok(text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speech_start_skips_leading_silence() {
        let sr = TARGET_SAMPLE_RATE as usize;
        let mut samples = vec![0.0f32; sr * 3];
        for (i, s) in samples.iter_mut().enumerate().skip(sr * 2) {
            *s = 0.3 * ((i as f32) * 0.05).sin();
        }
        let start = speech_start(&samples).expect("speech present");
        // first speech frame is at 2.0 s; lead-in pulls it back by 0.2 s
        assert!(start >= sr * 18 / 10 && start <= sr * 2, "start {}", start);
    }

    #[test]
    fn speech_start_is_none_for_silence() {
        let samples = vec![0.0f32; TARGET_SAMPLE_RATE as usize];
        assert_eq!(speech_start(&samples), None);
        assert_eq!(speech_start(&[]), None);
    }

    /// DICTATO_WHISPER_DIR=... DICTATO_TEST_WAV=... DICTATO_TEST_LANG=auto \
    /// cargo test whisper_transcribes_wav -- --nocapture --ignored
    #[test]
    #[ignore]
    fn whisper_transcribes_wav() {
        let dir = std::env::var("DICTATO_WHISPER_DIR").expect("DICTATO_WHISPER_DIR");
        let wav = std::env::var("DICTATO_TEST_WAV").expect("DICTATO_TEST_WAV");
        let lang = std::env::var("DICTATO_TEST_LANG").unwrap_or_else(|_| "auto".into());

        let state = WhisperState::default();
        let t0 = std::time::Instant::now();
        load_model(&state, Path::new(&dir)).expect("load");
        println!("load: {:?}", t0.elapsed());

        let samples = crate::local_audio::read_wav_as_f32_16k(Path::new(&wav)).expect("wav");
        // warm-up so shader compilation isn't counted
        transcribe(&state, &samples, &lang, None).expect("warm-up");
        let t1 = std::time::Instant::now();
        let text = transcribe(&state, &samples, &lang, None).expect("transcribe");
        println!(
            "transcribe: {:?} for {:.1}s audio\n>>> {}",
            t1.elapsed(),
            samples.len() as f32 / 16000.0,
            text
        );
        assert!(!text.trim().is_empty(), "empty transcript");
    }

    /// Encoder/decoder cost breakdown on the current build.
    /// DICTATO_WHISPER_DIR=... DICTATO_TEST_WAV=... cargo test whisper_profile -- --nocapture --ignored
    #[test]
    #[ignore]
    fn whisper_profile() {
        let dir = std::env::var("DICTATO_WHISPER_DIR").expect("DICTATO_WHISPER_DIR");
        let wav = std::env::var("DICTATO_TEST_WAV").expect("DICTATO_TEST_WAV");
        let state = WhisperState::default();
        let t = std::time::Instant::now();
        load_model(&state, Path::new(&dir)).expect("load");
        println!("load (incl. state): {:.0} ms", t.elapsed().as_secs_f64() * 1000.0);
        let samples = crate::local_audio::read_wav_as_f32_16k(Path::new(&wav)).expect("wav");
        let mut guard = state.lock_model();
        let engine = guard.as_mut().unwrap();
        println!("coreml: {}", engine.coreml);


        let threads = inference_threads();
        let mut best = |label: &str, f: &mut dyn FnMut() -> String| {
            let mut b = f64::MAX;
            let mut out = String::new();
            for _ in 0..3 {
                let t = std::time::Instant::now();
                out = f();
                b = b.min(t.elapsed().as_secs_f64() * 1000.0);
            }
            println!("{:<26} {:>6.0} ms  {}", label, b, out);
        };
        best("explicit pl (full pass)", &mut || {
            run_inference(&mut engine.main_state, &samples, "pl", None).unwrap()
        });
        best("stock auto (full pass)", &mut || {
            run_inference(&mut engine.main_state, &samples, "auto", None).unwrap()
        });
        best("encode only (main state)", &mut || {
            engine.main_state.pcm_to_mel(&samples, threads).unwrap();
            engine.main_state.encode(0, threads).unwrap();
            String::new()
        });
        best("lang_detect (main state)", &mut || {
            engine.main_state.pcm_to_mel(&samples, threads).unwrap();
            let (id, _) = engine.main_state.lang_detect(0, threads).unwrap();
            whisper_rs::get_lang_str(id).unwrap_or("?").to_string()
        });
        best("trimmed detect", &mut || {
            detect_language(engine, &samples).map(|(c, _)| c).unwrap_or_default()
        });
    }

    /// Detection accuracy and cost over several clips.
    /// DICTATO_WHISPER_DIR=... DICTATO_TEST_WAVS="a.wav:pl,b.wav:en" \
    /// cargo test whisper_language_detection -- --nocapture --ignored
    #[test]
    #[ignore]
    fn whisper_language_detection() {
        let dir = std::env::var("DICTATO_WHISPER_DIR").expect("DICTATO_WHISPER_DIR");
        let list = std::env::var("DICTATO_TEST_WAVS").expect("DICTATO_TEST_WAVS");
        let state = WhisperState::default();
        load_model(&state, Path::new(&dir)).expect("load");
        let mut guard = state.lock_model();
        let engine = guard.as_mut().unwrap();

        let mut misses = 0;
        for entry in list.split(',') {
            let (wav, expected) = entry.split_once(':').unwrap();
            let samples = crate::local_audio::read_wav_as_f32_16k(Path::new(wav)).expect("wav");
            let t = std::time::Instant::now();
            let detected = detect_language(engine, &samples);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            let name = Path::new(wav).file_name().unwrap().to_string_lossy();
            let ok = detected.as_ref().map(|(c, _)| c == expected).unwrap_or(false);
            if !ok {
                misses += 1;
            }
            println!(
                "{:<20} expected {:<3} got {:<14} {:>5.0} ms {}",
                name,
                expected,
                detected
                    .map(|(c, p)| format!("{} (p={:.2})", c, p))
                    .unwrap_or_else(|| "none".into()),
                ms,
                if ok { "OK" } else { "MISS" }
            );
        }
        assert_eq!(misses, 0, "language detection misses");
    }
}
