use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

/// Pre-compiled regex for validating YouTube URLs (compiled once at startup)
static YOUTUBE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(https?://)?(www\.)?(youtube\.com/(watch\?v=|shorts/)|youtu\.be/)[\w-]+").unwrap()
});

// ============== Audio Processing Constants ==============

/// Sample rate for ffmpeg audio encoding (24kHz)
const AUDIO_SAMPLE_RATE: &str = "24000";
/// Number of audio channels (1 = mono)
const AUDIO_CHANNELS: &str = "1";
/// Audio quality level for libmp3lame (0-9, lower is better)
const AUDIO_QUALITY: &str = "2";
/// Duration of each chunk when splitting large files (10 minutes)
pub const CHUNK_DURATION_SECONDS: u32 = 600;

/// Status of external dependencies (yt-dlp, ffmpeg)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyStatus {
    pub yt_dlp_installed: bool,
    pub ffmpeg_installed: bool,
    pub yt_dlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
}

/// Result of a transcription operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub raw_text: String,
    pub processed_text: Option<String>,
    pub duration_seconds: f64,
    pub word_count: usize,
}

/// Supported audio formats that Groq API accepts directly
const SUPPORTED_AUDIO_FORMATS: &[&str] = &["mp3", "wav", "m4a", "ogg", "flac", "webm"];

/// Supported video formats that need audio extraction
const SUPPORTED_VIDEO_FORMATS: &[&str] = &["mp4", "mov", "avi", "mkv", "webm"];

/// Check if yt-dlp is installed and return its version
pub fn check_yt_dlp() -> (bool, Option<String>) {
    match Command::new("yt-dlp").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            (true, Some(version))
        }
        _ => (false, None),
    }
}

/// Check if ffmpeg is installed and return its version
pub fn check_ffmpeg() -> (bool, Option<String>) {
    match Command::new("ffmpeg").arg("-version").output() {
        Ok(output) if output.status.success() => {
            // Extract just the first line with version info
            let full_output = String::from_utf8_lossy(&output.stdout);
            let version = full_output
                .lines()
                .next()
                .map(|s| s.to_string())
                .unwrap_or_default();
            (true, Some(version))
        }
        _ => (false, None),
    }
}

/// Check all dependencies and return their status
pub fn check_dependencies() -> DependencyStatus {
    let (yt_dlp_installed, yt_dlp_version) = check_yt_dlp();
    let (ffmpeg_installed, ffmpeg_version) = check_ffmpeg();

    DependencyStatus {
        yt_dlp_installed,
        ffmpeg_installed,
        yt_dlp_version,
        ffmpeg_version,
    }
}

/// Get file extension in lowercase
fn get_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
}

/// Check if the file is a supported audio format
pub fn is_supported_audio(path: &Path) -> bool {
    get_extension(path)
        .map(|ext| SUPPORTED_AUDIO_FORMATS.contains(&ext.as_str()))
        .unwrap_or(false)
}

/// Check if the file is a supported video format
pub fn is_supported_video(path: &Path) -> bool {
    get_extension(path)
        .map(|ext| SUPPORTED_VIDEO_FORMATS.contains(&ext.as_str()))
        .unwrap_or(false)
}

/// Check if the file format is supported (audio or video)
pub fn is_supported_format(path: &Path) -> bool {
    is_supported_audio(path) || is_supported_video(path)
}

/// Get audio duration in seconds using ffprobe
pub fn get_audio_duration(path: &Path) -> Result<f64, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let duration_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    duration_str
        .parse::<f64>()
        .map_err(|e| format!("Failed to parse duration: {}", e))
}

/// Get common audio encoding arguments for ffmpeg
fn get_audio_encoding_args() -> [&'static str; 8] {
    [
        "-acodec", "libmp3lame",
        "-ar", AUDIO_SAMPLE_RATE,
        "-ac", AUDIO_CHANNELS,
        "-q:a", AUDIO_QUALITY,
    ]
}

/// Extract audio from video file using ffmpeg
/// Returns path to the extracted audio file
pub fn extract_audio_from_video(
    video_path: &Path,
    output_dir: &Path,
) -> Result<PathBuf, String> {
    let output_path = output_dir.join("extracted_audio.mp3");
    let encoding_args = get_audio_encoding_args();

    let status = Command::new("ffmpeg")
        .arg("-i")
        .arg(video_path.to_str().ok_or("Invalid video path")?)
        .arg("-vn") // No video
        .args(encoding_args)
        .arg("-y") // Overwrite output
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        return Err(format!("ffmpeg extraction failed: {}", stderr));
    }

    Ok(output_path)
}

/// Convert audio file to format suitable for Groq API
/// Returns path to the converted file
#[allow(dead_code)]
pub fn convert_audio_for_api(
    input_path: &Path,
    output_dir: &Path,
) -> Result<PathBuf, String> {
    let output_path = output_dir.join("converted_audio.mp3");
    let encoding_args = get_audio_encoding_args();

    let status = Command::new("ffmpeg")
        .arg("-i")
        .arg(input_path.to_str().ok_or("Invalid input path")?)
        .args(encoding_args)
        .arg("-y") // Overwrite output
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        return Err(format!("ffmpeg conversion failed: {}", stderr));
    }

    Ok(output_path)
}

