//! Local LLM inference for rules and modes via llama.cpp (llama-cpp-2).
//!
//! The selected GGUF model stays loaded while it is the active AI provider,
//! like Whisper does for dictation, together with one context whose KV cache
//! persists between requests. Two things make a request cheap:
//!
//! 1. **Prefix reuse.** The system prompt (rules or mode, ~400 tokens) is
//!    identical from one dictation to the next, so only the tokens after the
//!    longest common prefix with the previous request are processed. On an
//!    M3 Pro that turns ~850 ms of prompt processing into ~20-250 ms.
//! 2. **Prompt-lookup speculative decoding.** Cleaned-up text is mostly a
//!    copy of the transcript, so the next few tokens are guessed by finding
//!    the last generated n-gram in the transcript and proposing what followed
//!    it. The guesses are verified in one batched decode; sampling is greedy,
//!    so the output is exactly what plain decoding would produce, just in
//!    fewer passes over the weights.
//!
//! Model choice (Sept 2026, M3 Pro): Gemma 4 E2B (QAT, 2.6 GB) gave the
//! best Polish + English cleanup of eleven candidates and the best speed
//! (65-78 tok/s; a short dictation in ~0.8 s, an 80-word one in ~2 s). The
//! registry in `models.rs` lists what was rejected and why.

use std::num::NonZeroU32;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use once_cell::sync::OnceCell;

use crate::models::{inference_threads, LocalModel};

/// Tokens fed to the model per decode call while processing the prompt.
const PROMPT_BATCH: usize = 512;
/// Context created on load; grown (and the cache dropped) when a request
/// needs more. Covers a ~450 token system prompt plus a few minutes of
/// dictation and its rewrite.
const DEFAULT_CONTEXT: u32 = 2048;
/// Contexts grow in these steps so a slightly longer dictation doesn't
/// rebuild the cache every time.
const CONTEXT_STEP: u32 = 512;
/// Never generate more than this many tokens, whatever the input size.
const MAX_NEW_TOKENS_CAP: u32 = 3072;
/// Floor for the generation budget so short inputs can still be expanded
/// (e.g. by an email mode).
const MAX_NEW_TOKENS_MIN: u32 = 256;
/// Slack added to the context so the template and stop tokens always fit.
const CONTEXT_MARGIN: u32 = 64;
/// Offload every layer to the GPU where a GPU backend exists (Metal on
/// macOS); ignored by the CPU-only builds.
const ALL_GPU_LAYERS: u32 = 999;

/// Longest n-gram used to look up a draft; falls back to shorter ones.
const DRAFT_NGRAM_MAX: usize = 3;
const DRAFT_NGRAM_MIN: usize = 2;
/// Tokens proposed per draft. Verifying a batch of this size costs about
/// the same as a single token on Metal, and longer drafts measured faster
/// than short ones (12-24 beat 3-8 by ~30% on Gemma 3 4B).
const DRAFT_MAX: usize = 16;
/// Drafts are looked up in the transcript and the generated text only, not
/// in the system prompt; this many tokens covers the chat-template tail
/// between the transcript and the assistant turn.
const TEMPLATE_TAIL_TOKENS: usize = 16;

/// Thinking-capable models are told to skip the thinking phase by
/// pre-filling an empty think block; without it Qwen3 reasons for hundreds
/// of tokens before answering.
const NO_THINK_PREFILL: &str = "<think>\n\n</think>\n\n";

/// How a model's chat prompt is laid out.
#[derive(Clone, Copy, PartialEq, Eq)]
enum PromptFormat {
    /// The template baked into the GGUF, rendered by llama.cpp's built-in
    /// engine.
    Builtin,
    /// Gemma 4's `<|turn>` format, which llama.cpp's built-in engine at the
    /// pinned commit doesn't know (it only has the Gemma 3 one).
    Gemma4,
}

struct Engine {
    id: LocalModel,
    /// Borrows `model`. Declared first so it is dropped before the model;
    /// `model` is boxed so its address is stable while the engine moves.
    ctx: Option<LlamaContext<'static>>,
    /// Token sequence whose KV entries the context currently holds.
    cached: Vec<LlamaToken>,
    model: Box<LlamaModel>,
}

