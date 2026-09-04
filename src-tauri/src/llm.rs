use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::local_llm::{self, LocalLlmState};
use crate::models::{self, LocalModel, ModelKind};

const LLM_TIMEOUT_SECS: u64 = 30;

// OpenAI
const OPENAI_API_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODELS_URL: &str = "https://api.openai.com/v1/models";
pub const DEFAULT_OPENAI_MODEL: &str = "gpt-5.4-nano";

// Google Gemini
const GOOGLE_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";
pub const DEFAULT_GOOGLE_MODEL: &str = "gemini-3.1-flash-lite-preview";

// Anthropic
const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models";
pub const DEFAULT_ANTHROPIC_MODEL: &str = "claude-haiku-4-5";
const ANTHROPIC_VERSION: &str = "2023-06-01"; // API protocol version

/// Hosted LLM API
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudProvider {
    OpenAI,
    Google,
    Anthropic,
}

impl CloudProvider {
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "openai" => Some(Self::OpenAI),
            "google" => Some(Self::Google),
            "anthropic" => Some(Self::Anthropic),
            _ => None,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::OpenAI => "OpenAI",
            Self::Google => "Google",
            Self::Anthropic => "Anthropic",
        }
    }

    /// Fallback model used when the user hasn't picked one (or the store is empty)
    pub fn default_model(&self) -> &'static str {
        match self {
            Self::OpenAI => DEFAULT_OPENAI_MODEL,
            Self::Google => DEFAULT_GOOGLE_MODEL,
            Self::Anthropic => DEFAULT_ANTHROPIC_MODEL,
        }
    }
}

/// AI processing provider selected in Settings: a hosted API or a local
/// GGUF model from the Models page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LlmProvider {
    Cloud(CloudProvider),
    Local(LocalModel),
}

impl Default for LlmProvider {
    fn default() -> Self {
        Self::Cloud(CloudProvider::OpenAI)
    }
}

impl LlmProvider {
    /// Store value → provider. Unknown values fall back to the default so a
    /// removed model never leaves the app without a provider.
    pub fn from_store_value(s: &str) -> Self {
        if let Some(cloud) = CloudProvider::from_id(s) {
            return Self::Cloud(cloud);
        }
        match LocalModel::from_id(s) {
            Some(model) if model.kind() == ModelKind::Llm => Self::Local(model),
            _ => Self::default(),
        }
    }

    pub fn local_model(&self) -> Option<LocalModel> {
        match self {
            Self::Local(model) => Some(*model),
            Self::Cloud(_) => None,
        }
    }
}

/// A ready-to-call LLM: the provider plus everything a request needs.
/// Built by the app from settings once per processing run.
#[derive(Clone)]
pub enum LlmBackend {
    Cloud {
        provider: CloudProvider,
        api_key: String,
        model: String,
    },
    Local {
        model: LocalModel,
        engine: LocalLlmState,
    },
}