/// Callback type for progress updates
pub type ProgressCallback = Box<dyn Fn(f32, &str) + Send>;

/// Download audio from YouTube URL using yt-dlp with progress tracking
/// Returns path to the downloaded audio file
#[allow(dead_code)]
pub fn download_youtube_audio(
    url: &str,
    output_dir: &Path,
) -> Result<PathBuf, String> {
    download_youtube_audio_with_progress(url, output_dir, None)
}

/// Download audio from YouTube URL using yt-dlp with optional progress callback
pub fn download_youtube_audio_with_progress(
    url: &str,
    output_dir: &Path,
    progress_callback: Option<ProgressCallback>,
) -> Result<PathBuf, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;

    println!("[YouTube] Starting download from: {}", url);
    let output_template = output_dir.join("youtube_audio.%(ext)s");

    let mut child = Command::new("yt-dlp")
        .args([
            "-x",                    // Extract audio
            "--audio-format", "mp3", // Convert to mp3
            "--audio-quality", "0",  // Best quality
            "--newline",             // Output progress on new lines
            "--progress",            // Show progress
            "-o",
        ])
        .arg(output_template.to_str().ok_or("Invalid output path")?)
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    // Read stderr for progress updates
    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                println!("[YouTube] {}", line);

                // Parse progress from yt-dlp output
                // Format: [download]  XX.X% of ~XXX.XXMB at XXX.XXKB/s
                if line.contains("[download]") && line.contains("%") {
                    if let Some(percent_str) = line.split_whitespace()
                        .find(|s| s.ends_with('%'))
                        .and_then(|s| s.strip_suffix('%'))
                    {
                        if let Ok(percent) = percent_str.parse::<f32>() {
                            if let Some(ref callback) = progress_callback {
                                callback(percent, &line);
                            }
                        }
                    }
                }
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Failed to wait for yt-dlp: {}", e))?;

    if !status.success() {
        return Err("yt-dlp download failed. Check if the video is available.".to_string());
    }

    println!("[YouTube] Download complete, looking for output file...");

    // Find the downloaded file
    let output_path = output_dir.join("youtube_audio.mp3");
    if output_path.exists() {
        println!("[YouTube] Found output file: {:?}", output_path);
        Ok(output_path)
    } else {
        // Try to find any audio file in the output dir
        let found = std::fs::read_dir(output_dir)
            .map_err(|e| format!("Failed to read output dir: {}", e))?
            .filter_map(|e| e.ok())
            .find(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "mp3" || ext == "m4a" || ext == "webm")
                    .unwrap_or(false)
            })
            .map(|e| e.path());

        match found {
            Some(path) => {
                println!("[YouTube] Found output file: {:?}", path);
                Ok(path)
            }
            None => {
                println!("[YouTube] ERROR: No audio file found in output directory");
                Err("Downloaded file not found".to_string())
            }
        }
    }
}

/// Validate YouTube URL using pre-compiled regex for performance
/// Matches standard YouTube URLs, short URLs, and shorts:
///   - https://www.youtube.com/watch?v=VIDEO_ID
///   - https://youtu.be/VIDEO_ID
///   - https://www.youtube.com/shorts/VIDEO_ID
pub fn is_valid_youtube_url(url: &str) -> bool {
    YOUTUBE_REGEX.is_match(url)
}

/// Create a temporary directory for processing
pub fn create_temp_dir() -> Result<TempDir, String> {
    tempfile::tempdir().map_err(|e| format!("Failed to create temp dir: {}", e))
}

/// Get file size in bytes
pub fn get_file_size(path: &Path) -> Result<u64, String> {
    std::fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| format!("Failed to get file size: {}", e))
}

/// Maximum file size for direct upload (24MB)
pub const MAX_DIRECT_UPLOAD_SIZE: u64 = 24 * 1024 * 1024;

/// Check if file needs chunking
pub fn needs_chunking(path: &Path) -> Result<bool, String> {
    let size = get_file_size(path)?;
    Ok(size > MAX_DIRECT_UPLOAD_SIZE)
}

/// Split audio file into chunks for large file processing
/// Returns paths to chunk files
pub fn split_audio_file(
    input_path: &Path,
    output_dir: &Path,
    chunk_duration_seconds: u32,
) -> Result<Vec<PathBuf>, String> {
    let output_pattern = output_dir.join("chunk_%03d.mp3");

    let status = Command::new("ffmpeg")
        .args([
            "-i",
            input_path.to_str().ok_or("Invalid input path")?,
            "-f", "segment",
            "-segment_time",
            &chunk_duration_seconds.to_string(),
            "-c", "copy",
            "-y",
        ])
        .arg(output_pattern.to_str().ok_or("Invalid output pattern")?)
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        return Err(format!("ffmpeg split failed: {}", stderr));
    }

    // Collect all chunk files
    let mut chunks: Vec<PathBuf> = std::fs::read_dir(output_dir)
        .map_err(|e| format!("Failed to read output dir: {}", e))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("chunk_"))
                .unwrap_or(false)
        })
        .collect();

    chunks.sort();
    Ok(chunks)
}