impl Engine {
    /// Make sure the context exists and holds `needed` tokens, (re)creating
    /// it otherwise. Recreating drops the cached prefix.
    fn ensure_context(&mut self, needed: u32) -> Result<(), String> {
        let too_small = self.ctx.as_ref().map(|c| c.n_ctx() < needed).unwrap_or(true);
        if too_small {
            self.ctx = None;
            self.cached.clear();
            let n_ctx = needed
                .max(DEFAULT_CONTEXT)
                .div_ceil(CONTEXT_STEP)
                * CONTEXT_STEP;
            let n_ctx = n_ctx.min(self.model.n_ctx_train().max(needed));
            let threads = inference_threads() as i32;
            let params = LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(n_ctx))
                .with_n_batch(PROMPT_BATCH as u32)
                .with_n_threads(threads)
                .with_n_threads_batch(threads);
            // SAFETY: the context only outlives this borrow inside `self`,
            // where it is dropped before `model` (field order) and `model`
            // never moves out of its Box while the engine exists.
            let model: &'static LlamaModel = unsafe { &*(&*self.model as *const LlamaModel) };
            let ctx = model
                .new_context(backend()?, params)
                .map_err(|e| format!("Failed to create llama context: {}", e))?;
            println!("[LocalLLM] Context of {} tokens ready", n_ctx);
            self.ctx = Some(ctx);
        }
        Ok(())
    }
}

// SAFETY: llama.cpp contexts and models have no thread affinity; they only
// must not be used concurrently, and every access goes through the mutex in
// `LocalLlmState`.
unsafe impl Send for Engine {}

#[derive(Clone, Default)]
pub struct LocalLlmState {
    engine: Arc<Mutex<Option<Engine>>>,
}

impl LocalLlmState {
    fn lock_engine(&self) -> MutexGuard<'_, Option<Engine>> {
        match self.engine.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("[LocalLLM] Mutex poisoned, recovering");
                poisoned.into_inner()
            }
        }
    }
}

/// llama.cpp's backend is process-global and must be initialised exactly
/// once; every load and generate goes through this.
fn backend() -> Result<&'static LlamaBackend, String> {
    static BACKEND: OnceCell<LlamaBackend> = OnceCell::new();
    BACKEND.get_or_try_init(|| {
        LlamaBackend::init().map_err(|e| format!("Failed to initialise llama.cpp: {}", e))
    })
}

fn gguf_path(model: LocalModel, model_dir: &Path) -> std::path::PathBuf {
    model_dir.join(model.spec().files[0].local_name)
}

fn needs_no_think_prefill(model: LocalModel) -> bool {
    // No shipped model thinks by default (Gemma 4 only with `<|think|>`,
    // Qwen3 4B Instruct 2507 is the non-thinking variant); kept for the next
    // thinking-capable addition.
    let _ = model;
    false
}

fn prompt_format(model: LocalModel) -> PromptFormat {
    match model {
        LocalModel::Gemma4E2b | LocalModel::Gemma4E4b => PromptFormat::Gemma4,
        _ => PromptFormat::Builtin,
    }
}

/// Gemma 4 turn format; the BOS is added by the tokenizer.
fn render_gemma4(system_prompt: &str, user_content: &str) -> String {
    format!(
        "<|turn>system\n{}<turn|>\n<|turn>user\n{}<turn|>\n<|turn>model\n",
        system_prompt, user_content
    )
}

pub fn load_model(state: &LocalLlmState, model: LocalModel, model_dir: &Path) -> Result<(), String> {
    let mut guard = state.lock_engine();
    if guard.as_ref().map(|e| e.id) == Some(model) {
        println!("[LocalLLM] {} already loaded", model.name());
        return Ok(());
    }
    // Free the previous model before mapping the next one.
    *guard = None;

    let path = gguf_path(model, model_dir);
    println!("[LocalLLM] Loading {} from {:?}", model.name(), path);
    let t = std::time::Instant::now();

    let params = LlamaModelParams::default().with_n_gpu_layers(ALL_GPU_LAYERS);
    let llama_model = LlamaModel::load_from_file(backend()?, &path, &params)
        .map_err(|e| format!("Failed to load {}: {}", model.name(), e))?;

    let mut engine = Engine {
        id: model,
        ctx: None,
        cached: Vec::new(),
        model: Box::new(llama_model),
    };
    // Warm up: creating the context compiles the GPU pipelines, and one
    // decode primes them, so the first dictation isn't the slow one.
    if let Err(e) = warm_up(&mut engine) {
        eprintln!("[LocalLLM] Warm-up failed: {}", e);
    }

    println!(
        "[LocalLLM] {} loaded in {} ms",
        model.name(),
        t.elapsed().as_millis()
    );
    *guard = Some(engine);
    Ok(())
}

