use serde::{Deserialize, Serialize};
use std::time::Duration;

const LLM_TIMEOUT_SECS: u64 = 30;
const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL: &str = "llama-3.1-8b-instant";

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

/// Shared function to make Groq chat API calls
async fn call_groq_chat(
    api_key: &str,
    system_prompt: &str,
    user_content: &str,
) -> Result<String, String> {
    let request = ChatRequest {
        model: DEFAULT_MODEL.to_string(),
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
        .post(GROQ_API_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Groq Chat API error {}: {}", status, body));
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

/// Process transcript with transcription rules
pub async fn process_with_rules(
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
        "You are a text editor. Apply the following rules to the user's text and return ONLY the edited text, nothing else. Do not add any explanations, greetings, or commentary.\n\nRules to apply:\n{}\n\nIMPORTANT: Output only the processed text with no additional content.",
        rules_text
    );

    call_groq_chat(api_key, &system_prompt, transcript).await
}

/// Process transcript with a custom system prompt
pub async fn process_with_prompt(
    api_key: &str,
    transcript: &str,
    prompt: &str,
) -> Result<String, String> {
    if transcript.trim().is_empty() || prompt.trim().is_empty() {
        return Ok(transcript.to_string());
    }

    call_groq_chat(api_key, prompt, transcript).await
}
