"""AVG local fixed-voice inference service. No Work access or adoption authority.

Only explicitly installed, pinned CustomVoice weights are accepted. This process
never downloads a model, clones a voice, sends text to a remote service, retries
generation, edits a script, or writes product data. See README.md for licensing.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import threading
import time
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODEL_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
MODEL_REVISION = "0c0e3051f131929182e2c023b9537f8b1c68adfe"
MODEL_ID = f"{MODEL_REPO}@{MODEL_REVISION}"
PROVIDER = "storyforge-local-qwen3"
VOICES = ("Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric")
MAX_INPUT = 256
MAX_INSTRUCTIONS = 2048
MAX_SECONDS = 120
MAX_BODY = 32768
WEIGHTS = {
    "model.safetensors": (3833402552, "38b1d5971bdbd982b561cccec982669a53b0537c3cf5e9bd4778ed07bb2f5137"),
    "speech_tokenizer/model.safetensors": (682293092, "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258"),
}


def capabilities():
    return {"schema": "storyforge.avg.local-speech-capability", "version": 1,
            "provider": PROVIDER, "model": MODEL_ID, "modelRevision": MODEL_REVISION,
            "voices": list(VOICES), "locale": "zh-CN", "outputFormat": "wav",
            "maximumInputCharacters": MAX_INPUT, "supportsInstructions": True,
            "maximumInstructionsCharacters": MAX_INSTRUCTIONS, "speedRange": None,
            "license": "Apache-2.0", "voiceMode": "fixed-preset"}


def utf16_length(text):
    # The existing browser contract counts UTF-16 code units. Never truncate.
    return len(text.encode("utf-16-le")) // 2


def parse_request(raw):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate field")
            result[key] = value
        return result
    body = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_pairs)
    if not isinstance(body, dict) or set(body) - {"input", "model", "voice", "response_format", "instructions"}:
        raise ValueError("unsupported request fields or speed")
    if body.get("model") != MODEL_ID or body.get("voice") not in VOICES or body.get("response_format") != "wav":
        raise ValueError("exact model, fixed voice and WAV required")
    text, instructions = body.get("input"), body.get("instructions", "")
    if not isinstance(text, str) or not text.strip() or utf16_length(text) > MAX_INPUT:
        raise ValueError("input exceeds declared limit or is empty")
    if not isinstance(instructions, str) or utf16_length(instructions) > MAX_INSTRUCTIONS:
        raise ValueError("instructions exceed declared limit")
    if any(ord(c) < 32 and c not in "\n\t\r" for c in text + instructions):
        raise ValueError("control characters are unsupported")
    return text, body["voice"], instructions


def file_hash(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify_model(directory):
    root = Path(directory).resolve(strict=True)
    lock = json.loads((root / "storyforge-model-lock.json").read_text())
    if lock.get("repository") != MODEL_REPO or lock.get("revision") != MODEL_REVISION:
        raise ValueError("model provenance lock mismatch")
    files = lock.get("files", {})
    required = {"config.json", "generation_config.json", "merges.txt", "vocab.json", "tokenizer_config.json",
                "preprocessor_config.json", "speech_tokenizer/config.json", "speech_tokenizer/configuration.json",
                "speech_tokenizer/preprocessor_config.json", *WEIGHTS}
    if set(files) != required:
        raise ValueError("model lock has missing or unexpected files")
    official = json.loads(Path(__file__).with_name("model-source.json").read_text())["files"]
    for name, expected in files.items():
        path = root / name
        if path.is_symlink() or not path.is_file() or path.resolve().is_relative_to(root) is False:
            raise ValueError("model file is missing or unsafe")
        if name in WEIGHTS and (expected.get("size"), expected.get("sha256")) != WEIGHTS[name]:
            raise ValueError("official weight identity mismatch")
        if path.stat().st_size != expected["size"] or file_hash(path) != expected["sha256"]:
            raise ValueError("model bytes mismatch")
        if name not in WEIGHTS:
            raw = path.read_bytes()
            if hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() != official[name]["gitBlob"]:
                raise ValueError("model configuration differs from pinned official snapshot")
    return root


class QwenEngine:
    def __init__(self, directory, device):
        import torch
        from qwen_tts import Qwen3TTSModel
        root = verify_model(directory)
        if device == "mps" and not torch.backends.mps.is_available():
            raise ValueError("explicit MPS device is unavailable; no silent fallback")
        torch.set_num_threads(4)
        # No FlashAttention, external SoX executable, Gradio server or remote code.
        self.model = Qwen3TTSModel.from_pretrained(str(root), device_map=device,
                                                  dtype=torch.float32 if device == "cpu" else torch.float16,
                                                  attn_implementation="eager", local_files_only=True)
        self.device = device

    def synthesize(self, text, voice, instructions):
        import numpy as np
        import torch
        started = time.monotonic()
        with torch.inference_mode():
            clips, rate = self.model.generate_custom_voice(text=text, language="Chinese", speaker=voice,
                                                           instruct=instructions, max_new_tokens=1536)
        if len(clips) != 1 or rate != 24000:
            raise ValueError("unexpected model output")
        samples = np.asarray(clips[0], dtype=np.float32)
        if samples.ndim != 1 or samples.size < 2 or samples.size > rate * MAX_SECONDS or not np.isfinite(samples).all():
            raise ValueError("invalid audio samples")
        # PCM conversion is explicit; no normalization, speed change or trimming.
        if np.max(np.abs(samples)) > 1:
            raise ValueError("model output would clip PCM16")
        pcm = np.rint(samples * 32767).astype("<i2").tobytes()
        target = io.BytesIO()
        with wave.open(target, "wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(rate); output.writeframes(pcm)
        return target.getvalue(), {"input_characters": utf16_length(text), "audio_frames": samples.size,
                                   "sample_rate_hz": rate, "inference_ms": round((time.monotonic() - started) * 1000),
                                   "device": self.device, "model_revision": MODEL_REVISION}


class VoiceServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, port, origins, engine):
        self.origins, self.engine = frozenset(origins), engine
        self.generation_lock = threading.Lock()
        # Process-local duplicate protection. Browser durable ledger remains the
        # authority after stop/restart/unknown results. No automatic replay.
        self.seen = set()
        super().__init__(("127.0.0.1", port), VoiceHandler)


class VoiceHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *_):
        pass  # Never log dialogue, instructions, credentials or response bytes.

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def allowed(self):
        hosts = self.headers.get_all("Host", [])
        origins = self.headers.get_all("Origin", [])
        return (hosts == [f"127.0.0.1:{self.server.server_port}"]
                and (not origins or len(origins) == 1 and origins[0] in self.server.origins))

    def send(self, status, body, mime="application/json", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        origin = self.headers.get("Origin")
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Expose-Headers", "x-request-id,x-storyforge-usage,x-storyforge-cost-usd")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A disconnected client must not trigger a second generation.
        self.close_connection = True

    def error(self, status, reason):
        self.send(status, json.dumps({"error": reason}).encode())

    def do_OPTIONS(self):
        if not self.allowed() or self.path not in ("/v1/audio/speech", "/v1/capabilities"):
            return self.error(403, "origin or route denied")
        self.send(204, b"", extra={"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                                   "Access-Control-Allow-Headers": "content-type,x-storyforge-idempotency-key",
                                   "Access-Control-Allow-Private-Network": "true"})

    def do_GET(self):
        if not self.allowed():
            return self.error(403, "origin or host denied")
        if self.path != "/v1/capabilities":
            return self.error(404, "unknown route")
        self.send(200, json.dumps(capabilities()).encode())

    def do_POST(self):
        if not self.allowed():
            return self.error(403, "origin or host denied")
        if self.path != "/v1/audio/speech":
            return self.error(404, "unknown route")
        key = self.headers.get("x-storyforge-idempotency-key", "")
        lengths = self.headers.get_all("Content-Length", [])
        if (self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isdigit()
                or not 0 < int(lengths[0]) <= MAX_BODY or self.headers.get_content_type() != "application/json"
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}", key)):
            return self.error(400, "bounded JSON and exact request identity required")
        try:
            raw = self.rfile.read(int(lengths[0]))
            if len(raw) != int(lengths[0]):
                raise ValueError("incomplete body")
            text, voice, instructions = parse_request(raw)
        except (ValueError, UnicodeError, TimeoutError):
            return self.error(400, "unsupported exact speech request")
        if not self.server.generation_lock.acquire(blocking=False):
            return self.error(409, "generation busy; do not retry automatically")
        request_id = "avg-local-" + uuid.uuid4().hex
        try:
            if key in self.server.seen or len(self.server.seen) >= 256:
                return self.error(409, "request held or process batch limit reached; no replay")
            self.server.seen.add(key)
            audio, usage = self.server.engine.synthesize(text, voice, instructions)
            self.send(200, audio, "audio/wav", {"x-request-id": request_id,
                       "x-storyforge-cost-usd": "0", "x-storyforge-usage": json.dumps(usage, ensure_ascii=True)})
        except Exception:
            self.send(500, b'{"error":"local generation failed; inspect receipt before any new request"}',
                      extra={"x-request-id": request_id, "x-storyforge-cost-usd": "0"})
        finally:
            self.server.generation_lock.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--device", choices=("cpu", "mps", "cuda:0"), default="cpu")
    parser.add_argument("--port", type=int, default=5297)
    parser.add_argument("--origin", action="append", default=[])
    args = parser.parse_args()
    origins = args.origin or ["http://127.0.0.1:5196", "http://127.0.0.1:1111"]
    for origin in origins:
        if not re.fullmatch(r"http://127\.0\.0\.1:[1-9][0-9]{0,4}", origin):
            parser.error("origins must be explicit loopback application origins")
    # Disable implicit Hub network calls before importing model libraries.
    import os
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    server = VoiceServer(args.port, origins, QwenEngine(args.model_dir, args.device))
    print(json.dumps({"listening": f"http://127.0.0.1:{args.port}", "model": MODEL_ID, "device": args.device}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
