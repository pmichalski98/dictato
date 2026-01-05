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
    api_key: &str,
    name: &str,
    description: &str,
) -> Result<String, String> {
    let user_content = META_PROMPT_TEMPLATE
        .replace("{name}", name)
        .replace("{description}", description);

    call_groq_chat(api_key, PROMPT_GENERATOR_SYSTEM, &user_content).await
}