impl LlmBackend {
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Cloud { provider, .. } => provider.display_name(),
            Self::Local { model, .. } => model.name(),
        }
    }

    /// One chat completion: system prompt + user content → assistant text.
    pub async fn chat(&self, system_prompt: &str, user_content: &str) -> Result<String, String> {
        match self {
            Self::Cloud {
                provider,
                api_key,
                model,
            } => call_cloud_chat(*provider, api_key, model, system_prompt, user_content).await,
            Self::Local { model, engine } => {
                // Inference is CPU/GPU-bound and blocks; the in-use flag
                // stops the model from being deleted while it runs.
                let engine = engine.clone();
                let system_prompt = system_prompt.to_string();
                let user_content = user_content.to_string();
                let model = *model;
                models::set_in_use(model, true);
                let result = tokio::task::spawn_blocking(move || {
                    local_llm::generate(&engine, &system_prompt, &user_content)
                })
                .await;
                models::set_in_use(model, false);
                // Prefixed so the UI shows engine errors verbatim instead of
                // the cloud-oriented "check your API key" fallback.
                result
                    .map_err(|e| format!("Local model task failed: {}", e))?
                    .map_err(|e| {
                        if e.starts_with("Local model") || e.starts_with("Transcript too long") {
                            e
                        } else {
                            format!("Local model error: {}", e)
                        }
                    })
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionRule {
    pub id: String,
    pub title: String,
    pub description: String,
    pub enabled: bool,
    #[serde(rename = "isBuiltIn")]
    pub is_built_in: bool,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_completion_tokens: u32,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Deserialize)]
struct ChatMessageResponse {
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

// ===== Google Gemini Structures =====

#[derive(Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Serialize)]
struct GeminiContentItem {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiGenerationConfig {
    temperature: f32,
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
}

#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContentItem>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

#[derive(Deserialize)]
struct GeminiPartResponse {
    text: String,
}

#[derive(Deserialize)]
struct GeminiContentResponse {
    parts: Vec<GeminiPartResponse>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: GeminiContentResponse,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

// ===== Anthropic Structures =====

#[derive(Serialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<AnthropicMessage>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: String,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
}

/// Call OpenAI chat API
async fn call_openai_chat(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_content: &str,
) -> Result<String, String> {
    let request = ChatRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_content.to_string(),
            },
        ],
        temperature: 0.3, // Low for consistency
        max_completion_tokens: 4096,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(LLM_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let response = client
        .post(OPENAI_API_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error {}: {}", status, body));
    }

    let result: ChatResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

    result
        .choices
        .first()
        .map(|c| c.message.content.trim().to_string())
        .ok_or_else(|| "No response from LLM".to_string())
}

/// Call Google Gemini API
async fn call_google_chat(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_content: &str,
) -> Result<String, String> {
    // Gemini combines system prompt with user message
    let contents = vec![GeminiContentItem {
        role: "user".to_string(),
        parts: vec![GeminiPart {
            text: format!(
                "{}\n\nNow process this text:\n{}",
                system_prompt, user_content
            ),
        }],
    }];

    let request = GeminiRequest {
        contents,
        generation_config: GeminiGenerationConfig {
            temperature: 0.3,
            max_output_tokens: 4096,
        },
    };

    let url = format!("{}/{}:generateContent?key={}", GOOGLE_API_BASE, model, api_key);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(LLM_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Gemini API error {}: {}", status, body));
    }

    let result: GeminiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

    result
        .candidates
        .first()
        .and_then(|c| c.content.parts.first())
        .map(|p| p.text.trim().to_string())
        .ok_or_else(|| "No response from Gemini".to_string())
}

/// Call Anthropic Claude API
async fn call_anthropic_chat(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_content: &str,
) -> Result<String, String> {
    let request = AnthropicRequest {
        model: model.to_string(),
        max_tokens: 4096,
        system: system_prompt.to_string(),
        messages: vec![AnthropicMessage {
            role: "user".to_string(),
            content: user_content.to_string(),
        }],
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(LLM_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let response = client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error {}: {}", status, body));
    }

    let result: AnthropicResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

    result
        .content
        .first()
        .map(|c| c.text.trim().to_string())
        .ok_or_else(|| "No response from Anthropic".to_string())
}

/// Call any hosted provider's chat API
async fn call_cloud_chat(
    provider: CloudProvider,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_content: &str,
) -> Result<String, String> {
    match provider {
        CloudProvider::OpenAI => call_openai_chat(api_key, model, system_prompt, user_content).await,
        CloudProvider::Google => call_google_chat(api_key, model, system_prompt, user_content).await,
        CloudProvider::Anthropic => {
            call_anthropic_chat(api_key, model, system_prompt, user_content).await
        }
    }
}

/// Shared context block for every transcript-processing prompt. The input is
/// raw speech-to-text output, so the model must be allowed to repair obvious
/// mis-transcriptions (the old prompt forbade touching words at all) and must
/// preserve the speaker's language(s), including mixed-language dictation.
pub fn build_transcript_context(language: &str, dictionary: &[String]) -> String {
    let mut context = String::from(
        r#"TRANSCRIPT INPUT CONTEXT:
The text is a raw speech-to-text transcript and may contain mis-transcribed words, especially technical terms, product names, and code identifiers.
- If a word or phrase is clearly a mis-transcription given the context, correct it to the intended term (e.g. "get hub" -> "GitHub", "use effect hook" -> "useEffect hook"). Only correct when the intended term is obvious; never guess.
- Keep the transcript's original language exactly. Mixed-language text (e.g. Polish sentences containing English technical terms) is intentional: NEVER translate any part in either direction.
- Technical terms, identifiers, and product names stay in their original (usually English) form even when the surrounding sentence is in another language."#,
    );

    if !language.is_empty() && language != "auto" {
        context.push_str(&format!(
            "\n- The speaker's primary language is \"{}\" (ISO 639-1); the output must be in the same language(s) as the input.",
            language
        ));
    }

    if !dictionary.is_empty() {
        context.push_str(&format!(
            "\n- User's custom vocabulary. When a transcript word plausibly matches one of these terms, use this exact spelling: {}.",
            dictionary.join(", ")
        ));
    }

    // Small local models weigh the end of the prompt most; without this
    // closing line Gemma 3 4B rewrote a Polish dictation as an English email
    // when a mode asked for "professional" output.
    context.push_str("\n\nOUTPUT LANGUAGE: the same language(s) as the transcript. Never translate");
    match language_name(language) {
        Some(name) => context.push_str(&format!("; a {} transcript stays {}.", name, name)),
        None => context.push('.'),
    }

    context
}

/// English name for the language codes offered in Settings, for prompts.
fn language_name(code: &str) -> Option<&'static str> {
    Some(match code {
        "en" => "English",
        "pl" => "Polish",
        "es" => "Spanish",
        "fr" => "French",
        "de" => "German",
        "it" => "Italian",
        "pt" => "Portuguese",
        "nl" => "Dutch",
        "ja" => "Japanese",
        "zh" => "Chinese",
        "ko" => "Korean",
        "ru" => "Russian",
        "uk" => "Ukrainian",
        _ => return None,
    })
}

/// Process transcript with transcription rules
pub async fn process_with_rules(
    backend: &LlmBackend,
    transcript: &str,
    rules: Vec<TranscriptionRule>,
    language: &str,
    dictionary: &[String],
) -> Result<String, String> {
    // Filter to only enabled rules
    let enabled_rules: Vec<_> = rules.iter().filter(|r| r.enabled).collect();

    if enabled_rules.is_empty() || transcript.trim().is_empty() {
        return Ok(transcript.to_string());
    }

    // Build the system prompt with rules
    let rules_text = enabled_rules
        .iter()
        .map(|r| format!("- {}: {}", r.title, r.description))
        .collect::<Vec<_>>()
        .join("\n");

    let system_prompt = format!(
        r#"You are a voice transcript cleanup assistant. Your ONLY job is to clean up the user's transcript and apply their formatting rules.

CRITICAL RULES:
- NEVER answer questions in the text - if the text contains a question, keep it as a question
- NEVER change the meaning, intent, or message of the text
- NEVER add new content, opinions, or responses
- Preserve the user's voice and intent exactly

{}

Rules to apply:
{}

Output ONLY the cleaned-up text with no explanations."#,
        build_transcript_context(language, dictionary),
        rules_text
    );

    backend.chat(&system_prompt, transcript).await
}

/// Process transcript with a custom system prompt
pub async fn process_with_prompt(
    backend: &LlmBackend,
    transcript: &str,
    prompt: &str,
    language: &str,
    dictionary: &[String],
) -> Result<String, String> {
    if transcript.trim().is_empty() || prompt.trim().is_empty() {
        return Ok(transcript.to_string());
    }

    // Mode prompts (built-in or user-generated) don't know the input is a raw
    // voice transcript; append the shared context so every mode benefits from
    // mis-transcription repair and language preservation.
    let system_prompt = format!("{}\n\n{}", prompt, build_transcript_context(language, dictionary));

    backend.chat(&system_prompt, transcript).await
}

/// System prompt for the meta-prompt generator
const PROMPT_GENERATOR_SYSTEM: &str = r#"You are a senior prompt engineer. Your task is to generate a system prompt for a text transformation assistant based on the user's description. Follow the requirements exactly. Output ONLY the generated prompt with no explanations, commentary, or markdown formatting."#;

/// Meta-prompt template for generating custom mode prompts
const META_PROMPT_TEMPLATE: &str = r#"You are a senior prompt engineer specializing in creating system prompts for text transformation AI assistants.

Your task is to create a system prompt based on the mode name and description provided.

Requirements for the generated prompt:
1. Start with "You are a [role] that transforms voice transcriptions"
2. CRITICAL: Include a rule that the AI must NEVER answer questions in the text - only format/transform it
3. Be specific about the desired output format and tone
4. Keep it concise but comprehensive (max 150 words)
5. End with "Output ONLY the transformed text with no explanations"

Mode name: {name}
Mode description: {description}

Generate the system prompt now:"#;

/// Generate a mode prompt using the meta-prompt approach.
/// Takes the mode name and description, constructs the full prompt, and calls the LLM.
pub async fn generate_mode_prompt(
    backend: &LlmBackend,
    name: &str,
    description: &str,
) -> Result<String, String> {
    let user_content = META_PROMPT_TEMPLATE
        .replace("{name}", name)
        .replace("{description}", description);

    backend.chat(PROMPT_GENERATOR_SYSTEM, &user_content).await
}

// ===== API Key Validation =====

const VALIDATION_TIMEOUT_SECS: u64 = 15;

/// Validate an OpenAI API key by making a minimal request
pub async fn validate_openai_key(api_key: &str) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API key is empty".to_string());
    }

    let request = ChatRequest {
        model: DEFAULT_OPENAI_MODEL.to_string(),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: "Hi".to_string(),
        }],
        temperature: 0.0,
        max_completion_tokens: 1,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(VALIDATION_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let response = client
        .post(OPENAI_API_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status.as_u16() == 401 {
            return Err("Invalid API key".to_string());
        }
        if status.as_u16() == 429 {
            // Rate limited but key is valid
            return Ok(());
        }
        return Err(format!("API error {}: {}", status, body));
    }

    Ok(())
}

/// Validate a Google API key by making a minimal request
pub async fn validate_google_key(api_key: &str) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API key is empty".to_string());
    }

    let request = GeminiRequest {
        contents: vec![GeminiContentItem {
            role: "user".to_string(),
            parts: vec![GeminiPart {
                text: "Hi".to_string(),
            }],
        }],
        generation_config: GeminiGenerationConfig {
            temperature: 0.0,
            max_output_tokens: 1,
        },
    };

    let url = format!(
        "{}/{}:generateContent?key={}",
        GOOGLE_API_BASE, DEFAULT_GOOGLE_MODEL, api_key
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(VALIDATION_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if body.contains("API_KEY_INVALID") || status.as_u16() == 400 {
            return Err("Invalid API key".to_string());
        }
        if status.as_u16() == 429 || body.contains("RESOURCE_EXHAUSTED") {
            // Quota exceeded - key format is valid but billing issue
            return Err("API quota exceeded. Check your billing.".to_string());
        }
        return Err(format!("API error {}: {}", status, body));
    }

    Ok(())
}

