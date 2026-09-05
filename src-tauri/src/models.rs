//! Registry of downloadable local models: speech-to-text engines and the
//! language models that clean up transcripts.
//!
//! Every local model is described here by a [`ModelSpec`]: where its files
//! live on Hugging Face, how big they are, and which languages it handles.
//! Downloading, deleting, and status reporting are generic over the spec so
//! the engines themselves only deal with inference. Whisper is the only
//! speech-to-text engine; Parakeet, Canary and Cohere Transcribe were
//! evaluated and dropped because Whisper beat them on Polish accuracy. The
//! LLMs are GGUF files run by `local_llm.rs` (llama.cpp); see that module
//! for how they were picked.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

// Event names (mirrored in src/lib/constants.ts)
pub const EVENT_DOWNLOAD_PROGRESS: &str = "model-download-progress";
pub const EVENT_MODELS_CHANGED: &str = "local-models-changed";

/// Minimum interval between download progress events
const PROGRESS_THROTTLE_MS: u128 = 100;

/// What a local model is used for. Determines which engine loads it and
/// which Settings provider it can be selected as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelKind {
    /// Speech-to-text (dictation transcription)
    Stt,
    /// Text LLM (rules and modes)
    Llm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalModel {
    Whisper,
    Gemma4E2b,
    Gemma4E4b,
    Bielik4_5b,
}

/// One downloadable file of a model.
pub struct ModelFile {
    pub url: &'static str,
    pub local_name: &'static str,
    /// Expected size, used for UI labels and as a fallback when the server
    /// doesn't report Content-Length.
    pub size_bytes: u64,
    /// When set, the download is a zip archive that gets extracted into the
    /// model directory; this is the extracted entry whose presence counts as
    /// "installed". The archive is deleted afterwards.
    pub unzip_to: Option<&'static str>,
}

impl ModelFile {
    /// Path that must exist for this file to count as present.
    fn installed_path(&self, dir: &Path) -> PathBuf {
        dir.join(self.unzip_to.unwrap_or(self.local_name))
    }
}

/// An optional add-on for a model, e.g. a hardware-specific encoder.
pub struct Accelerator {
    pub name: &'static str,
    pub description: &'static str,
    pub file: ModelFile,
}

pub struct ModelSpec {
    pub kind: ModelKind,
    pub name: &'static str,
    pub description: &'static str,
    pub languages: &'static str,
    pub dir_name: &'static str,
    /// For LLMs the first file is the GGUF weights.
    pub files: &'static [ModelFile],
    /// Optional speed-up the user can add on top of the required files.
    pub accelerator: Option<&'static Accelerator>,
}

impl ModelSpec {
    pub fn total_size_bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size_bytes).sum()
    }
}

/// Core ML build of the encoder for Apple Silicon's Neural Engine. macOS
/// compiles it on first load (~30 s) and caches the result.
#[cfg(target_os = "macos")]
const WHISPER_COREML_ENCODER: Accelerator = Accelerator {
    name: "Neural Engine encoder",
    description: "Runs the encoder on the Apple Neural Engine via Core ML, about 30% faster per dictation. Uses ~600 MB more memory and takes ~30 s to compile on first load.",
    file: ModelFile {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-encoder.mlmodelc.zip",
        local_name: "ggml-large-v3-turbo-encoder.mlmodelc.zip",
        size_bytes: 1_173_393_014,
        unzip_to: Some(crate::whisper::COREML_ENCODER_DIR_NAME),
    },
};

const WHISPER_SPEC: ModelSpec = ModelSpec {
    kind: ModelKind::Stt,
    name: "Whisper large-v3-turbo",
    description: "OpenAI Whisper, q5_0 quantized, Metal GPU on macOS. Auto-detects language and supports dictionary biasing.",
    languages: "99 languages, auto-detect",
    dir_name: "models/whisper-large-v3-turbo",
    files: &[ModelFile {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
        local_name: "ggml-large-v3-turbo-q5_0.bin",
        size_bytes: 574_041_195,
        unzip_to: None,
    }],
    #[cfg(target_os = "macos")]
    accelerator: Some(&WHISPER_COREML_ENCODER),
    #[cfg(not(target_os = "macos"))]
    accelerator: None,
};