fn warm_up(engine: &mut Engine) -> Result<(), String> {
    let bos = engine.model.token_bos();
    engine.ensure_context(DEFAULT_CONTEXT)?;
    let ctx = engine.ctx.as_mut().expect("context was just ensured");
    let mut batch = LlamaBatch::new(1, 1);
    batch
        .add(bos, 0, &[0], true)
        .map_err(|e| format!("Failed to build batch: {}", e))?;
    ctx.decode(&mut batch)
        .map_err(|e| format!("Warm-up decode failed: {}", e))?;
    ctx.clear_kv_cache();
    Ok(())
}

pub fn unload_model(state: &LocalLlmState) {
    let mut guard = state.lock_engine();
    if let Some(engine) = guard.take() {
        println!("[LocalLLM] {} unloaded", engine.id.name());
    }
}

/// The model currently held in memory, if any.
pub fn loaded_model(state: &LocalLlmState) -> Option<LocalModel> {
    state.lock_engine().as_ref().map(|e| e.id)
}

pub fn is_model_loaded(state: &LocalLlmState, model: LocalModel) -> bool {
    loaded_model(state) == Some(model)
}

/// Remove a `<think>…</think>` block a reasoning model may still emit.
fn strip_thinking(text: &str) -> &str {
    let trimmed = text.trim_start();
    if let Some(rest) = trimmed.strip_prefix("<think>") {
        if let Some(end) = rest.find("</think>") {
            return rest[end + "</think>".len()..].trim_start();
        }
    }
    text
}

/// Prompt-lookup draft: find the last n-gram of `corpus` at an earlier
/// position (not before `search_from`) and propose the tokens that followed.
fn draft_tokens(corpus: &[LlamaToken], search_from: usize) -> Vec<LlamaToken> {
    for n in (DRAFT_NGRAM_MIN..=DRAFT_NGRAM_MAX).rev() {
        if corpus.len() <= n {
            continue;
        }
        let key = &corpus[corpus.len() - n..];
        // Last start index that leaves something to propose after the match
        let limit = corpus.len() - n;
        for start in (search_from..limit).rev() {
            if &corpus[start..start + n] == key {
                let from = start + n;
                let to = (from + DRAFT_MAX).min(corpus.len());
                return corpus[from..to].to_vec();
            }
        }
    }
    Vec::new()
}

struct Prompt {
    tokens: Vec<LlamaToken>,
    /// Index from which drafts may be looked up (start of the transcript).
    search_from: usize,
    max_new: u32,
}

fn build_prompt(engine: &Engine, system_prompt: &str, user_content: &str) -> Result<Prompt, String> {
    let model = &engine.model;
    // Every model must see the role markers it was trained on.
    let mut text = match prompt_format(engine.id) {
        PromptFormat::Gemma4 => render_gemma4(system_prompt, user_content),
        PromptFormat::Builtin => {
            let template = model
                .chat_template(None)
                .map_err(|e| format!("{} has no chat template: {}", engine.id.name(), e))?;
            let messages = vec![
                LlamaChatMessage::new("system".to_string(), system_prompt.to_string())
                    .map_err(|e| format!("Invalid system prompt: {}", e))?,
                LlamaChatMessage::new("user".to_string(), user_content.to_string())
                    .map_err(|e| format!("Invalid transcript: {}", e))?,
            ];
            model
                .apply_chat_template(&template, &messages, true)
                .map_err(|e| format!("Failed to apply chat template: {}", e))?
        }
    };
    if needs_no_think_prefill(engine.id) {
        text.push_str(NO_THINK_PREFILL);
    }

    let tokens = model
        .str_to_token(&text, AddBos::Always)
        .map_err(|e| format!("Failed to tokenize prompt: {}", e))?;
    let user_tokens = model
        .str_to_token(user_content, AddBos::Never)
        .map(|t| t.len())
        .unwrap_or(0);
    let search_from = tokens
        .len()
        .saturating_sub(user_tokens + TEMPLATE_TAIL_TOKENS);
    // Output is a rewrite of the input: budget a multiple of its length.
    let max_new = (user_tokens as u32 * 3 + 128).clamp(MAX_NEW_TOKENS_MIN, MAX_NEW_TOKENS_CAP);
    Ok(Prompt {
        tokens,
        search_from,
        max_new,
    })
}