// ===== Live Model Listing =====

/// A selectable chat model, as reported by the provider's list-models API
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
}

#[derive(Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModelEntry>,
}

#[derive(Deserialize)]
struct OpenAiModelEntry {
    id: String,
}

#[derive(Deserialize)]
struct GeminiModelsResponse {
    models: Vec<GeminiModelEntry>,
}

#[derive(Deserialize)]
struct GeminiModelEntry {
    /// Fully-qualified name, e.g. "models/gemini-3.1-flash-lite-preview"
    name: String,
    #[serde(rename = "displayName", default)]
    display_name: String,
    #[serde(rename = "supportedGenerationMethods", default)]
    supported_generation_methods: Vec<String>,
}

#[derive(Deserialize)]
struct AnthropicModelsResponse {
    data: Vec<AnthropicModelEntry>,
}

#[derive(Deserialize)]
struct AnthropicModelEntry {
    id: String,
    #[serde(default)]
    display_name: String,
}

fn models_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(VALIDATION_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))
}

async fn read_success_body(response: reqwest::Response, provider: &str) -> Result<String, String> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{} models API error {}: {}", provider, status, body));
    }
    Ok(body)
}

/// OpenAI's /v1/models returns every model type (embeddings, TTS, image, ...);
/// keep only chat-completions-capable model families
fn is_openai_chat_model(id: &str) -> bool {
    let is_gpt = id.starts_with("gpt-");
    let is_o_series = id.starts_with('o')
        && id
            .chars()
            .nth(1)
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false);
    if !is_gpt && !is_o_series {
        return false;
    }
    const NON_CHAT_MARKERS: &[&str] = &[
        "audio",
        "realtime",
        "tts",
        "transcribe",
        "whisper",
        "embedding",
        "moderation",
        "image",
        "dall-e",
        "instruct",
        "search",
        "computer-use",
        "codex",
    ];
    !NON_CHAT_MARKERS.iter().any(|m| id.contains(m))
}

