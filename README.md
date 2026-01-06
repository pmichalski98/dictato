# Dictato

Voice-to-text transcription app with AI-powered text transformation.

## Roadmap

### Planned Features

- [ ] **Historia transkrypcji** (~4-6h) - pełna historia nagrań z możliwością przeglądania, porównania tekstu przed/po przetworzeniu, statystykami (czas, koszty, liczba słów) i ponownym przetwarzaniem z innymi ustawieniami

- [ ] **Słownik terminologii** (~2-3h) - własna lista terminów (nazwy własne, żargon branżowy) automatycznie wstrzykiwana do promptu LLM dla lepszej dokładności

- [ ] **Tryb offline (lokalny model)** (~8-12h) - integracja z NVIDIA Parakeet lub Whisper.cpp dla lokalnej transkrypcji bez potrzeby API

- [ ] **Transkrypcja z pliku** (~3-4h) - drag & drop plików audio do okna

- [x] **Statystyki zaoszczędzonego czasu** - pokazuje ile czasu użytkownik zaoszczędził używając dyktowania vs pisania manualnego (bazując na liczbie słów i średniej prędkości pisania ~40 słów/min)

### Nice to Have

## Development

### Commands

```bash
# Dev (frontend + Tauri)
bun run tauri dev

# Build release
bun run tauri build

# Frontend only
bun run dev       # Vite dev server on :1420
bun run build     # TypeScript + Vite build
```

### Release

```bash
git tag -a v0.3.0 -m "Release message"
git push origin --tags
```

## Inspiration

https://x.com/thekitze/status/2000573975894843797