// ============== Local LLMs (GGUF, llama.cpp) ==============
//
// Chosen for transcript cleanup in Polish and English on a laptop: small
// enough to load in a second and answer in 1-2 s, big enough to follow
// "output only the cleaned text" and keep mixed-language dictation
// untranslated. Tested and dropped (Sept 2026): Gemma 3 4B and Qwen3 4B
// (fine but slower and slightly worse than Gemma 4 E2B), Qwen3.5 2B/4B
// (recurrent architecture defeats the KV-cache tricks that make requests
// fast; 2B also makes Polish mistakes), PLLuM 4B (translated English to
// Polish), Qwen3 1.7B and Gemma 3 1B (echo the input or translate it).
// Bielik 4.5B made Polish typos and wrote an English email in the same
// test but is kept as a Polish-specialist option to compare against.

const GEMMA4_E2B_SPEC: ModelSpec = ModelSpec {
    kind: ModelKind::Llm,
    name: "Gemma 4 E2B",
    description: "Google Gemma 4 E2B instruct, QAT Q4_K_XL. Best quality and speed of the local options; recommended.",
    languages: "140+ languages",
    dir_name: "models/gemma-4-e2b",
    files: &[ModelFile {
        url: "https://huggingface.co/unsloth/gemma-4-E2B-it-qat-GGUF/resolve/main/gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf",
        local_name: "gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf",
        size_bytes: 2_620_370_976,
        unzip_to: None,
    }],
    accelerator: None,
};

const GEMMA4_E4B_SPEC: ModelSpec = ModelSpec {
    kind: ModelKind::Llm,
    name: "Gemma 4 E4B",
    description: "Google Gemma 4 E4B instruct, QAT Q4_K_XL. Bigger sibling of E2B for harder modes; about half the speed.",
    languages: "140+ languages",
    dir_name: "models/gemma-4-e4b",
    files: &[ModelFile {
        url: "https://huggingface.co/unsloth/gemma-4-E4B-it-qat-GGUF/resolve/main/gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf",
        local_name: "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf",
        size_bytes: 4_215_695_776,
        unzip_to: None,
    }],
    accelerator: None,
};

const BIELIK_4_5B_SPEC: ModelSpec = ModelSpec {
    kind: ModelKind::Llm,
    name: "Bielik 4.5B v3",
    description: "SpeakLeash Bielik 4.5B v3 instruct, Q5_K_M. Polish-first model; weaker at English and slower than Gemma 4 in our tests, offered for comparison.",
    languages: "Polish, English",
    dir_name: "models/bielik-4.5b",
    files: &[ModelFile {
        url: "https://huggingface.co/second-state/Bielik-4.5B-v3.0-Instruct-GGUF/resolve/main/Bielik-4.5B-v3.0-Instruct-Q5_K_M.gguf",
        local_name: "Bielik-4.5B-v3.0-Instruct-Q5_K_M.gguf",
        size_bytes: 3_378_598_912,
        unzip_to: None,
    }],
    accelerator: None,
};

impl LocalModel {
    /// Every model the app can offer. LLMs are macOS only for now: the
    /// in-process llama.cpp engine can't be linked next to whisper.cpp on
    /// Windows/Linux (see local_llm.rs), so those builds don't list them.
    #[cfg(target_os = "macos")]
    pub const ALL: [LocalModel; 4] = [
        LocalModel::Whisper,
        LocalModel::Gemma4E2b,
        LocalModel::Gemma4E4b,
        LocalModel::Bielik4_5b,
    ];
    #[cfg(not(target_os = "macos"))]
    pub const ALL: [LocalModel; 1] = [LocalModel::Whisper];

    pub fn id(&self) -> &'static str {
        match self {
            LocalModel::Whisper => "whisper",
            LocalModel::Gemma4E2b => "gemma-4-e2b",
            LocalModel::Gemma4E4b => "gemma-4-e4b",
            LocalModel::Bielik4_5b => "bielik-4.5b",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|m| m.id() == id)
    }

    pub fn spec(&self) -> &'static ModelSpec {
        match self {
            LocalModel::Whisper => &WHISPER_SPEC,
            LocalModel::Gemma4E2b => &GEMMA4_E2B_SPEC,
            LocalModel::Gemma4E4b => &GEMMA4_E4B_SPEC,
            LocalModel::Bielik4_5b => &BIELIK_4_5B_SPEC,
        }
    }

    pub fn name(&self) -> &'static str {
        self.spec().name
    }

    pub fn kind(&self) -> ModelKind {
        self.spec().kind
    }

    /// Every model of one kind, in display order.
    pub fn of_kind(kind: ModelKind) -> impl Iterator<Item = LocalModel> {
        Self::ALL.into_iter().filter(move |m| m.kind() == kind)
    }
}

/// Speech-to-text provider selected in Settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SttProvider {
    Groq,
    Local(LocalModel),
}

