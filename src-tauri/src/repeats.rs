//! Collapse runaway repetition in speech-to-text output.
//!
//! Whisper (and other autoregressive STT models) can fall into a loop on a
//! long pause and emit the same word or phrase hundreds of times ("warto
//! warto warto ..."). Any LLM step downstream then copies the loop and, with
//! greedy decoding, may never leave it, hitting its generation cap and
//! dropping the rest of the dictation. This pass is a deterministic backstop
//! that runs on every transcript before it reaches an LLM.
//!
//! People do repeat themselves ("nie, nie, nie"), so short runs are kept
//! untouched; only runs longer than [`MAX_RUN`] are trimmed, and the first
//! [`MAX_RUN`] occurrences survive.

/// Longest phrase (in words) checked for consecutive repetition.
const MAX_NGRAM: usize = 6;
/// A phrase may appear this many times in a row before the rest is dropped.
const MAX_RUN: usize = 3;

/// Return `text` with consecutive repeats beyond [`MAX_RUN`] removed.
/// The input is returned unchanged (including whitespace) when nothing
/// needs collapsing; otherwise each affected line is re-joined with single
/// spaces.
pub fn collapse_runs(text: &str) -> String {
    let mut changed = false;
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            let words: Vec<&str> = line.split_whitespace().collect();
            let kept = collapse_words(&words);
            if kept.len() == words.len() {
                line.to_string()
            } else {
                changed = true;
                kept.join(" ")
            }
        })
        .collect();
    if changed {
        lines.join("\n")
    } else {
        text.to_string()
    }
}

/// Comparison key: case-insensitive and ignoring surrounding punctuation,
/// so "Warto." and "warto," count as the same word.
fn key(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()
}

fn collapse_words<'a>(words: &[&'a str]) -> Vec<&'a str> {
    let keys: Vec<String> = words.iter().map(|w| key(w)).collect();
    let mut out = Vec::with_capacity(words.len());
    let mut i = 0;
    while i < words.len() {
        // Smallest phrase length whose run at `i` exceeds the limit wins;
        // "to jest to jest ..." needs n = 2, "warto warto ..." n = 1.
        let hit = (1..=MAX_NGRAM).find_map(|n| {
            let run = run_length(&keys, i, n);
            (run > MAX_RUN).then_some((n, run))
        });
        match hit {
            Some((n, run)) => {
                out.extend_from_slice(&words[i..i + n * MAX_RUN]);
                i += n * run;
            }
            None => {
                out.push(words[i]);
                i += 1;
            }
        }
    }
    out
}

/// How many times the `n`-word phrase starting at `start` repeats back to
/// back (counting itself).
fn run_length(keys: &[String], start: usize, n: usize) -> usize {
    let phrase = match keys.get(start..start + n) {
        Some(p) if p.iter().all(|k| !k.is_empty()) => p,
        _ => return 0,
    };
    let mut run = 1;
    let mut pos = start + n;
    while keys.get(pos..pos + n) == Some(phrase) {
        run += 1;
        pos += n;
    }
    run
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_normal_text_alone() {
        let text = "to to to i tamto, nie nie nie,  podwójna spacja";
        assert_eq!(collapse_runs(text), text);
    }

    #[test]
    fn collapses_single_word_loop() {
        let text = format!("czy to jest warto {} że to", "warto ".repeat(200).trim_end());
        // The "warto" ending the real phrase is the first of the run.
        assert_eq!(collapse_runs(&text), "czy to jest warto warto warto że to");
    }

    #[test]
    fn collapses_phrase_loop() {
        let text = format!("{}jakby też agent", "to jest ".repeat(50));
        assert_eq!(collapse_runs(&text), "to jest to jest to jest jakby też agent");
    }

    #[test]
    fn ignores_case_and_punctuation() {
        let text = "czy warto. Warto. Warto. Warto. warto, Warto. Koniec";
        assert_eq!(collapse_runs(&text), "czy warto. Warto. Warto. Koniec");
    }

    #[test]
    fn keeps_lines_separate() {
        let text = "a a a a a\nb b";
        assert_eq!(collapse_runs(text), "a a a\nb b");
    }

    #[test]
    fn empty_input() {
        assert_eq!(collapse_runs(""), "");
    }
}
