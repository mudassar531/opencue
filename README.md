# opencue

> Open-source meeting copilot — a desktop app that listens to your meeting, transcribes it in real time, and surfaces AI-powered notes & answers in a discreet always-on-top overlay. Use your own API keys or run **fully local** with downloadable models.

[![CI](https://github.com/mudassar531/opencue/actions/workflows/ci.yml/badge.svg)](https://github.com/mudassar531/opencue/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Status

🚧 Early development. Currently on **Phase 6 — Meeting integrations, sessions & export** of an eight-phase build. The full plan lives in [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md); architecture in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Repo, scaffolding & CI | ✅ shipped |
| 1 | Overlay window & global hotkeys | ✅ shipped |
| 2 | Audio capture pipeline (loopback + mic + VAD) | ✅ shipped |
| 3 | Provider abstraction + cloud STT/LLM/TTS | ✅ shipped |
| 4 | Python sidecar + local models + model manager | ✅ shipped |
| 5 | Screen context (ask about your screen) | ✅ shipped |
| 6 | Meeting integrations, sessions & export | ⏳ |
| 7 | Packaging, auto-update & release | ⏳ |

---

## Why a desktop app (not a webapp)

opencue's signature features — system/loopback audio capture, an always-on-top overlay excluded from screen sharing & recording, on-device speech-to-text, and screen reading — are not possible inside a browser sandbox. The app is **Electron** with a small **Python sidecar** for local inference.

## Privacy & ethics

- **Local mode keeps audio on-device.** When you select a local STT/TTS/LLM, no audio or transcript leaves your computer.
- **Bring your own keys.** Cloud providers (OpenAI, Anthropic, Deepgram, ElevenLabs, …) are reached with API keys you enter yourself and that are stored encrypted via Electron `safeStorage`.
- **No secret keylogging or covert capture.** opencue shows a visible recording indicator whenever audio is captured.
- **Not an interview-cheating tool.** The overlay's "invisible to screen share" property is intended to keep your *personal* notes off the call — not to deceive participants or violate exam/employer policies. Use opencue where it is permitted.
- **No telemetry.** opencue does not phone home.

## Tech stack

- **Shell** — Electron + electron-vite + electron-builder (added in Phase 7).
- **UI** — React + TypeScript + Tailwind CSS, lightweight state with Zustand.
- **Settings** — electron-store; secrets encrypted with Electron `safeStorage`.
- **Local inference (added in Phase 4)** — Python sidecar bundled with PyInstaller; faster-whisper / NVIDIA Parakeet (STT); Piper / Kokoro (TTS); Silero (VAD).
- **Cloud providers (added in Phase 3)** — Deepgram, OpenAI, AssemblyAI (STT); OpenAI, Anthropic, Google Gemini, Groq (LLM); ElevenLabs, OpenAI, Cartesia (TTS); Ollama for local LLM.

> **Note on Parakeet:** Parakeet is NVIDIA's speech-to-text (ASR) family — it lives under STT, not TTS. Local TTS uses Piper/Kokoro.

## Default hotkeys (Phase 1)

opencue registers six global hotkeys. They are configurable through the typed IPC API today and through a dedicated settings UI in Phase 6.

| Action | Default accelerator | Effect |
| --- | --- | --- |
| Toggle overlay | `Cmd/Ctrl + Shift + \` | Show or hide the overlay window |
| Move overlay | `Cmd/Ctrl + Shift + M` | Cycle through top-right → bottom-right → bottom-left → top-left → center |
| Assist | `Cmd/Ctrl + Shift + Enter` | Wake the overlay and trigger the Assist action (LLM call lands in Phase 3) |
| Recap | `Cmd/Ctrl + Shift + R` | Wake the overlay and ask for a recap of the meeting so far |
| Open ask-bar | `Cmd/Ctrl + Shift + /` | Show the overlay's ask input |
| Toggle click-through | `Cmd/Ctrl + Shift + L` | Make the overlay pass mouse events to whatever is beneath it |

The overlay is created with `BrowserWindow.setContentProtection(true)`, which excludes it from system screen capture and recording on Windows and macOS. The toggle in the main window lets you turn that off when, for example, you actually want the overlay to show up in a screenshot.

## Audio capture (Phase 2)

opencue's audio pipeline is fully on-device: the renderer acquires the user-selected source, runs **Silero VAD** locally via `onnxruntime-web`, and only ships normalized PCM segment metadata over IPC. Raw audio never leaves the renderer in this phase. Cloud STT (Phase 3) is what turns audio into text; local STT (Phase 4) runs through a Python sidecar.

### Picking a source

The picker offers three categories — only those supported on your OS are shown:

- **Microphones** — every input device exposed by `navigator.mediaDevices.enumerateDevices()`.
- **Screens (system audio)** — the desktop mix for a whole monitor.
- **Windows (per-app audio)** — a single app's audio (e.g., a Google Meet tab).

### Per-OS capability

| Platform | System / loopback audio | Notes |
| --- | --- | --- |
| **Windows** | ✅ via Chromium's WASAPI loopback when a screen / window source is picked | Works out of the box. |
| **macOS** | ✅ via ScreenCaptureKit (macOS 13+) when a screen / window source is picked | First launch will prompt for **Screen & System Audio Recording**. Open *System Settings → Privacy & Security → Screen Recording* and enable opencue, then click **refresh** in the picker. The microphone picker also needs the macOS microphone permission. |
| **Linux** | ⚠️ no native loopback path | The picker hides the screen / window categories. Pick a **microphone**, or select a *Monitor of …* input (PulseAudio / PipeWire exposes one per output sink) to capture whatever is currently playing. |

If `desktopCapturer.getSources()` fails (typically because the OS permission hasn't been granted yet), the picker shows a CTA that walks the user through the permission flow instead of a generic error.

### What runs where

- **Renderer** — `getUserMedia` / `getDisplayMedia`, `AudioContext`, `AnalyserNode` for the live level meter (~20 Hz), Silero VAD via `@ricky0123/vad-web`, ring buffer of recent PCM, segment dispatcher.
- **Main** — `desktopCapturer` enumeration, one-shot `setDisplayMediaRequestHandler` so the renderer's `getDisplayMedia` call resolves to the chosen source with `audio: 'loopback'`, canonical `AudioCaptureState` plus event broadcast (`AudioCaptureStateChanged`, `AudioLevelTick`, `AudioSegmentReady`).

## Connect a provider (Phase 3)

Open opencue, scroll to **Providers & API keys**, pick a provider for each capability, paste your API key, hit **save**.

| Capability | Cloud options shipped today |
| --- | --- |
| Speech-to-text | OpenAI Whisper, Deepgram, AssemblyAI |
| Language model | OpenAI, Anthropic, Google Gemini, Groq |
| Text-to-speech | OpenAI, ElevenLabs |

Each saved key is encrypted at rest with Electron `safeStorage` (Keychain on macOS, DPAPI on Windows, libsecret on Linux). Keys never leave your machine except to the provider you chose.

With keys configured:

1. Start a capture in the **Audio capture** panel — every VAD-finalized segment is transcribed in the background.
2. Hit `⌘⇧↵` (or `Ctrl+Shift+Enter`) to ask the assist hotkey for the next thing to say.
3. Hit `⌘⇧R` for a meeting recap.
4. Open the overlay's ask-bar (`⌘⇧/`) or use the **Ask** form in the main window to type a freeform question. Set the **TTS auto-play** toggle if you want the answer spoken.

Local providers (faster-whisper / Parakeet / Piper / Kokoro / Ollama) land in Phase 4 behind the exact same interface, so switching cloud ↔ local is a single settings change.

## Ask about your screen (Phase 5)

Multimodal Ask combines the meeting transcript with an on-demand screenshot:

* **In the overlay's ask-bar (`⌘⇧/`)** — tap the `📷` icon before submitting to attach a screenshot of your current display.
* **In the main window's Ask form** — tick *Include a screenshot with the next Ask*.

The screenshot is sent inline to multimodal-capable providers (OpenAI gpt-4o / 4.1, Anthropic Claude 3.x, Google Gemini 2.x). Text-only providers (Groq / Ollama) gracefully degrade — the prompt text still goes through, the image is dropped.

opencue's overlay is `setContentProtection(true)` by default, so it doesn't appear in screen captures on Windows / macOS. The renderer additionally **hides the overlay** for one frame around every capture call as belt-and-braces for OSes where content protection isn't honored.

## Run fully local (Phase 4)

opencue ships local STT (faster-whisper, Parakeet) and TTS (Piper, Kokoro) through a small Python sidecar, plus local LLM via [Ollama](https://ollama.com). The pipeline above is unchanged — switching cloud ↔ local is a settings change.

### One-time setup

```bash
# 1. Install the sidecar's Python deps (Phase 7 will bundle this).
python3 -m venv sidecar/.venv
source sidecar/.venv/bin/activate   # Windows: sidecar\.venv\Scripts\activate
pip install -r sidecar/requirements.txt

# 2. (Optional) install Ollama for local LLM.
#    See https://ollama.com — then `ollama pull llama3.2` (or your favourite).
```

### Inside opencue

1. **Local models & sidecar** panel → pick a model, hit **download** (live MB/s + ETA shown).
2. Click **Start sidecar** when the green dot stays off; you'll see it flip to `running` once the Python process reports ready.
3. **Providers & API keys** → switch *Speech-to-text* to **Local sidecar**, model = the one you downloaded. Same for *Text-to-speech* (Piper / Kokoro) and *Language model* (**Ollama (local)** + the tag you pulled).
4. Capture audio → the Assist loop now runs 100% offline.

The model catalog is curated — see [`src/shared/model-registry.ts`](src/shared/model-registry.ts). Notable members:

| Runtime | Sizes shipped |
| --- | --- |
| faster-whisper | tiny.en (~75 MB), base.en (~142 MB), small.en (~470 MB), medium.en (~1.5 GB), large-v3 (~3 GB multilingual) |
| Parakeet (NVIDIA ASR — GPU recommended) | parakeet-tdt-0.6b-v2 (~626 MB) |
| Piper | Amy en-US medium (~63 MB), Alan en-GB medium (~63 MB) |
| Kokoro | kokoro-v0_19 (~327 MB multilingual) |
| Ollama LLM | bring your own — opencue probes `/api/tags` and lists what you've pulled |

> Parakeet is an ASR (speech-to-text) family from NVIDIA, so it appears under STT — not TTS. Local TTS uses Piper / Kokoro.

## Build from source

> Prerequisites: **Node.js ≥ 20** and **npm ≥ 10**. The Python sidecar is added in Phase 4 and isn't required to run Phase 0–3 builds.

```bash
git clone https://github.com/mudassar531/opencue.git
cd opencue
npm install
npm run dev
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Launch the app in development with hot-reload. |
| `npm run build` | Type-check, lint, and produce a production build. |
| `npm run typecheck` | Strict TypeScript check for renderer **and** main/preload. |
| `npm run lint` | ESLint (zero errors required). |
| `npm test` | Run Vitest unit tests. |
| `npm run format` | Format the codebase with Prettier. |

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system diagram and the rationale behind the main/preload/renderer split, the provider abstraction, and the Python sidecar.

## Contributing

Contributions are very welcome. Please read [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md) first — it is the master plan and constraints document. A formal `CONTRIBUTING.md` is added in Phase 7.

## License

[MIT](LICENSE) © opencue contributors.