async fn list_openai_models(api_key: &str) -> Result<Vec<ModelInfo>, String> {
    let response = models_client()?
        .get(OPENAI_MODELS_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("OpenAI models request failed: {}", e))?;

    let body = read_success_body(response, "OpenAI").await?;
    let result: OpenAiModelsResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse OpenAI models response: {}", e))?;

    let mut models: Vec<ModelInfo> = result
        .data
        .into_iter()
        .filter(|m| is_openai_chat_model(&m.id))
        .map(|m| ModelInfo {
            display_name: m.id.clone(),
            id: m.id,
        })
        .collect();
    // Newest families sort last alphabetically within a prefix; descending puts them on top
    models.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(models)
}

async fn list_google_models(api_key: &str) -> Result<Vec<ModelInfo>, String> {
    let url = format!("{}?key={}&pageSize=1000", GOOGLE_API_BASE, api_key);
    let response = models_client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Gemini models request failed: {}", e))?;

    let body = read_success_body(response, "Gemini").await?;
    let result: GeminiModelsResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Gemini models response: {}", e))?;

    let mut models: Vec<ModelInfo> = result
        .models
        .into_iter()
        .filter(|m| {
            m.supported_generation_methods
                .iter()
                .any(|method| method == "generateContent")
        })
        .map(|m| {
            let id = m.name.strip_prefix("models/").unwrap_or(&m.name).to_string();
            let display_name = if m.display_name.is_empty() {
                id.clone()
            } else {
                m.display_name
            };
            ModelInfo { id, display_name }
        })
        .collect();
    models.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(models)
}

