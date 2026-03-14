# Dictato

Voice-to-text transcription app with AI-powered text transformation.

<p align="center">
  <img src="public/general.png" alt="Dictato Settings" width="600" />
</p>
<p align="center">
  <img src="public/floating_orb.png" alt="Dictato Settings" width="600" />
</p>
<p align="center">
  <img src="public/recording.png" alt="Dictato Settings" width="600" />
</p>
<p align="center">
  <img src="public/rules.png" alt="Dictato Settings" width="600" />
</p>
<p align="center">
  <img src="public/transcribe.png" alt="Dictato Settings" width="600" />
</p>

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
