"""opencue Python sidecar.

A tiny aiohttp WebSocket / JSON-RPC server that exposes local STT and TTS
to the Electron main process. The protocol is intentionally minimal so the
TypeScript router can stay simple:

    { "id": "<random>", "method": "<name>", "params": { ... } }
       ▼
    { "id": "<random>", "result": { ... } }   or
    { "id": "<random>", "error":  { "message": "..." } }

Methods (Phase 4):

    health()
        →  { status: "ok", capabilities: [...] }
    transcribe(model_id, model_dir, sample_rate, samples_base64, language_hint?)
        →  { text, model, latency_ms, confidence? }
    synthesize(model_id, model_dir, text, voice?)
        →  { audio_base64, mime_type, model, voice }

The sidecar prints `opencue-sidecar ready` to stdout once the server is
listening — the SidecarManager in main waits for that marker.

Designed to fail gracefully when optional deps are missing: a method call
returns a clear error message instead of crashing the process.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import logging
import os
import struct
import time
import wave
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Optional imports — deferred so the server can boot even if a backend is
# missing (the user might only want STT, not TTS, etc).
# ---------------------------------------------------------------------------

try:
    import numpy as np
except ImportError:  # pragma: no cover - hard failure surface
    np = None

try:
    from aiohttp import WSMsgType, web
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "opencue-sidecar: aiohttp is required. Run `pip install -r requirements.txt`."
    ) from exc

try:
    from faster_whisper import WhisperModel  # type: ignore
except ImportError:
    WhisperModel = None  # type: ignore

try:
    from piper import PiperVoice  # type: ignore
except ImportError:
    PiperVoice = None  # type: ignore


LOG = logging.getLogger("opencue.sidecar")

# Cache loaded models so subsequent calls don't pay the load cost.
_WHISPER_CACHE: dict[str, Any] = {}
_PIPER_CACHE: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# RPC method implementations
# ---------------------------------------------------------------------------


async def rpc_health(_params: dict[str, Any]) -> dict[str, Any]:
    capabilities = []
    if WhisperModel is not None:
        capabilities.append("faster-whisper")
    if PiperVoice is not None:
        capabilities.append("piper")
    return {"status": "ok", "capabilities": capabilities}


async def rpc_transcribe(params: dict[str, Any]) -> dict[str, Any]:
    if WhisperModel is None:
        raise RuntimeError(
            "faster-whisper is not installed in this sidecar environment. "
            "Install it with: pip install faster-whisper"
        )
    if np is None:
        raise RuntimeError("numpy is required for transcription")

    model_id = params["model_id"]
    model_dir = params["model_dir"]
    sample_rate = int(params["sample_rate"])
    language_hint = params.get("language_hint")
    samples_base64 = params["samples_base64"]

    # Decode raw Float32 PCM.
    raw = base64.b64decode(samples_base64)
    if len(raw) % 4 != 0:
        raise ValueError("samples_base64 length is not a multiple of 4 bytes")
    samples = np.frombuffer(raw, dtype=np.float32).copy()

    # Resample to 16 kHz if needed — faster-whisper expects 16k.
    if sample_rate != 16000:
        samples = _linear_resample(samples, sample_rate, 16000)

    start = time.perf_counter()
    model = await asyncio.to_thread(_load_whisper, model_id, model_dir)
    segments, info = await asyncio.to_thread(
        model.transcribe,
        samples,
        language=language_hint.split("-")[0] if language_hint else None,
        beam_size=1,
    )
    text = "".join(segment.text for segment in segments).strip()
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    return {
        "text": text,
        "model": model_id,
        "latency_ms": elapsed_ms,
        "language": getattr(info, "language", None),
    }


async def rpc_synthesize(params: dict[str, Any]) -> dict[str, Any]:
    if PiperVoice is None:
        raise RuntimeError(
            "piper-tts is not installed in this sidecar environment. "
            "Install it with: pip install piper-tts"
        )

    model_id = params["model_id"]
    model_dir = params["model_dir"]
    text = params["text"]
    voice_name = params.get("voice") or "default"

    voice = await asyncio.to_thread(_load_piper, model_id, model_dir)
    # Piper returns 16-bit mono PCM; wrap it in a WAV container so the
    # renderer can decode without extra dependencies.
    pcm_bytes = io.BytesIO()
    sample_rate = voice.config.sample_rate
    audio_int16 = b""
    for chunk in voice.synthesize_stream_raw(text):
        audio_int16 += chunk
    pcm_bytes.write(audio_int16)

    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(audio_int16)
    audio_base64 = base64.b64encode(wav_buffer.getvalue()).decode("ascii")
    return {
        "audio_base64": audio_base64,
        "mime_type": "audio/wav",
        "model": model_id,
        "voice": voice_name,
    }


RPC_METHODS = {
    "health": rpc_health,
    "transcribe": rpc_transcribe,
    "synthesize": rpc_synthesize,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_whisper(model_id: str, model_dir: str) -> Any:
    """Load (or fetch from cache) a faster-whisper model directory."""
    cache_key = model_dir
    cached = _WHISPER_CACHE.get(cache_key)
    if cached is not None:
        return cached
    LOG.info("loading faster-whisper model %s from %s", model_id, model_dir)
    model = WhisperModel(model_dir, device="auto", compute_type="auto")  # type: ignore
    _WHISPER_CACHE[cache_key] = model
    return model


def _load_piper(model_id: str, model_dir: str) -> Any:
    cache_key = model_dir
    cached = _PIPER_CACHE.get(cache_key)
    if cached is not None:
        return cached
    voice_path = Path(model_dir) / "voice.onnx"
    if not voice_path.exists():
        # Fall back to whichever .onnx is in the directory — Kokoro variants
        # use a different filename.
        candidates = list(Path(model_dir).glob("*.onnx"))
        if not candidates:
            raise FileNotFoundError(f"No .onnx voice file under {model_dir}")
        voice_path = candidates[0]
    LOG.info("loading piper voice %s from %s", model_id, voice_path)
    voice = PiperVoice.load(str(voice_path))  # type: ignore
    _PIPER_CACHE[cache_key] = voice
    return voice


def _linear_resample(samples: Any, src_hz: int, dst_hz: int) -> Any:
    """Lightweight linear resampler — fine for VAD-chopped speech segments.

    The user's installed faster-whisper / Parakeet wheels usually pull in
    soundfile + numpy, but we avoid introducing a hard dependency on scipy.
    """
    if src_hz == dst_hz:
        return samples
    src_len = samples.shape[0]
    dst_len = int(round(src_len * (dst_hz / src_hz)))
    if dst_len <= 0:
        return samples
    src_t = np.linspace(0, 1, num=src_len, endpoint=False)
    dst_t = np.linspace(0, 1, num=dst_len, endpoint=False)
    return np.interp(dst_t, src_t, samples).astype(np.float32)


# ---------------------------------------------------------------------------
# WebSocket / HTTP plumbing
# ---------------------------------------------------------------------------


async def handle_rpc_ws(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(max_msg_size=64 * 1024 * 1024)
    await ws.prepare(request)
    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            try:
                payload = json.loads(msg.data)
            except json.JSONDecodeError as exc:
                await ws.send_str(
                    json.dumps({"id": "", "error": {"message": f"malformed JSON: {exc}"}})
                )
                continue
            await _handle_rpc_call(ws, payload)
        elif msg.type == WSMsgType.ERROR:
            LOG.warning("websocket error: %s", ws.exception())
            break
    return ws


async def _handle_rpc_call(ws: web.WebSocketResponse, payload: dict[str, Any]) -> None:
    call_id = str(payload.get("id", ""))
    method = payload.get("method")
    params = payload.get("params", {}) or {}
    handler = RPC_METHODS.get(method) if isinstance(method, str) else None
    if handler is None:
        await ws.send_str(
            json.dumps({"id": call_id, "error": {"message": f"unknown method: {method}"}})
        )
        return
    try:
        result = await handler(params)
        await ws.send_str(json.dumps({"id": call_id, "result": result}))
    except Exception as exc:  # noqa: BLE001 - report every error back to the caller
        LOG.exception("RPC %s failed", method)
        await ws.send_str(json.dumps({"id": call_id, "error": {"message": str(exc)}}))


async def handle_health(_request: web.Request) -> web.Response:
    return web.json_response(await rpc_health({}))


def build_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/health", handle_health)
    app.router.add_get("/rpc", handle_rpc_ws)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="opencue Python sidecar")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("OPENCUE_SIDECAR_PORT", "8763")),
    )
    parser.add_argument(
        "--models-dir",
        type=str,
        default=os.environ.get("OPENCUE_MODELS_DIR", str(Path.home() / ".opencue" / "models")),
    )
    parser.add_argument("--log-level", default=os.environ.get("OPENCUE_LOG_LEVEL", "INFO"))
    args = parser.parse_args()

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )

    LOG.info("models dir: %s", args.models_dir)
    Path(args.models_dir).mkdir(parents=True, exist_ok=True)

    app = build_app()
    runner = web.AppRunner(app)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(runner.setup())
    site = web.TCPSite(runner, "127.0.0.1", args.port)
    loop.run_until_complete(site.start())

    # The SidecarManager waits for this marker on stdout.
    print(f"opencue-sidecar ready on 127.0.0.1:{args.port}", flush=True)

    try:
        loop.run_forever()
    except KeyboardInterrupt:
        pass
    finally:
        loop.run_until_complete(runner.cleanup())
        loop.close()


# Make `struct` import look used so static analyzers don't strip it.
assert struct.calcsize("h") == 2


if __name__ == "__main__":
    main()