impl SttProvider {
    pub fn from_store_value(s: &str) -> Self {
        match LocalModel::from_id(s) {
            Some(model) if model.kind() == ModelKind::Stt => Self::Local(model),
            _ => Self::Groq,
        }
    }

    pub fn local_model(&self) -> Option<LocalModel> {
        match self {
            Self::Local(m) => Some(*m),
            Self::Groq => None,
        }
    }
}

// ============== Runtime flags ==============

/// Models currently running inference, so they can't be deleted or
/// unloaded underneath the engine.
static IN_USE: Lazy<Mutex<HashMap<LocalModel, ()>>> = Lazy::new(|| Mutex::new(HashMap::new()));

pub fn set_in_use(model: LocalModel, active: bool) {
    let mut guard = IN_USE.lock().unwrap_or_else(|p| p.into_inner());
    if active {
        guard.insert(model, ());
    } else {
        guard.remove(&model);
    }
}

pub fn is_in_use(model: LocalModel) -> bool {
    IN_USE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .contains_key(&model)
}

/// Models currently being loaded into memory (so the UI can show a spinner).
static LOADING: Lazy<Mutex<HashMap<LocalModel, ()>>> = Lazy::new(|| Mutex::new(HashMap::new()));

pub fn set_loading(model: LocalModel, loading: bool) {
    let mut guard = LOADING.lock().unwrap_or_else(|p| p.into_inner());
    if loading {
        guard.insert(model, ());
    } else {
        guard.remove(&model);
    }
}

pub fn is_loading(model: LocalModel) -> bool {
    LOADING
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .contains_key(&model)
}

/// Active downloads keyed by model, holding their cancellation flag.
static DOWNLOADS: Lazy<Mutex<HashMap<LocalModel, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn is_downloading(model: LocalModel) -> bool {
    DOWNLOADS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .contains_key(&model)
}

/// Request cancellation of an in-flight download. The download loop notices
/// on its next chunk, removes the partial file and returns an error.
pub fn cancel_download(model: LocalModel) {
    if let Some(flag) = DOWNLOADS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(&model)
    {
        flag.store(true, Ordering::SeqCst);
    }
}

fn begin_download(model: LocalModel) -> Result<Arc<AtomicBool>, String> {
    let mut guard = DOWNLOADS.lock().unwrap_or_else(|p| p.into_inner());
    if guard.contains_key(&model) {
        return Err(format!("{} is already downloading", model.name()));
    }
    let flag = Arc::new(AtomicBool::new(false));
    guard.insert(model, flag.clone());
    Ok(flag)
}

fn end_download(model: LocalModel) {
    DOWNLOADS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(&model);
}

/// Tell the UI to refetch model statuses.
pub fn emit_changed(app: &AppHandle) {
    app.emit(EVENT_MODELS_CHANGED, ()).ok();
}

/// Thread count for CPU inference. Capped so the UI stays responsive.
pub fn inference_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8)
}

// ============== Files on disk ==============

pub fn model_dir(app: &AppHandle, model: LocalModel) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data.join(model.spec().dir_name))
}

fn file_present(path: &Path) -> bool {
    path.exists() && path.metadata().map(|m| m.len() > 0).unwrap_or(false)
}

fn installed(dir: &Path, file: &ModelFile) -> bool {
    let path = file.installed_path(dir);
    if file.unzip_to.is_some() {
        path.is_dir()
    } else {
        file_present(&path)
    }
}

pub fn is_downloaded(app: &AppHandle, model: LocalModel) -> bool {
    match model_dir(app, model) {
        Ok(dir) => model.spec().files.iter().all(|f| installed(&dir, f)),
        Err(_) => false,
    }
}

pub fn is_accelerator_installed(app: &AppHandle, model: LocalModel) -> bool {
    match (model.spec().accelerator, model_dir(app, model)) {
        (Some(acc), Ok(dir)) => installed(&dir, &acc.file),
        _ => false,
    }
}

/// Remove the accelerator's files, leaving the base model in place.
pub fn delete_accelerator(app: &AppHandle, model: LocalModel) -> Result<(), String> {
    let Some(acc) = model.spec().accelerator else {
        return Ok(());
    };
    let dir = model_dir(app, model)?;
    let path = acc.file.installed_path(&dir);
    if path.is_dir() {
        std::fs::remove_dir_all(&path)
            .map_err(|e| format!("Failed to delete accelerator: {}", e))?;
    } else if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete accelerator: {}", e))?;
    }
    std::fs::remove_file(dir.join(acc.file.local_name)).ok();
    println!("[Models] {} {} deleted", model.name(), acc.name);
    Ok(())
}

