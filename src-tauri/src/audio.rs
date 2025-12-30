use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use rubato::{FftFixedIn, Resampler};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

const TARGET_SAMPLE_RATE: u32 = 24000;
const CHUNK_DURATION_MS: u64 = 100;
const MAX_BUFFER_SAMPLES: usize = 24000 * 60; // 1 minute of audio at 24kHz

// PCM16 conversion constants
const PCM16_MAX_POSITIVE: f32 = 32767.0;
const PCM16_MAX_NEGATIVE_ABS: f32 = 32768.0;

#[derive(Serialize, Clone)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

enum AudioCommand {
    Start {
        device_id: Option<String>,
        audio_sender: Sender<Vec<u8>>,
        level_sender: Sender<f32>,
    },
    Stop,
    Shutdown,
}

struct ActiveStream {
    _stream: Stream,
    processing_thread: Option<JoinHandle<()>>,
    is_capturing: Arc<AtomicBool>,
}

pub struct AudioCaptureHandle {
    command_tx: Sender<AudioCommand>,
    _thread: JoinHandle<()>,
}

impl AudioCaptureHandle {
    pub fn new() -> Self {
        let (command_tx, command_rx) = mpsc::channel();

        let thread = thread::spawn(move || {
            audio_thread(command_rx);
        });

        Self {
            command_tx,
            _thread: thread,
        }
    }

    pub fn start(
        &self,
        device_id: Option<String>,
        audio_sender: Sender<Vec<u8>>,
        level_sender: Sender<f32>,
    ) -> Result<(), String> {
        self.command_tx
            .send(AudioCommand::Start {
                device_id,
                audio_sender,
                level_sender,
            })
            .map_err(|e| format!("Failed to send start command: {}", e))
    }

    pub fn stop(&self) {
        let _ = self.command_tx.send(AudioCommand::Stop);
    }
}

impl Drop for AudioCaptureHandle {
    fn drop(&mut self) {
        let _ = self.command_tx.send(AudioCommand::Shutdown);
    }
}

pub fn list_input_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let default_device = host.default_input_device();
    let default_name = default_device
        .as_ref()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();

    let devices = host
        .input_devices()
        .map_err(|e| format!("Failed to get input devices: {}", e))?;

    let mut result = Vec::new();
    for device in devices {
        if let Ok(name) = device.name() {
            result.push(AudioDevice {
                id: name.clone(),
                name: name.clone(),
                is_default: name == default_name,
            });
        }
    }

    Ok(result)
}

fn get_device_by_id(device_id: Option<&str>) -> Result<Device, String> {
    let host = cpal::default_host();

    match device_id {
        Some(id) if !id.is_empty() => {
            let devices = host
                .input_devices()
                .map_err(|e| format!("Failed to get input devices: {}", e))?;

            for device in devices {
                if let Ok(name) = device.name() {
                    if name == id {
                        return Ok(device);
                    }
                }
            }
            host.default_input_device()
                .ok_or_else(|| "No default input device available".to_string())
        }
        _ => host
            .default_input_device()
            .ok_or_else(|| "No default input device available".to_string()),
    }
}

fn stop_active_stream(stream: &mut Option<ActiveStream>) {
    if let Some(mut active) = stream.take() {
        // Signal the processing thread to stop
        active.is_capturing.store(false, Ordering::SeqCst);

        // Drop the stream first to stop audio callbacks
        drop(active._stream);

        // Wait for the processing thread to complete
        if let Some(handle) = active.processing_thread.take() {
            if handle.join().is_err() {
                eprintln!("[Audio] Processing thread panicked");
            }
        }

        println!("[Audio] Capture stopped");
    }
}

