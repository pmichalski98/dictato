import { invoke } from "@tauri-apps/api/core";

/**
 * Generate a system prompt for a custom mode using AI.
 * The Rust backend handles all prompt construction and LLM calls.
 */
export async function generateModePrompt(name: string, description: string): Promise<string> {
  return invoke<string>("generate_mode_prompt", { name, description });
}
