//! Audio helpers for local speech-to-text.
//!
//! Local engines consume 16 kHz mono f32 samples in [-1.0, 1.0]. The mic
//! pipeline captures 24 kHz PCM16 (the OpenAI Realtime format), so the
//! conversion + resampling lives here rather than inside the engine.

use rubato::{FftFixedIn, Resampler};
use std::path::Path;

/// Sample rate every local model expects.
pub const TARGET_SAMPLE_RATE: u32 = 16000;
/// Sample rate of the mic capture pipeline (PCM16 LE).
pub const INPUT_SAMPLE_RATE: u32 = 24000;

/// i16::MAX + 1, for normalizing PCM16 to [-1.0, 1.0]
const PCM16_NORMALIZE: f32 = 32768.0;

/// Convert little-endian PCM16 bytes to normalized f32 samples.
pub fn pcm16_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / PCM16_NORMALIZE)
        .collect()
}

/// Convert the mic pipeline's 24 kHz PCM16 buffer to 16 kHz f32 samples.
pub fn pcm16_24k_to_16k(bytes: &[u8]) -> Result<Vec<f32>, String> {
    let samples = pcm16_to_f32(bytes);
    resample(&samples, INPUT_SAMPLE_RATE, TARGET_SAMPLE_RATE)
}

/// Resample audio using FFT-based resampling with proper anti-aliasing.
/// Processes in fixed-size chunks so the internal resampler state carries over
/// and no tail audio is lost.
pub fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Result<Vec<f32>, String> {
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

/// Read a PCM WAV file (as produced by the ffmpeg pipeline) and return
/// 16 kHz mono f32 samples, downmixing and resampling as needed.
pub fn read_wav_as_f32_16k(file_path: &Path) -> Result<Vec<f32>, String> {
    let data =
        std::fs::read(file_path).map_err(|e| format!("Failed to read audio file: {}", e))?;

    if data.len() < 44 || &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return Err("Not a valid WAV file".to_string());
    }

    // Find "fmt " chunk
    let mut pos = 12;
    let mut sample_rate = TARGET_SAMPLE_RATE;
    let mut bits_per_sample = 16u16;
    let mut num_channels = 1u16;

    while pos + 8 < data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size =
            u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
                as usize;

        if chunk_id == b"fmt " && chunk_size >= 16 {
            num_channels = u16::from_le_bytes([data[pos + 10], data[pos + 11]]);
            sample_rate = u32::from_le_bytes([
                data[pos + 12],
                data[pos + 13],
                data[pos + 14],
                data[pos + 15],
            ]);
            bits_per_sample = u16::from_le_bytes([data[pos + 22], data[pos + 23]]);
            break;
        }

        pos += 8 + chunk_size;
        if chunk_size % 2 != 0 {
            pos += 1; // chunks are 2-byte aligned
        }
    }

    // Find "data" chunk
    pos = 12;
    let mut audio_data: &[u8] = &[];
    while pos + 8 < data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size =
            u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
                as usize;

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

    let mut samples: Vec<f32> = match bits_per_sample {
        16 => pcm16_to_f32(audio_data),
        32 => audio_data
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect(),
        _ => return Err(format!("Unsupported bits per sample: {}", bits_per_sample)),
    };

    if num_channels > 1 {
        let ch = num_channels as usize;
        samples = samples
            .chunks_exact(ch)
            .map(|frame| frame.iter().sum::<f32>() / ch as f32)
            .collect();
    }

    if sample_rate != TARGET_SAMPLE_RATE {
        samples = resample(&samples, sample_rate, TARGET_SAMPLE_RATE)?;
    }

    Ok(samples)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm16_round_trips_full_scale() {
        let bytes = [0x00, 0x80, 0xFF, 0x7F, 0x00, 0x00];
        let samples = pcm16_to_f32(&bytes);
        assert_eq!(samples, vec![-1.0, 32767.0 / 32768.0, 0.0]);
    }

    #[test]
    fn resample_scales_length_by_rate_ratio() {
        let samples = vec![0.25f32; 24000];
        let out = resample(&samples, 24000, 16000).unwrap();
        // one extra flush chunk is expected, but the ratio must hold
        assert!(out.len() >= 16000 && out.len() < 16000 + 1024);
    }
}
