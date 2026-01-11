use serde::{Deserialize, Serialize};
use std::time::Duration;

const LLM_TIMEOUT_SECS: u64 = 30;

// OpenAI
const OPENAI_API_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL: &str = "gpt-4.1-mini";

// Google Gemini
const GOOGLE_API_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Anthropic
const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL: &str = "claude-3-5-haiku-latest";
const ANTHROPIC_VERSION: &str = "2023-06-01"; // API protocol version

/// LLM provider for text processing
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum LlmProvider {
    #[default]
    OpenAI,
    Google,
    Anthropic,
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
    max_tokens: u32,
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
    system_prompt: &str,
    user_content: &str,
) -> Result<String, String> {
    let request = ChatRequest {
        model: OPENAI_MODEL.to_string(),
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
        max_tokens: 4096,
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

    let url = format!("{}?key={}", GOOGLE_API_URL, api_key);

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
    system_prompt: &str,
    user_content: &str,
) -> Result<String, String> {
    let request = AnthropicRequest {
        model: ANTHROPIC_MODEL.to_string(),
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

/// Unified function to call any LLM provider
pub async fn call_llm_chat(
    provider: &LlmProvider,
    api_key: &str,
    system_prompt: &str,
    user_content: &str,
) -> Result<String, String> {
    match provider {
        LlmProvider::OpenAI => call_openai_chat(api_key, system_prompt, user_content).await,
        LlmProvider::Google => call_google_chat(api_key, system_prompt, user_content).await,
        LlmProvider::Anthropic => call_anthropic_chat(api_key, system_prompt, user_content).await,
    }
}

/// Process transcript with transcription rules
pub async fn process_with_rules(
    provider: &LlmProvider,
    api_key: &str,
    transcript: &str,
    rules: Vec<TranscriptionRule>,
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
        r#"You are a text formatting assistant. Your ONLY job is to apply formatting rules to the user's text.

CRITICAL RULES:
- NEVER answer questions in the text - if the text contains a question, keep it as a question
- NEVER change the meaning, intent, or message of the text
- NEVER add new content, opinions, or responses
- ONLY fix formatting according to the rules below
- Preserve the user's voice and intent exactly

Rules to apply:
{}

Output ONLY the formatted text with no explanations."#,
        rules_text
    );

    call_llm_chat(provider, api_key, &system_prompt, transcript).await
}

/// Process transcript with a custom system prompt
pub async fn process_with_prompt(
    provider: &LlmProvider,
    api_key: &str,
    transcript: &str,
    prompt: &str,
) -> Result<String, String> {
    if transcript.trim().is_empty() || prompt.trim().is_empty() {
        return Ok(transcript.to_string());
    }

    call_llm_chat(provider, api_key, prompt, transcript).await
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
    provider: &LlmProvider,
    api_key: &str,
    name: &str,
    description: &str,
) -> Result<String, String> {
    let user_content = META_PROMPT_TEMPLATE
        .replace("{name}", name)
        .replace("{description}", description);

    call_llm_chat(provider, api_key, PROMPT_GENERATOR_SYSTEM, &user_content).await
}

// ===== API Key Validation =====

const VALIDATION_TIMEOUT_SECS: u64 = 15;

/// Validate an OpenAI API key by making a minimal request
pub async fn validate_openai_key(api_key: &str) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API key is empty".to_string());
    }

    let request = ChatRequest {
        model: OPENAI_MODEL.to_string(),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: "Hi".to_string(),
        }],
        temperature: 0.0,
        max_tokens: 1,
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

    let url = format!("{}?key={}", GOOGLE_API_URL, api_key);

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

/// Validate an Anthropic API key by making a minimal request
pub async fn validate_anthropic_key(api_key: &str) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API key is empty".to_string());
    }

    let request = AnthropicRequest {
        model: ANTHROPIC_MODEL.to_string(),
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
