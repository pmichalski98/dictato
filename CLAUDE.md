# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev (frontend + Tauri)
bun run tauri dev

# Build release
bun run tauri build

# Frontend only
bun run dev       # Vite dev server on :1420
bun run build     # TypeScript + Vite build
```

## Architecture

Tauri v2 desktop app: React/TypeScript frontend + Rust backend. Uses OpenAI Realtime API for voice transcription.

**Two windows:**
- Main window: Settings UI (`Settings.tsx`) for API key, shortcut config
- Floating window: Always-on-top transcription orb (`FloatingWindow.tsx`), routes via `?window=floating`

**Core flow:**
1. Global shortcut triggers recording toggle
2. Rust opens WebSocket to OpenAI Realtime API (`realtime.rs`)
3. Frontend captures mic via AudioWorklet, sends 24kHz PCM16 chunks to Rust
4. Rust streams audio to OpenAI, receives transcription events
5. On stop: transcript copied to clipboard and auto-pasted via `enigo`

**Key files:**
- `src-tauri/src/lib.rs` - Tauri commands, window management, shortcut handling
- `src-tauri/src/realtime.rs` - OpenAI WebSocket session, audio streaming
- `src/hooks/useSettings.ts` - Settings persistence via `@tauri-apps/plugin-store`
- `public/audio-processor.js` - AudioWorklet for mic capture

**Tauri plugins:** global-shortcut, clipboard-manager, store, autostart