fn audio_thread(command_rx: Receiver<AudioCommand>) {
    let mut current_stream: Option<ActiveStream> = None;

    loop {
        match command_rx.recv() {
            Ok(AudioCommand::Start {
                device_id,
                audio_sender,
                level_sender,
            }) => {
                // Stop any existing stream and wait for cleanup
                stop_active_stream(&mut current_stream);

                match create_stream(device_id.as_deref(), audio_sender, level_sender) {
                    Ok(active_stream) => {
                        current_stream = Some(active_stream);
                        println!("[Audio] Capture started");
                    }
                    Err(e) => {
                        eprintln!("[Audio] Failed to create stream: {}", e);
                    }
                }
            }
            Ok(AudioCommand::Stop) => {
                stop_active_stream(&mut current_stream);
            }
            Ok(AudioCommand::Shutdown) | Err(_) => {
                stop_active_stream(&mut current_stream);
                println!("[Audio] Thread shutting down");
                break;
            }
        }
    }
}

/// Shared audio processing: converts samples to mono, calculates level, and buffers
fn process_samples_to_buffer(
    samples: &[f32],
    channels: usize,
    buffer: &Arc<Mutex<Vec<f32>>>,
    level_sender: &Sender<f32>,
    samples_counter: &AtomicUsize,
) {
    // Convert to mono if stereo
    let mono_samples: Vec<f32> = if channels > 1 {
        samples
            .chunks(channels)
            .map(|chunk| chunk.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        samples.to_vec()
    };

    samples_counter.fetch_add(mono_samples.len(), Ordering::Relaxed);

    // Calculate audio level for visualization (peak level)
    let level = mono_samples
        .iter()
        .map(|s| s.abs())
        .fold(0.0f32, |a, b| a.max(b));

    let _ = level_sender.send(level);

    // Add to buffer with size limit
    match buffer.lock() {
        Ok(mut buf) => {
            let available_space = MAX_BUFFER_SAMPLES.saturating_sub(buf.len());
            if available_space > 0 {
                let samples_to_add = mono_samples.len().min(available_space);
                buf.extend(&mono_samples[..samples_to_add]);
            }
        }
        Err(poisoned) => {
            eprintln!(
                "[Audio] Buffer mutex poisoned, attempting recovery: {}",
                poisoned
            );
            // Recover the data from the poisoned mutex
            let mut buf = poisoned.into_inner();
            buf.clear(); // Clear potentially corrupted data
        }
    }
}

/// Convert float sample to PCM16
fn float_to_pcm16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    if clamped < 0.0 {
        (clamped * PCM16_MAX_NEGATIVE_ABS) as i16
    } else {
        (clamped * PCM16_MAX_POSITIVE) as i16
    }
}

