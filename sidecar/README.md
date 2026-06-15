# opencue Python sidecar

Local STT (faster-whisper / Parakeet) and TTS (Piper / Kokoro) for opencue, exposed to the Electron app over a localhost WebSocket / JSON-RPC.

## Why a sidecar?

The required runtimes are Python-native (faster-whisper, piper-tts, Kokoro, NeMo / Parakeet). Bridging them through a tiny Python process is much cheaper and more reliable than reimplementing them in JS, and it keeps the Electron app dependency-free at the Python layer.

## Phase 4 install (manual)

> Phase 7 will bundle this with PyInstaller so end users never see Python. Today, contributors and early adopters run it from a venv.

```bash
# From the repo root:
python3 -m venv sidecar/.venv

# macOS / Linux:
source sidecar/.venv/bin/activate
# Windows (PowerShell):
# sidecar\.venv\Scripts\Activate.ps1

pip install --upgrade pip
pip install -r sidecar/requirements.txt

# Sanity-check:
python sidecar/main.py --port 8763
# → "opencue-sidecar ready on 127.0.0.1:8763"
```

Then start opencue and open the **Local models** panel:

1. Pick an STT model (e.g., *faster-whisper base.en* — 142 MB) and click **download**. Progress shows bytes / total / MB·s / ETA.
2. (Optional) pick a TTS voice (Piper *Amy* is a good 63 MB default).
3. Click **Start sidecar**. The status badge flips to **running** when the server reports ready on stdout.
4. In the **Providers & API keys** panel, switch *Speech-to-text* to **Local sidecar** and pick the downloaded model. Same for *Text-to-speech* if you want offline replies.
5. The Assist loop now runs fully offline.

opencue's main process points the sidecar at the same `userData/models/` directory the model manager writes to, so the sidecar loads exactly what was downloaded.

## RPC surface

| Method | Params | Result |
| --- | --- | --- |
| `health` | – | `{ status: "ok", capabilities: [...] }` |
| `transcribe` | `model_id, model_dir, sample_rate, samples_base64, language_hint?` | `{ text, model, latency_ms, language? }` |
| `synthesize` | `model_id, model_dir, text, voice?` | `{ audio_base64, mime_type, model, voice }` |

`samples_base64` is the raw bytes of a Float32Array (little-endian). The sidecar linearly resamples to 16 kHz if needed.

## Local LLM via Ollama

For the LLM, opencue talks to a local [Ollama](https://ollama.com) install at `http://127.0.0.1:11434` directly — no sidecar involvement. Set the **Language model** dropdown to **Ollama (local)** and type the model name (e.g., `llama3.2`). The **Ollama / local LLM** badge in the Local models panel pings `/api/tags` and lists what you have pulled.

## Notes

- The sidecar is intentionally tiny — no auth, no TLS — and only listens on `127.0.0.1`.
- Errors are returned as `{ "id", "error": { "message": "..." } }` so the Electron side can surface them to the user verbatim.
- Optional deps (`faster-whisper`, `piper-tts`) are imported lazily; a missing one fails the relevant RPC call rather than crashing the server.