/// Recursive size of a directory (Core ML models are directories).
fn disk_bytes(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| {
                    let path = e.path();
                    match e.metadata() {
                        Ok(m) if m.is_dir() => disk_bytes(&path),
                        Ok(m) if m.is_file() => m.len(),
                        _ => 0,
                    }
                })
                .sum()
        })
        .unwrap_or(0)
}

pub fn delete(app: &AppHandle, model: LocalModel) -> Result<(), String> {
    let dir = model_dir(app, model)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Failed to delete model: {}", e))?;
        println!("[Models] {} deleted from {:?}", model.name(), dir);
    }
    Ok(())
}

// ============== Status ==============

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceleratorStatus {
    pub name: &'static str,
    pub description: &'static str,
    pub size_bytes: u64,
    pub installed: bool,
    /// True once the loaded engine is actually using it.
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelStatus {
    pub id: &'static str,
    pub kind: ModelKind,
    pub name: &'static str,
    pub description: &'static str,
    pub languages: &'static str,
    /// Expected download size in bytes
    pub size_bytes: u64,
    /// Bytes currently on disk (partial downloads included)
    pub disk_bytes: u64,
    pub downloaded: bool,
    pub downloading: bool,
    pub loading: bool,
    pub loaded: bool,
    pub accelerator: Option<AcceleratorStatus>,
}

pub fn status(
    app: &AppHandle,
    model: LocalModel,
    loaded: bool,
    accelerator_active: bool,
) -> LocalModelStatus {
    let spec = model.spec();
    let disk = model_dir(app, model).map(|d| disk_bytes(&d)).unwrap_or(0);
    LocalModelStatus {
        id: model.id(),
        kind: spec.kind,
        name: spec.name,
        description: spec.description,
        languages: spec.languages,
        size_bytes: spec.total_size_bytes(),
        disk_bytes: disk,
        downloaded: is_downloaded(app, model),
        downloading: is_downloading(model),
        loading: is_loading(model),
        loaded,
        accelerator: spec.accelerator.map(|acc| AcceleratorStatus {
            name: acc.name,
            description: acc.description,
            size_bytes: acc.file.size_bytes,
            installed: is_accelerator_installed(app, model),
            active: accelerator_active,
        }),
    }
}

// ============== Download ==============

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress<'a> {
    model: &'a str,
    percent: f64,
    bytes_downloaded: u64,
    total_bytes: u64,
    file_index: usize,
    file_count: usize,
    file_name: &'a str,
}

/// Download every missing file of `model` into its directory, emitting
/// aggregate progress across all files. Files are written to `.tmp` and
/// renamed on completion so an interrupted download never leaves a
/// truncated file that looks complete. With `with_accelerator` the optional
/// accelerator is fetched too.
pub async fn download(
    app: AppHandle,
    model: LocalModel,
    with_accelerator: bool,
) -> Result<(), String> {
    let cancel = begin_download(model)?;
    emit_changed(&app);

    let result = download_inner(&app, model, with_accelerator, &cancel).await;

    end_download(model);
    emit_changed(&app);
    result
}

/// File size announced by a HEAD response. `Response::content_length()`
/// can't be used: reqwest derives it from the body, which is empty for
/// HEAD, so it reports 0 and the progress bar never moves. Hugging Face
/// also sends the size of an LFS file as `x-linked-size`.
fn header_size(resp: &reqwest::Response) -> Option<u64> {
    ["content-length", "x-linked-size"]
        .iter()
        .filter_map(|name| resp.headers().get(*name)?.to_str().ok()?.parse::<u64>().ok())
        .find(|&size| size > 0)
}

/// Extract a zip archive into `dir` with the system unzip, then remove the
/// archive and macOS resource-fork clutter.
fn extract_zip(archive: &Path, dir: &Path) -> Result<(), String> {
    let status = std::process::Command::new("unzip")
        .arg("-q")
        .arg("-o")
        .arg(archive)
        .arg("-d")
        .arg(dir)
        .status()
        .map_err(|e| format!("Failed to run unzip: {}", e))?;
    if !status.success() {
        return Err(format!("unzip failed with {}", status));
    }
    std::fs::remove_dir_all(dir.join("__MACOSX")).ok();
    std::fs::remove_file(archive).ok();
    Ok(())
}

