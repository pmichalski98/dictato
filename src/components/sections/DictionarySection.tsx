import { useState, useEffect, useCallback, useRef } from "react";
import { BookText, Plus, X } from "lucide-react";
import { LazyStore } from "@tauri-apps/plugin-store";
import { ICON_SIZES } from "@/lib/constants";
import { STORE_KEYS } from "@/lib/storeKeys";
import { SectionLayout } from "../layout/SectionLayout";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const store = new LazyStore("settings.json");

export function DictionarySection() {
  const [words, setWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");
  const isInitialLoad = useRef(true);

  // Load dictionary on mount
  useEffect(() => {
    async function loadWords() {
      try {
        const wordsJson = await store.get<string>(STORE_KEYS.DICTIONARY_WORDS);
        if (wordsJson) {
          setWords(JSON.parse(wordsJson));
        }
      } catch (err) {
        console.error("Failed to load dictionary:", err);
      } finally {
        isInitialLoad.current = false;
      }
    }
    loadWords();
  }, []);

  // Persist on change (after initial load)
  useEffect(() => {
    if (isInitialLoad.current) return;
    store
      .set(STORE_KEYS.DICTIONARY_WORDS, JSON.stringify(words))
      .catch((err) => console.error("Failed to save dictionary:", err));
  }, [words]);

  const addWord = useCallback(() => {
    const word = newWord.trim();
    if (!word) return;
    setWords((prev) => {
      const exists = prev.some((w) => w.toLowerCase() === word.toLowerCase());
      return exists ? prev : [...prev, word];
    });
    setNewWord("");
  }, [newWord]);

  const removeWord = useCallback((word: string) => {
    setWords((prev) => prev.filter((w) => w !== word));
  }, []);

  return (
    <SectionLayout
      title="Dictionary"
      description="Custom words and terminology"
    >
      <Card className="space-y-3">
        <div>
          <Label className="text-[13px]">Custom Vocabulary</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Terms are fed to the transcription engine and the AI cleanup step so
            they come out spelled correctly &mdash; library names, product names,
            project jargon (e.g. &quot;Tauri&quot;, &quot;useEffect&quot;, &quot;Groq&quot;).
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addWord();
            }}
            placeholder="Add a term..."
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={addWord}
            disabled={!newWord.trim()}
          >
            <Plus size={ICON_SIZES.sm} className="mr-1.5" />
            Add
          </Button>
        </div>

        {words.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {words.map((word) => (
              <span
                key={word}
                className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-muted/50 border border-border text-[12px] text-foreground"
              >
                {word}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 rounded-full hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => removeWord(word)}
                  title={`Remove "${word}"`}
                >
                  <X size={10} />
                </Button>
              </span>
            ))}
          </div>
        ) : (
          <div className="py-6 flex flex-col items-center justify-center text-center">
            <div className="w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center mb-2">
              <BookText size={ICON_SIZES.md} className="text-muted-foreground" />
            </div>
            <p className="text-[11px] text-muted-foreground max-w-[280px]">
              No terms yet. Add words the transcription often gets wrong.
            </p>
          </div>
        )}
      </Card>
    </SectionLayout>
  );
}