async fn list_anthropic_models(api_key: &str) -> Result<Vec<ModelInfo>, String> {
    let url = format!("{}?limit=100", ANTHROPIC_MODELS_URL);
    let response = models_client()?
        .get(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .send()
        .await
        .map_err(|e| format!("Anthropic models request failed: {}", e))?;

    let body = read_success_body(response, "Anthropic").await?;
    let result: AnthropicModelsResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Anthropic models response: {}", e))?;

    // Already sorted newest-first by the API; every entry is a chat model
    Ok(result
        .data
        .into_iter()
        .map(|m| {
            let display_name = if m.display_name.is_empty() {
                m.id.clone()
            } else {
                m.display_name
            };
            ModelInfo {
                id: m.id,
                display_name,
            }
        })
        .collect())
}

/// Fetch the list of selectable chat models live from the provider
pub async fn list_models(
    provider: CloudProvider,
    api_key: &str,
) -> Result<Vec<ModelInfo>, String> {
    match provider {
        CloudProvider::OpenAI => list_openai_models(api_key).await,
        CloudProvider::Google => list_google_models(api_key).await,
        CloudProvider::Anthropic => list_anthropic_models(api_key).await,
    }
}

/// Validate an Anthropic API key by making a minimal request
pub async fn validate_anthropic_key(api_key: &str) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API key is empty".to_string());
    }

    let request = AnthropicRequest {
        model: DEFAULT_ANTHROPIC_MODEL.to_string(),
        max_tokens: 1,
        system: "Be brief.".to_string(),
        messages: vec![AnthropicMessage {
            role: "user".to_string(),
            content: "Hi".to_string(),
        }],
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(VALIDATION_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let response = client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status.as_u16() == 401 {
            return Err("Invalid API key".to_string());
        }
        if status.as_u16() == 429 {
            // Rate limited but key is valid
            return Ok(());
        }
        return Err(format!("API error {}: {}", status, body));
    }

    Ok(())
}
