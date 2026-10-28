"""Single-clip offline instrumental evaluation; no Work or adoption access."""
import io
import math
from pathlib import Path
import re
import time
import wave

from haar_correction import BACKEND_ID
from runtime_guard import CODE_REVISION, MODEL_REPOSITORY, MODEL_REVISION, fingerprint, sha256, verify_model, verify_source

PROFILE_ID = "storyforge.avg.instrumental-evaluation-v1"


def parse_request(value):
    if not isinstance(value, dict) or set(value) != {"caption", "durationSeconds", "seed", "bpm", "keyscale"}:
        raise ValueError("Exact bounded instrumental evaluation fields required")
    caption, duration, seed, bpm, key = (value[k] for k in ("caption", "durationSeconds", "seed", "bpm", "keyscale"))
    if not isinstance(caption, str) or not caption.strip() or len(caption.encode("utf-16-le")) // 2 > 512:
        raise ValueError("Caption must contain1..512 UTF16 code units; it is never truncated")
    if any(ord(c) < 32 and c not in "\n\t\r" for c in caption):
        raise ValueError("Caption contains unsupported control characters")
    if type(duration) is not int or not 10 <= duration <= 30 or type(seed) is not int or not 0 <= seed <= 2147483647:
        raise ValueError("This evaluation requires10..30 seconds and an explicit bounded integer seed")
    if type(bpm) is not int or not 30 <= bpm <= 300 or not isinstance(key, str) or not 1 <= len(key) <= 16:
        raise ValueError("Explicit BPM and musical key required")
    if not re.fullmatch(r"[A-G](?:#|b)? (?:Major|Minor)", key):
        raise ValueError("Unsupported musical key syntax")
    return dict(value)


class InstrumentalEngine:
    def __init__(self, model_directory, source_directory, device="cpu"):
        if device != "cpu":
            raise ValueError("This evaluated profile requires explicit CPU execution")
        self.source_root, self.model_root = Path(source_directory).resolve(), Path(model_directory).resolve()
        self.source_proof, self.model_proof = verify_source(self.source_root), verify_model(self.model_root)
        self.wavelet_steps, self.used, self.model_calls, self.last_samples = 0, False, 0, None
        from offline_handler import make_handler
        import torch
        torch.set_num_threads(4)
        self.device = device
        self.handler = make_handler(self.source_root, self.model_root, self._observe_wavelet)
        with torch.inference_mode():
            status, success = self.handler.initialize_service(project_root=str(self.source_root), config_path="acestep-v15-turbo",
                device=device, use_flash_attention=False, compile_model=False, offload_to_cpu=False,
                offload_dit_to_cpu=False, quantization=None, use_mlx_dit=False, vae_checkpoint="official")
        if not success:
            raise RuntimeError("Explicit offline initialization failed: " + status)
        self.assert_fresh()

    def _observe_wavelet(self):
        self.wavelet_steps += 1

    def assert_fresh(self):
        if verify_source(self.source_root)["hash"] != self.source_proof["hash"] or verify_model(self.model_root)["hash"] != self.model_proof["hash"]:
            raise ValueError("Reviewed model or source changed during evaluation")

    def generate(self, value):
        request = parse_request(value)
        if self.used:
            raise ValueError("Single evaluation already used; failure cannot silently retry")
        self.used = True
        import numpy as np
        import torch
        from acestep.inference import GenerationParams, GenerationConfig, generate_music
        params = GenerationParams(caption=request["caption"], duration=request["durationSeconds"],
            seed=request["seed"], bpm=request["bpm"], keyscale=request["keyscale"], timesignature="4",
            lyrics="[Instrumental]", instrumental=True, inference_steps=8, guidance_scale=1.0, shift=3.0,
            thinking=False, use_cot_metas=False, use_cot_caption=False, use_cot_lyrics=False, use_cot_language=False,
            dcw_enabled=True, dcw_mode="double", dcw_scaler=.05, dcw_high_scaler=.02, dcw_wavelet="haar")
        config = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[request["seed"]], audio_format="wav")
        started = time.monotonic()
        self.model_calls += 1
        with torch.inference_mode():
            result = generate_music(self.handler, None, params, config, save_dir=None)
        elapsed = time.monotonic() - started
        if not result.success or len(result.audios) != 1:
            raise RuntimeError("Instrumental generation failed: " + str(result.error))
        audio = result.audios[0]
        samples = audio["tensor"].detach().to(device="cpu", dtype=torch.float32).numpy().copy()
        if samples.ndim == 2 and samples.shape[0] == 2 and samples.shape[1] <= 48000 * 31:
            self.last_samples = samples
        rate = audio["sample_rate"]
        if rate != 48000 or samples.ndim != 2 or samples.shape[0] != 2 or not np.isfinite(samples).all():
            raise ValueError("Invalid stereo48kHz music samples")
        seconds = samples.shape[1] / rate
        peak, rms = float(np.max(np.abs(samples))), float(np.sqrt(np.mean(samples.astype(np.float64)**2)))
        if abs(seconds - request["durationSeconds"]) > .5 or not math.isfinite(rms) or rms < 1e-5 or peak > 1.00001 or self.wavelet_steps < 1:
            raise ValueError("Music duration, signal range or actual correction execution differs")
        self.assert_fresh()
        output = io.BytesIO()
        pcm = np.rint(np.clip(samples.T, -1, 32767 / 32768) * 32768).astype("<i2")
        with wave.open(output, "wb") as writer:
            writer.setnchannels(2)
            writer.setsampwidth(2)
            writer.setframerate(rate)
            writer.writeframes(pcm.tobytes())
        data = output.getvalue()
        receipt = {"profile": PROFILE_ID, "modelRepository": MODEL_REPOSITORY, "modelRevision": MODEL_REVISION,
            "runtimeCodeRevision": CODE_REVISION, "runtimeCodePolicy": "reviewed-runtime-class-no-model-source-rewrite",
            "sourceHash": self.source_proof["hash"], "modelHash": self.model_proof["hash"], "waveletBackend": BACKEND_ID,
            "waveletSteps": self.wavelet_steps, "adapterSourceHashes": {p: sha256(Path(__file__).with_name(p)) for p in
                ("engine.py", "offline_handler.py", "haar_correction.py", "runtime_guard.py")},
            "request": request, "requestHash": fingerprint(request), "params": params.to_dict(),
            "device": self.device, "torchVersion": torch.__version__, "inferenceSeconds": elapsed,
            "sampleRateHz": rate, "channels": 2, "pcmBits": 16, "durationSeconds": seconds,
            "peakAmplitude": peak, "rmsAmplitude": rms, "providerChargeUsd": 0,
            "chargeScope": "local inference only; device, power and labor excluded", "modelCalls": self.model_calls,
            "hearing": "unobserved", "rightsReview": "unreviewed", "authorAdopted": False}
        return data, samples, receipt