fn create_stream(
    device_id: Option<&str>,
    audio_sender: Sender<Vec<u8>>,
    level_sender: Sender<f32>,
) -> Result<ActiveStream, String> {
    let device = get_device_by_id(device_id)?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default input config: {}", e))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let sample_format = config.sample_format();

    println!(
        "[Audio] Device config: {}Hz, {} channels, {:?}",
        sample_rate, channels, sample_format
    );

    let samples_per_chunk = (sample_rate as usize * CHUNK_DURATION_MS as usize) / 1000;

    // Create resampler if needed
    let resampler: Option<Arc<Mutex<FftFixedIn<f32>>>> = if sample_rate != TARGET_SAMPLE_RATE {
        Some(Arc::new(Mutex::new(
            FftFixedIn::new(
                sample_rate as usize,
                TARGET_SAMPLE_RATE as usize,
                samples_per_chunk,
                1,
                1,
            )
            .map_err(|e| format!("Failed to create resampler: {}", e))?,
        )))
    } else {
        None
    };

    let audio_buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let stream_config: StreamConfig = config.clone().into();
    let is_capturing = Arc::new(AtomicBool::new(true));

    let samples_received = Arc::new(AtomicUsize::new(0));

    let err_fn = |err| eprintln!("[Audio] Stream error: {}", err);

    // Build the stream based on sample format
    let stream = match sample_format {
        SampleFormat::F32 => {
            let audio_buffer_clone = audio_buffer.clone();
            let is_capturing_clone = is_capturing.clone();
            let level_sender_clone = level_sender.clone();
            let samples_received_clone = samples_received.clone();

            device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    if !is_capturing_clone.load(Ordering::SeqCst) {
                        return;
                    }
                    process_samples_to_buffer(
                        data,
                        channels,
                        &audio_buffer_clone,
                        &level_sender_clone,
                        &samples_received_clone,
                    );
                },
                err_fn,
                None,
            )
        }
        SampleFormat::I16 => {
            let audio_buffer_clone = audio_buffer.clone();
            let is_capturing_clone = is_capturing.clone();
            let level_sender_clone = level_sender.clone();
            let samples_received_clone = samples_received.clone();

            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    if !is_capturing_clone.load(Ordering::SeqCst) {
                        return;
                    }
                    // Convert i16 to f32
                    let float_data: Vec<f32> = data
                        .iter()
                        .map(|&s| s as f32 / PCM16_MAX_NEGATIVE_ABS)
                        .collect();
                    process_samples_to_buffer(
                        &float_data,
                        channels,
                        &audio_buffer_clone,
                        &level_sender_clone,
                        &samples_received_clone,
                    );
                },
                err_fn,
                None,
            )
        }
        _ => return Err(format!("Unsupported sample format: {:?}", sample_format)),
    }
    .map_err(|e| format!("Failed to build input stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    // Spawn processing thread
    let audio_buffer_process = audio_buffer.clone();
    let resampler_process = resampler.clone();
    let is_capturing_process = is_capturing.clone();
    let samples_received_log = samples_received.clone();

    let processing_thread = thread::spawn(move || {
        let mut total_bytes_sent: usize = 0;
        let mut iteration_count: usize = 0;

        loop {
            thread::sleep(std::time::Duration::from_millis(CHUNK_DURATION_MS));

            let samples: Vec<f32> = {
                match audio_buffer_process.lock() {
                    Ok(mut buffer) => buffer.drain(..).collect(),
                    Err(poisoned) => {
                        eprintln!("[Audio] Buffer mutex poisoned in processing thread");
                        let mut buffer = poisoned.into_inner();
                        buffer.drain(..).collect()
                    }
                }
            };

            iteration_count += 1;
            let is_running = is_capturing_process.load(Ordering::SeqCst);

            // Process samples if we have any
            if !samples.is_empty() {
                // Resample if needed
                let resampled = if let Some(ref resampler) = resampler_process {
                    match resampler.lock() {
                        Ok(mut resampler) => {
                            let mut input = samples;
                            let expected_len = resampler.input_frames_next();
                            input.resize(expected_len, 0.0);

                            match resampler.process(&[input], None) {
                                Ok(output) => output.into_iter().flatten().collect(),
                                Err(e) => {
                                    eprintln!("[Audio] Resample error: {}", e);
                                    if !is_running {
                                        break;
                                    }
                                    continue;
                                }
                            }
                        }
                        Err(poisoned) => {
                            eprintln!("[Audio] Resampler mutex poisoned");
                            let mut resampler = poisoned.into_inner();
                            let mut input = samples;
                            let expected_len = resampler.input_frames_next();
                            input.resize(expected_len, 0.0);

                            match resampler.process(&[input], None) {
                                Ok(output) => output.into_iter().flatten().collect(),
                                Err(e) => {
                                    eprintln!("[Audio] Resample error after recovery: {}", e);
                                    if !is_running {
                                        break;
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                } else {
                    samples
                };

                // Convert to PCM16
                let pcm16: Vec<u8> = resampled
                    .iter()
                    .flat_map(|&sample| float_to_pcm16(sample).to_le_bytes())
                    .collect();

                if !pcm16.is_empty() {
                    total_bytes_sent += pcm16.len();
                    let _ = audio_sender.send(pcm16);
                }
            }

            // Exit after processing remaining data if stopped
            if !is_running {
                let total_samples = samples_received_log.load(Ordering::Relaxed);
                println!(
                    "[Audio] Processing thread finished: {} iterations, {} samples received, {} bytes sent",
                    iteration_count, total_samples, total_bytes_sent
                );
                break;
            }
        }
    });

    Ok(ActiveStream {
        _stream: stream,
        processing_thread: Some(processing_thread),
        is_capturing,
    })
}