async fn download_inner(
    app: &AppHandle,
    model: LocalModel,
    with_accelerator: bool,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let spec = model.spec();
    let dir = model_dir(app, model)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create model dir: {}", e))?;

    // Clean up leftover temp files from interrupted downloads
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_str()
                .map(|n| n.ends_with(".tmp"))
                .unwrap_or(false)
            {
                std::fs::remove_file(entry.path()).ok();
            }
        }
    }

    let client = reqwest::Client::builder()
        .user_agent("dictato")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut pending: Vec<&ModelFile> = spec
        .files
        .iter()
        .filter(|f| !installed(&dir, f))
        .collect();
    if with_accelerator {
        if let Some(acc) = spec.accelerator {
            if !installed(&dir, &acc.file) {
                pending.push(&acc.file);
            }
        }
    }

    if pending.is_empty() {
        println!("[Models] {} already downloaded", model.name());
        return Ok(());
    }

    // Resolve real sizes up front so the progress bar covers all files.
    let mut sizes: Vec<u64> = Vec::with_capacity(pending.len());
    for file in &pending {
        let size = match client.head(file.url).send().await {
            Ok(resp) if resp.status().is_success() => {
                header_size(&resp).unwrap_or(file.size_bytes)
            }
            _ => file.size_bytes,
        };
        sizes.push(size);
    }
    let total_bytes: u64 = sizes.iter().sum();
    let file_count = pending.len();
    let mut downloaded_before: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    for (index, (file, expected)) in pending.iter().zip(sizes.iter()).enumerate() {
        let local_path = dir.join(file.local_name);
        let temp_path = dir.join(format!("{}.tmp", file.local_name));

        println!(
            "[Models] {} downloading {} ({}/{})",
            model.name(),
            file.local_name,
            index + 1,
            file_count
        );

        let response = client
            .get(file.url)
            .send()
            .await
            .map_err(|e| format!("Failed to download {}: {}", file.local_name, e))?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to download {} (HTTP {})",
                file.local_name,
                response.status()
            ));
        }

        let mut out = std::fs::File::create(&temp_path)
            .map_err(|e| format!("Failed to create file: {}", e))?;
        let mut file_bytes: u64 = 0;
        let mut stream = response;

        use std::io::Write;
        loop {
            if cancel.load(Ordering::SeqCst) {
                drop(out);
                std::fs::remove_file(&temp_path).ok();
                println!("[Models] {} download cancelled", model.name());
                return Err("Download cancelled".to_string());
            }

            let chunk = match stream.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(e) => {
                    drop(out);
                    std::fs::remove_file(&temp_path).ok();
                    return Err(format!("Download error: {}", e));
                }
            };

            out.write_all(&chunk)
                .map_err(|e| format!("Write error: {}", e))?;
            file_bytes += chunk.len() as u64;

            if last_emit.elapsed().as_millis() >= PROGRESS_THROTTLE_MS {
                let done = downloaded_before + file_bytes;
                let percent = if total_bytes > 0 {
                    (done as f64 / total_bytes as f64 * 100.0).min(100.0)
                } else {
                    0.0
                };
                app.emit(
                    EVENT_DOWNLOAD_PROGRESS,
                    DownloadProgress {
                        model: model.id(),
                        percent,
                        bytes_downloaded: done,
                        total_bytes,
                        file_index: index + 1,
                        file_count,
                        file_name: file.local_name,
                    },
                )
                .ok();
                last_emit = std::time::Instant::now();
            }
        }

        drop(out);
        std::fs::rename(&temp_path, &local_path)
            .map_err(|e| format!("Failed to finalize download: {}", e))?;

        if let Some(extracted) = file.unzip_to {
            app.emit(
                EVENT_DOWNLOAD_PROGRESS,
                DownloadProgress {
                    model: model.id(),
                    percent: (downloaded_before + file_bytes) as f64 / total_bytes.max(1) as f64 * 100.0,
                    bytes_downloaded: downloaded_before + file_bytes,
                    total_bytes,
                    file_index: index + 1,
                    file_count,
                    file_name: "Extracting…",
                },
            )
            .ok();
            println!("[Models] Extracting {} → {}", file.local_name, extracted);
            let archive = local_path.clone();
            let target = dir.clone();
            tokio::task::spawn_blocking(move || extract_zip(&archive, &target))
                .await
                .map_err(|e| format!("Extract task failed: {}", e))??;
        }

        // Use the real byte count from here on so the bar never jumps backwards
        downloaded_before += file_bytes.max(*expected);
        println!(
            "[Models] {} downloaded ({} bytes)",
            file.local_name, file_bytes
        );
    }

    app.emit(
        EVENT_DOWNLOAD_PROGRESS,
        DownloadProgress {
            model: model.id(),
            percent: 100.0,
            bytes_downloaded: total_bytes,
            total_bytes,
            file_index: file_count,
            file_count,
            file_name: "",
        },
    )
    .ok();

    Ok(())
}