/// Blocking: run one chat completion on the loaded model. Holds the engine
/// lock for the duration, so unloading waits for generation to finish.
pub fn generate(state: &LocalLlmState, system_prompt: &str, user_content: &str) -> Result<String, String> {
    let mut guard = state.lock_engine();
    let engine = guard
        .as_mut()
        .ok_or("Local model not loaded. Select it again in Settings → General or download it under Models.")?;
    let name = engine.id.name();

    let prompt = build_prompt(engine, system_prompt, user_content)?;
    let prompt_len = prompt.tokens.len();
    let needed = prompt_len as u32 + prompt.max_new + CONTEXT_MARGIN;
    if needed > engine.model.n_ctx_train() {
        return Err(format!(
            "Transcript too long for {} ({} tokens, limit {})",
            name,
            prompt_len,
            engine.model.n_ctx_train()
        ));
    }
    engine.ensure_context(needed)?;

    let Engine {
        ctx, cached, model, ..
    } = engine;
    let ctx = ctx.as_mut().expect("context was just ensured");
    let model: &LlamaModel = model;

    // ----- Prompt: reuse the KV cache for the common prefix -----
    let t = std::time::Instant::now();
    let mut n_keep = cached
        .iter()
        .zip(prompt.tokens.iter())
        .take_while(|(a, b)| a == b)
        .count();
    // The last prompt token must be decoded to get logits for the first
    // output token.
    n_keep = n_keep.min(prompt_len - 1);
    // Removing the tail can fail on sliding-window models once the cache
    // has evicted tokens; start over from scratch in that case.
    if n_keep == 0 || ctx.kv_cache_seq_rm(0, Some(n_keep as u32), None).is_err() {
        ctx.clear_kv_cache();
        n_keep = 0;
    }
    // Anything after this point is invalid if we bail out midway.
    cached.clear();

    let mut batch = LlamaBatch::new(PROMPT_BATCH.max(DRAFT_MAX + 1), 1);
    let pending = &prompt.tokens[n_keep..];
    let last = pending.len() - 1;
    for (chunk_index, chunk) in pending.chunks(PROMPT_BATCH).enumerate() {
        batch.clear();
        for (i, token) in chunk.iter().enumerate() {
            let index = chunk_index * PROMPT_BATCH + i;
            batch
                .add(*token, (n_keep + index) as i32, &[0], index == last)
                .map_err(|e| format!("Failed to build batch: {}", e))?;
        }
        ctx.decode(&mut batch)
            .map_err(|e| format!("Failed to process prompt: {}", e))?;
    }

    // ----- Generation with prompt-lookup speculation -----
    // Recurrent/hybrid models (Qwen3.5's Gated DeltaNet) can't rewind their
    // state, so rejected drafts couldn't be undone; decode them plainly.
    let speculate = !model.is_recurrent() && !model.is_hybrid();
    let mut sampler = LlamaSampler::chain_simple([LlamaSampler::greedy()]);
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut output = String::new();
    // Every token the context has seen: prompt, then generated text.
    let mut corpus: Vec<LlamaToken> = prompt.tokens.clone();
    let mut n_past = prompt_len;
    let mut next = sampler.sample(ctx, -1);
    let prompt_ms = t.elapsed().as_millis();

    let t = std::time::Instant::now();
    let mut generated = 0u32;
    let mut decodes = 0u32;
    let mut drafted_ok = 0u32;
    let mut capped = false;
    'generation: loop {
        if model.is_eog_token(next) {
            break;
        }
        if let Ok(piece) = model.token_to_piece(next, &mut decoder, false, None) {
            output.push_str(&piece);
        }
        corpus.push(next);
        generated += 1;
        if generated >= prompt.max_new {
            capped = true;
            break;
        }

        // Decode [next] + draft in one batch, logits for every position.
        let draft = if speculate {
            draft_tokens(&corpus, prompt.search_from)
        } else {
            Vec::new()
        };
        batch.clear();
        batch
            .add(next, n_past as i32, &[0], true)
            .map_err(|e| format!("Failed to build batch: {}", e))?;
        for (i, token) in draft.iter().enumerate() {
            batch
                .add(*token, (n_past + 1 + i) as i32, &[0], true)
                .map_err(|e| format!("Failed to build batch: {}", e))?;
        }
        ctx.decode(&mut batch)
            .map_err(|e| format!("Failed to generate: {}", e))?;
        decodes += 1;

        // Walk the batch: position i predicts the token at i + 1.
        let batch_len = 1 + draft.len();
        for i in 0..batch_len {
            let predicted = sampler.sample(ctx, i as i32);
            let confirmed = i + 1 < batch_len && predicted == draft[i];
            if confirmed && !model.is_eog_token(predicted) {
                if let Ok(piece) = model.token_to_piece(predicted, &mut decoder, false, None) {
                    output.push_str(&piece);
                }
                corpus.push(predicted);
                generated += 1;
                drafted_ok += 1;
                if generated >= prompt.max_new {
                    capped = true;
                    break 'generation;
                }
                continue;
            }
            // Draft diverged (or ran out): `predicted` is the real next
            // token; drop the speculative KV entries after position i.
            n_past += i + 1;
            if i + 1 < batch_len {
                ctx.kv_cache_seq_rm(0, Some(n_past as u32), None)
                    .map_err(|e| format!("Failed to trim KV cache: {}", e))?;
            }
            next = predicted;
            break;
        }
    }
    let gen_ms = t.elapsed().as_millis();
    if capped {
        eprintln!("[LocalLLM] Hit the {} token generation cap", prompt.max_new);
    }
    println!(
        "[LocalLLM] {}: prompt {} tok ({} reused) in {} ms; {} tok in {} ms ({:.0} tok/s, {} decodes, {} from drafts)",
        name,
        prompt_len,
        n_keep,
        prompt_ms,
        generated,
        gen_ms,
        generated as f64 / (gen_ms.max(1) as f64 / 1000.0),
        decodes,
        drafted_ok
    );

    // The context now holds exactly `corpus` (prompt + emitted tokens); the
    // next request reuses whatever prefix it shares.
    *cached = corpus;

    Ok(strip_thinking(&output).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end check against a real Gemma 4 GGUF; run with
    /// `DICTATO_TEST_GGUF=/path/gemma-4-E2B.gguf cargo test local_llm -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn cleans_a_mixed_language_transcript() {
        let path = std::path::PathBuf::from(
            std::env::var("DICTATO_TEST_GGUF").expect("DICTATO_TEST_GGUF not set"),
        );
        let state = LocalLlmState::default();
        {
            // Load through the engine directly so the spec's file name
            // doesn't have to match the test file.
            let llama_model = LlamaModel::load_from_file(
                backend().unwrap(),
                &path,
                &LlamaModelParams::default().with_n_gpu_layers(ALL_GPU_LAYERS),
            )
            .expect("load");
            let mut engine = Engine {
                id: LocalModel::Gemma4E2b,
                ctx: None,
                cached: Vec::new(),
                model: Box::new(llama_model),
            };
            warm_up(&mut engine).expect("warm-up");
            *state.lock_engine() = Some(engine);
        }
        let system = format!(
            "You are a voice transcript cleanup assistant. Fix punctuation and remove filler words. Output ONLY the cleaned-up text.\n\n{}",
            crate::llm::build_transcript_context("pl", &["useEffect".to_string()])
        );
        let user = "no więc słuchaj ja myślę że powinniśmy yyy użyć use effect hook do tego fetchowania danych bo bo teraz to jest w render";
        let first = generate(&state, &system, user).expect("generate");
        println!("first: {}", first);
        assert!(first.contains("useEffect"), "kept the technical term");
        assert!(!first.contains("yyy"), "removed the filler");
        assert!(first.contains("słuchaj"), "stayed Polish");
        // Second call exercises prefix reuse on the same system prompt.
        let second = generate(&state, &system, "hej to jest drugi test eee z tym samym promptem")
            .expect("generate again");
        println!("second: {}", second);
        assert!(second.to_lowercase().contains("drugi test"));
        assert_eq!(loaded_model(&state), Some(LocalModel::Gemma4E2b));
        unload_model(&state);
        assert_eq!(loaded_model(&state), None);
    }
}
