"""Loopback-only SAM 2.1 + alpha matting service for AVG image candidates.

This process handles one image in memory and has no StoryForge data or adoption
authority. It never downloads code or weights, retries an operation, or logs
request bytes.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from scipy.ndimage import binary_dilation, binary_erosion

MODEL_ID = "sam2.1-hiera-tiny"
MODEL_REVISION = "2b90b9f5ceec907a1c18123530e92e794ad901a4"
ALGORITHM = "storyforge.avg.foreground.sam2.1-pymatting.v4"
PROMPT_STRATEGY = "portrait-center-box75-v3"
ALGORITHM_V5 = "storyforge.avg.foreground.sam2.1-pymatting.v5"
PROMPT_STRATEGY_V5 = "portrait-box75-or-body-anchors-v1"
QUALITY_GATE_V5 = "score075-largest010090-alpha010090-v1"
ALGORITHM_V6 = "storyforge.avg.foreground.sam2.1-pymatting.v6"
QUALITY_GATE_V6 = "score075-largest010090-neutral-edge.v1"
MATTING_METHOD_V6 = "sam-neutral-band4-pymatting-cf-ml-640.v1"
NEUTRAL_BACKGROUND_RULE = "bright-neutral-edge-connected.v1"
MAX_NEUTRAL_MASK_REMOVAL = 0.15
MIN_SCORE_V5 = 0.75
MIN_COVERAGE_V5 = 0.10
MAX_COVERAGE_V5 = 0.90
MATTING_METHOD = "sam-mask-band4-pymatting-cf-ml-640"
TRIMAP_BAND_PIXELS = 4
WEIGHTS_SHA256 = "7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69"
MAX_BODY = 32 * 1024 * 1024
MAX_PIXELS = 16 * 1024 * 1024
MAX_SIDE = 10_000
MAX_MATTING_SIDE = 640
ALLOWED_ORIGINS = frozenset({
    "http://127.0.0.1:5196", "http://localhost:5196",
    "http://127.0.0.1:1111", "http://localhost:1111",
})
LOOPBACK_ORIGIN_HOSTS = frozenset({"127.0.0.1", "localhost"})
MIME_FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
EXPOSED_HEADERS = ", ".join((
    "X-SF-Algorithm", "X-SF-Source-SHA256", "X-SF-Source-Pixel-SHA256", "X-SF-Alpha-SHA256", "X-SF-Cutout-Pixel-SHA256", "X-SF-Result-PNG-SHA256",
    "X-SF-Model-ID", "X-SF-Model-Revision", "X-SF-Checkpoint-SHA256", "X-SF-Code-Revision",
    "X-SF-Prompt-SHA256", "X-SF-Prompt-Strategy", "X-SF-Model-Score", "X-SF-Alpha-Ratio",
    "X-SF-Matting-Method", "X-SF-Device", "X-SF-Width", "X-SF-Height",
    "X-SF-Quality-Gate", "X-SF-Candidates", "X-SF-Selected-Candidate", "X-SF-Mask-Ratio", "X-SF-Neutral-Background",
))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def parse_loopback_origin(value: str) -> str:
    """Accept only an explicitly supplied canonical HTTP origin on loopback."""
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise argparse.ArgumentTypeError("origin must be a valid loopback HTTP origin with a port") from error
    if (parsed.scheme != "http" or hostname not in LOOPBACK_ORIGIN_HOSTS or port is None
            or parsed.username is not None or parsed.password is not None
            or parsed.path or parsed.query or parsed.fragment
            or parsed.netloc != f"{hostname}:{port}"):
        raise argparse.ArgumentTypeError("origin must be canonical http://127.0.0.1:PORT or http://localhost:PORT")
    return f"http://{hostname}:{port}"


def portrait_prompts(width: int, height: int, version: int = 4):
    # The box encloses a centered, full-height character while leaving a narrow
    # margin. Percent coordinates are hashed; pixel coordinates stay internal.
    box = {"x1": 1250, "x2": 8750, "y1": 100, "y2": 9900}
    coords = [
        (box["x1"] / 10000 * (width - 1), box["y1"] / 10000 * (height - 1)),
        (box["x2"] / 10000 * (width - 1), box["y2"] / 10000 * (height - 1)),
    ]
    result = [{"box": box, "box_coords": coords}]
    if version == 5:
        points = [{"label": 1, "x": 5000, "y": 1600}, {"label": 1, "x": 5000, "y": 4000},
                  {"label": 1, "x": 5000, "y": 7200}]
        result.append({"box": dict(box), "box_coords": list(coords), "points": points,
                       "point_coords": [(p["x"] / 10000 * (width - 1), p["y"] / 10000 * (height - 1)) for p in points],
                       "point_labels": [p["label"] for p in points]})
    elif version != 4:
        raise ValueError("unknown foreground prompt version")
    return result


def prompt_manifest(prompt_sets):
    return [{"box": item["box"], **({"points": item["points"]} if "points" in item else {})} for item in prompt_sets]


class ForegroundQualityError(RuntimeError):
    pass


def derive_neutral_background_v1(rgb):
    """Four-connected source colour analysis, without a model or persistence.

    Median and nearest-rank P99 use the same integer/half-integer definition
    as the browser verifier. Similar enclosed foreground colours are not
    connected to the outside, so they are not cleared by colour alone.
    """
    import numpy as np
    from scipy.ndimage import binary_propagation
    if (not isinstance(rgb, np.ndarray) or rgb.dtype != np.uint8 or rgb.ndim != 3
            or rgb.shape[2] != 3 or min(rgb.shape[:2]) < 2
            or max(rgb.shape[:2]) > MAX_SIDE or rgb.shape[0] * rgb.shape[1] > MAX_PIXELS):
        raise ValueError("invalid neutral background source raster")
    border = np.concatenate((rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1])).astype(np.float64)
    median = np.median(border, axis=0)
    if float(median.min()) < 180 or float(median.max() - median.min()) > 8:
        raise ForegroundQualityError("source border is not a bright neutral background")
    deviations = np.sort(np.max(np.abs(border - median), axis=1))
    p99 = float(deviations[(99 * len(border) + 99) // 100 - 1])
    if p99 > 10:
        raise ForegroundQualityError("neutral background border is not stable")
    radius = int(max(8, 2 * p99 + 4))
    source = rgb.astype(np.int16)
    allowed = ((np.max(np.abs(source - median), axis=2) <= radius)
               & (source.max(axis=2) - source.min(axis=2) <= 8))
    border_allowed = np.concatenate((allowed[0], allowed[-1], allowed[:, 0], allowed[:, -1]))
    border_coverage = float(np.mean(border_allowed))
    if border_coverage < 0.95:
        raise ForegroundQualityError("neutral background does not cover 95% of the border")
    seed = np.zeros(allowed.shape, dtype=bool)
    seed[0] = allowed[0]; seed[-1] = allowed[-1]
    seed[:, 0] = allowed[:, 0]; seed[:, -1] = allowed[:, -1]
    cross = np.asarray([[False, True, False], [True, True, True], [False, True, False]])
    flood = binary_propagation(seed, mask=allowed, structure=cross)
    count = int(np.count_nonzero(flood))
    if count == flood.size:
        raise ForegroundQualityError("source is entirely background")
    return flood, {"rule": NEUTRAL_BACKGROUND_RULE, "median": [float(v) for v in median],
                   "borderP99Deviation": p99, "radius": radius, "borderCoverage": border_coverage,
                   "floodPixelCount": count, "floodMaskSha256": sha256(flood.astype(np.uint8).tobytes())}


def select_candidate_observations_v5(candidates):
    import math
    if not isinstance(candidates, list) or len(candidates) != 6:
        raise RuntimeError("V5 requires all six mask observations")
    eligible = []
    for index, item in enumerate(candidates):
        if (not isinstance(item, dict) or set(item) != {"promptIndex", "maskIndex", "score", "maskCoverage"}
                or type(item["promptIndex"]) is not int or type(item["maskIndex"]) is not int
                or item["promptIndex"] != index // 3 or item["maskIndex"] != index % 3):
            raise RuntimeError("V5 mask observation order is invalid")
        score, coverage = item["score"], item["maskCoverage"]
        if (isinstance(score, bool) or isinstance(coverage, bool) or not isinstance(score, (int, float))
                or not isinstance(coverage, (int, float)) or not math.isfinite(score) or not math.isfinite(coverage)
                or not 0 <= score <= 1 or not 0 <= coverage <= 1):
            raise RuntimeError("V5 mask observation is invalid")
        if score >= MIN_SCORE_V5 and MIN_COVERAGE_V5 <= coverage <= MAX_COVERAGE_V5:
            eligible.append(index)
    if not eligible:
        raise ForegroundQualityError("no SAM 2 mask passed the fixed V5 plausibility gate")
    return max(eligible, key=lambda index: (candidates[index]["maskCoverage"], candidates[index]["score"]))


def select_portrait_mask(predictor, prompt_sets, shape, version=4):
    import numpy as np
    candidates, logits_by_candidate = [], []
    for prompt_index, prompt in enumerate(prompt_sets):
        kwargs = {}
        if "point_coords" in prompt:
            kwargs = {"point_coords": np.asarray(prompt["point_coords"], dtype=np.float32),
                      "point_labels": np.asarray(prompt["point_labels"], dtype=np.int32)}
        masks, scores, _ = predictor.predict(box=np.asarray(prompt["box_coords"], dtype=np.float32),
                                             multimask_output=True, return_logits=True, **kwargs)
        masks, scores = np.asarray(masks), np.asarray(scores)
        if masks.ndim != 3 or masks.shape[1:] != shape or scores.shape != (len(masks),) or not len(masks):
            raise RuntimeError("SAM 2 returned invalid mask observations")
        if version == 4:
            index = int(np.argmax(scores))
            if not np.isfinite(masks[index]).all() or not np.isfinite(scores[index]) or not 0 <= scores[index] <= 1:
                raise RuntimeError("SAM 2 returned an invalid selected V4 mask")
            return np.asarray(masks[index], dtype=np.float32), float(scores[index]), None
        if len(masks) != 3 or not np.isfinite(masks).all() or not np.isfinite(scores).all() or np.any(scores < 0) or np.any(scores > 1):
            raise RuntimeError("SAM 2 returned invalid V5 mask observations")
        for mask_index, (mask, score) in enumerate(zip(masks, scores)):
            candidates.append({"promptIndex": prompt_index, "maskIndex": mask_index,
                               "score": float(score), "maskCoverage": float(np.mean(mask > 0))})
            logits_by_candidate.append(np.asarray(mask, dtype=np.float32))
    index = select_candidate_observations_v5(candidates)
    return logits_by_candidate[index], candidates[index]["score"], {
        "selectedCandidateIndex": index, "maskCoverage": candidates[index]["maskCoverage"], "candidates": candidates}


def validate_source(headers, raw: bytes, require_opaque=False):
    if len(raw) < 1 or len(raw) > MAX_BODY:
        raise ValueError("图像字节超出服务上限")
    content_type = headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/octet-stream":
        raise ValueError("请求必须以二进制原图发送")
    declared_mime = headers.get("X-SF-Source-Mime", "")
    if declared_mime not in MIME_FORMATS:
        raise ValueError("只接受 PNG、JPEG 或 WebP 原图")
    source_hash = headers.get("X-SF-Source-SHA256", "")
    if not re.fullmatch(r"[a-f0-9]{64}", source_hash) or sha256(raw) != source_hash:
        raise ValueError("原图字节 SHA-256 不一致")
    try:
        width, height = int(headers.get("X-SF-Source-Width", "")), int(headers.get("X-SF-Source-Height", ""))
    except ValueError as error:
        raise ValueError("原图尺寸无效") from error
    if width < 32 or height < 32 or width > MAX_SIDE or height > MAX_SIDE or width * height > MAX_PIXELS:
        raise ValueError("原图尺寸或像素数超出服务上限")
    operation = headers.get("X-SF-Operation-ID", "")
    try:
        if str(uuid.UUID(operation)) != operation:
            raise ValueError
    except (ValueError, AttributeError) as error:
        raise ValueError("需要唯一 UUID 操作编号") from error

    from PIL import Image, ImageFile
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    try:
        image = Image.open(io.BytesIO(raw))
        if image.format != MIME_FORMATS[declared_mime] or getattr(image, "is_animated", False):
            raise ValueError("原图编码与声明不符或包含动画帧")
        if image.size != (width, height):
            raise ValueError("原图解码尺寸与冻结尺寸不符")
        image.load()
        if require_opaque and image.convert("RGBA").getextrema()[3] != (255, 255):
            raise ValueError("原图已有透明像素；请保留原始透明度并使用画布加工")
        rgb = image.convert("RGB")
    except (OSError, Image.DecompressionBombError) as error:
        raise ValueError("原图无法安全解码") from error
    import numpy as np
    pixels = np.asarray(rgb, dtype=np.uint8).copy()
    return operation, source_hash, declared_mime, width, height, pixels


def verify_model_installation(model_dir: Path, source_dir: Path):
    checkpoint_candidate = model_dir / "sam2.1_hiera_tiny.pt"
    if checkpoint_candidate.is_symlink() or not checkpoint_candidate.is_file():
        raise RuntimeError("SAM 2.1 tiny 权重缺失或路径不安全")
    checkpoint = checkpoint_candidate.resolve(strict=True)
    if file_sha256(checkpoint) != WEIGHTS_SHA256:
        raise RuntimeError("SAM 2.1 tiny 权重缺失或 SHA-256 不匹配")
    result = subprocess.run(["git", "-C", str(source_dir), "rev-parse", "HEAD"],
                            check=True, capture_output=True, text=True)
    if result.stdout.strip() != MODEL_REVISION:
        raise RuntimeError("SAM 2 源码不在登记的固定 commit")
    return checkpoint


class Sam2MattingEngine:
    def __init__(self, model_dir: Path, source_dir: Path, selected_device: str | None = None):
        if selected_device == "mps" or selected_device is None:
            # SAM 2.1 uses bicubic position interpolation that may require the
            # documented PyTorch CPU fallback on current MPS builds.
            os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        self.checkpoint = verify_model_installation(model_dir, source_dir)
        if selected_device is None:
            selected_device = "mps" if torch.backends.mps.is_available() else "cpu"
        if selected_device not in {"cpu", "mps"}:
            raise RuntimeError("本服务仅选择 CPU 或 Apple MPS")
        if selected_device == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("已指定 MPS，但当前机器没有可用的 MPS")
        torch.set_num_threads(2)
        model = build_sam2("configs/sam2.1/sam2.1_hiera_t.yaml", str(self.checkpoint),
                           device=selected_device, mode="eval")
        self.predictor = SAM2ImagePredictor(model)
        self.device = "mps+cpu-fallback" if selected_device == "mps" and os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK") == "1" else selected_device
        self.torch = torch

    def segment(self, rgb, prompt_sets):
        return self._segment(rgb, prompt_sets, 4)[:5]

    def segment_v5(self, rgb, prompt_sets):
        return self._segment(rgb, prompt_sets, 5)

    def segment_v6(self, rgb, prompt_sets):
        return self._segment(rgb, prompt_sets, 6)

    def _segment(self, rgb, prompt_sets, version):
        import numpy as np
        from PIL import Image
        from pymatting import estimate_alpha_cf, estimate_foreground_ml

        neutral_mask, neutral = derive_neutral_background_v1(rgb) if version == 6 else (None, None)
        self.predictor.set_image(rgb)
        with self.torch.inference_mode():
            logits, score, selection = select_portrait_mask(self.predictor, prompt_sets, rgb.shape[:2], 5 if version == 6 else version)
        if version == 4 and score < 0.5:
            raise RuntimeError("SAM 2 人物框候选置信度不足，拒绝生成加工结果")

        height, width = rgb.shape[:2]
        scale = min(1.0, MAX_MATTING_SIDE / max(width, height))
        small_size = (max(2, round(width * scale)), max(2, round(height * scale)))
        image_small = np.asarray(Image.fromarray(rgb).resize(small_size, Image.Resampling.LANCZOS), dtype=np.float64) / 255.0
        mask = logits > 0
        if version == 6:
            removed = int(np.count_nonzero(mask & neutral_mask))
            if removed > int(np.count_nonzero(mask) * MAX_NEUTRAL_MASK_REMOVAL):
                raise ForegroundQualityError("neutral correction would remove too much of the selected mask")
            neutral["removedMaskPixelCount"] = removed
            mask = mask & ~neutral_mask
        mask_small = np.asarray(Image.fromarray(mask.astype(np.uint8) * 255, mode="L")
                                .resize(small_size, Image.Resampling.NEAREST), dtype=np.uint8) > 0
        foreground_core = binary_erosion(mask_small, iterations=TRIMAP_BAND_PIXELS)
        background_core = ~binary_dilation(mask_small, iterations=TRIMAP_BAND_PIXELS)
        if version == 6:
            known_neutral = np.asarray(Image.fromarray(neutral_mask.astype(np.uint8) * 255, mode="L")
                                       .resize(small_size, Image.Resampling.NEAREST), dtype=np.uint8) > 0
            background_core |= known_neutral
        trimap = np.full(mask_small.shape, 0.5, dtype=np.float64)
        trimap[background_core] = 0.0
        trimap[foreground_core] = 1.0
        known_foreground = int(np.count_nonzero(trimap == 1.0))
        known_background = int(np.count_nonzero(trimap == 0.0))
        if known_foreground < 8 or known_background < 8 or not np.any(trimap == 0.5):
            raise RuntimeError("SAM 2 掩模没有足够的前景、背景和待估边缘区域")

        # Bounded-resolution matting prevents a large source image from creating
        # an unbounded sparse system. The final alpha and foreground are rescaled
        # to source dimensions and remain a candidate for visual review.
        alpha_small = np.clip(estimate_alpha_cf(image_small, trimap), 0.0, 1.0)
        if not np.isfinite(alpha_small).all():
            raise RuntimeError("PyMatting 返回非有限 alpha")
        foreground_small = np.clip(estimate_foreground_ml(image_small, alpha_small), 0.0, 1.0)
        if not np.isfinite(foreground_small).all():
            raise RuntimeError("PyMatting 返回非有限前景颜色")

        alpha_image = Image.fromarray(np.rint(alpha_small * 255).astype(np.uint8), mode="L")
        alpha = np.asarray(alpha_image.resize((width, height), Image.Resampling.LANCZOS), dtype=np.uint8).copy()
        if version == 6:
            alpha[neutral_mask] = 0
        foreground_image = Image.fromarray(np.rint(foreground_small * 255).astype(np.uint8), mode="RGB")
        foreground = np.asarray(foreground_image.resize((width, height), Image.Resampling.LANCZOS), dtype=np.uint8)
        output = rgb.copy()
        uncertain = (alpha > 0) & (alpha < 255)
        output[uncertain] = foreground[uncertain]
        output[alpha == 0] = 0
        ratio = float(np.count_nonzero(alpha >= 128) / (width * height))
        if version in (5, 6) and not MIN_COVERAGE_V5 <= ratio <= MAX_COVERAGE_V5:
            raise ForegroundQualityError("V5 alpha coverage did not pass its fixed plausibility gate")
        if version == 4 and not 0.03 <= ratio <= 0.90:
            raise RuntimeError("前景覆盖比例异常，拒绝生成不完整或几乎全不透明候选")
        if version == 6:
            return alpha, output, score, ratio, MATTING_METHOD_V6, selection, neutral
        return alpha, output, score, ratio, MATTING_METHOD, selection


class ForegroundHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, engine, allowed_origins=ALLOWED_ORIGINS):
        super().__init__(address, ForegroundRequestHandler)
        self.engine = engine
        self.allowed_origins = frozenset(allowed_origins)
        self.operations = set()
        self.operation_lock = threading.Lock()
        self.inference_lock = threading.Lock()
        self.started = True


class ForegroundRequestHandler(BaseHTTPRequestHandler):
    server_version = "StoryForgeAVGForeground/1"
    sys_version = ""

    def log_message(self, _format, *_args):
        # Avoid logging origins, headers, image names, prompt data or bytes.
        return

    def _host_ok(self):
        host = self.headers.get("Host", "")
        return host in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def _origin(self, required=True):
        origin = self.headers.get("Origin")
        return origin if origin in self.server.allowed_origins else (None if not required and origin is None else False)

    def _headers(self, origin=None, content_type="application/json; charset=utf-8"):
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-SF-Operation-ID, X-SF-Source-SHA256, X-SF-Source-Mime, X-SF-Source-Width, X-SF-Source-Height")
            self.send_header("Access-Control-Expose-Headers", EXPOSED_HEADERS)
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status, body, origin=None):
        payload = canonical_json(body)
        self.send_response(status)
        self._headers(origin)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        origin = self._origin()
        if origin is False or not self._host_ok():
            self.send_error(403)
            return
        requested_method = self.headers.get("Access-Control-Request-Method", "")
        requested_headers = {h.strip().lower() for h in self.headers.get("Access-Control-Request-Headers", "").split(",") if h.strip()}
        allowed = {"content-type", "x-sf-operation-id", "x-sf-source-sha256", "x-sf-source-mime", "x-sf-source-width", "x-sf-source-height"}
        if requested_method not in {"GET", "POST"} or not requested_headers.issubset(allowed):
            self.send_error(403)
            return
        self.send_response(204)
        self._headers(origin)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        origin = self._origin(required=False)
        if origin is False or not self._host_ok():
            self._json(403, {"error": "loopback StoryForge origin required"})
            return
        if self.path not in {"/v1/capabilities", "/v2/capabilities", "/v3/capabilities"}:
            self._json(404, {"error": "unknown route"}, origin)
            return
        engine = self.server.engine
        neutral = self.path == "/v3/capabilities"
        anchored = self.path in {"/v2/capabilities", "/v3/capabilities"}
        self._json(200, {"schema": "storyforge.avg.local-foreground-capability", "version": 3 if neutral else 2 if anchored else 1,
                         "ready": True, "algorithm": ALGORITHM_V6 if neutral else ALGORITHM_V5 if anchored else ALGORITHM, "model": MODEL_ID,
                         "modelRevision": MODEL_REVISION, "checkpointSha256": WEIGHTS_SHA256,
                         "codeRevision": MODEL_REVISION, "device": engine.device,
                         "storage": "none", "networkInference": False,
                         "mattingMethod": MATTING_METHOD_V6 if neutral else MATTING_METHOD,
                         **({"promptStrategy": PROMPT_STRATEGY_V5, "qualityGate": QUALITY_GATE_V6 if neutral else QUALITY_GATE_V5} if anchored else {}),
                         **({"backgroundRule": NEUTRAL_BACKGROUND_RULE} if neutral else {})}, origin)

    def do_POST(self):
        origin = self._origin()
        if origin is False or not self._host_ok():
            self._json(403, {"error": "loopback StoryForge origin required"})
            return
        if self.path not in {"/v1/segment", "/v2/segment", "/v3/segment"}:
            self._json(404, {"error": "unknown route"}, origin)
            return
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not lengths[0].isdigit():
            self._json(400, {"error": "one bounded Content-Length is required"}, origin)
            return
        length = int(lengths[0])
        if length < 1 or length > MAX_BODY or self.headers.get("Transfer-Encoding"):
            self._json(413, {"error": "image body exceeds the declared byte limit"}, origin)
            return
        raw = self.rfile.read(length)
        if len(raw) != length:
            self._json(400, {"error": "incomplete image body"}, origin)
            return
        try:
            version = 6 if self.path == "/v3/segment" else 5 if self.path == "/v2/segment" else 4
            operation, source_hash, _mime, width, height, rgb = validate_source(self.headers, raw, require_opaque=version in (5, 6))
            with self.server.operation_lock:
                if operation in self.server.operations:
                    self._json(409, {"error": "operation id already used; do not replay"}, origin)
                    return
                if len(self.server.operations) >= 1024:
                    self._json(503, {"error": "operation ledger full; restart the local service"}, origin)
                    return
                self.server.operations.add(operation)
            if not self.server.inference_lock.acquire(blocking=False):
                self._json(409, {"error": "local inference is busy; no request was queued"}, origin)
                return
            try:
                prompt_sets = portrait_prompts(width, height, 5 if version == 6 else version)
                if version == 6:
                    alpha, foreground, score, ratio, matting, selection, background = self.server.engine.segment_v6(rgb, prompt_sets)
                elif version == 5:
                    alpha, foreground, score, ratio, matting, selection = self.server.engine.segment_v5(rgb, prompt_sets)
                else:
                    alpha, foreground, score, ratio, matting = self.server.engine.segment(rgb, prompt_sets)
                    selection = None
            finally:
                self.server.inference_lock.release()
            import numpy as np
            from PIL import Image
            if (not isinstance(alpha, np.ndarray) or alpha.shape != (height, width) or alpha.dtype != np.uint8
                    or not isinstance(foreground, np.ndarray) or foreground.shape != (height, width, 3)
                    or foreground.dtype != np.uint8):
                raise RuntimeError("本地引擎返回的 RGBA 尺寸或类型无效")
            if matting != (MATTING_METHOD_V6 if version == 6 else MATTING_METHOD) or not np.isfinite(score) or not 0 <= score <= 1 or not np.isfinite(ratio) or not 0 <= ratio <= 1:
                raise RuntimeError("本地引擎观察值无效")
            if version in (5, 6):
                selected = select_candidate_observations_v5(selection["candidates"])
                candidate = selection["candidates"][selected]
                if (selection["selectedCandidateIndex"] != selected or selection["maskCoverage"] != candidate["maskCoverage"]
                        or score != candidate["score"] or abs(ratio - float(np.mean(alpha >= 128))) > 1e-12):
                    raise RuntimeError("V5 selection does not match the recorded mask and alpha")
                if not MIN_COVERAGE_V5 <= ratio <= MAX_COVERAGE_V5:
                    raise ForegroundQualityError("V5 alpha coverage did not pass its fixed plausibility gate")
            if version == 6:
                expected_flood, expected_background = derive_neutral_background_v1(rgb)
                if (not isinstance(background, dict) or set(background) != {*expected_background, "removedMaskPixelCount"}
                        or any(background[key] != value for key, value in expected_background.items())
                        or type(background["removedMaskPixelCount"]) is not int
                        or not 0 <= background["removedMaskPixelCount"] <= min(background["floodPixelCount"], int(round(selection["maskCoverage"] * width * height) * MAX_NEUTRAL_MASK_REMOVAL))
                        or np.any(alpha[expected_flood] != 0)):
                    raise RuntimeError("V6 background claims do not match the source and actual alpha")
            output = io.BytesIO()
            rgba = np.dstack((foreground, alpha))
            Image.fromarray(rgba, mode="RGBA").save(output, format="PNG", optimize=False)
            mask_bytes = output.getvalue()
            strategy = PROMPT_STRATEGY_V5 if version in (5, 6) else PROMPT_STRATEGY
            prompt_hash = sha256(canonical_json({"strategy": strategy, "prompts": prompt_manifest(prompt_sets)}))
            response_headers = {
                "X-SF-Algorithm": ALGORITHM_V6 if version == 6 else ALGORITHM_V5 if version == 5 else ALGORITHM, "X-SF-Source-SHA256": source_hash,
                "X-SF-Source-Pixel-SHA256": sha256(rgb.tobytes()), "X-SF-Alpha-SHA256": sha256(alpha.tobytes()),
                "X-SF-Cutout-Pixel-SHA256": sha256(rgba.tobytes()), "X-SF-Result-PNG-SHA256": sha256(mask_bytes),
                "X-SF-Model-ID": MODEL_ID, "X-SF-Model-Revision": MODEL_REVISION,
                "X-SF-Checkpoint-SHA256": WEIGHTS_SHA256, "X-SF-Code-Revision": MODEL_REVISION,
                "X-SF-Prompt-SHA256": prompt_hash, "X-SF-Prompt-Strategy": strategy,
                "X-SF-Model-Score": format(float(score), ".6f"), "X-SF-Alpha-Ratio": format(float(ratio), ".8f"),
                "X-SF-Matting-Method": matting, "X-SF-Device": self.server.engine.device,
                "X-SF-Width": str(width), "X-SF-Height": str(height),
            }
            if version in (5, 6):
                response_headers.update({"X-SF-Quality-Gate": QUALITY_GATE_V6 if version == 6 else QUALITY_GATE_V5,
                                         "X-SF-Candidates": canonical_json(selection["candidates"]).decode("utf-8"),
                                         "X-SF-Selected-Candidate": str(selection["selectedCandidateIndex"]),
                                         "X-SF-Mask-Ratio": format(float(selection["maskCoverage"]), ".8f")})
            if version == 6:
                response_headers["X-SF-Neutral-Background"] = canonical_json(background).decode("utf-8")
            self.send_response(200)
            self._headers(origin, "image/png")
            self.send_header("Content-Length", str(len(mask_bytes)))
            for name, value in response_headers.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(mask_bytes)
        except ForegroundQualityError:
            self._json(422, {"error": "本机分割未达到固定完整性挡板；原图未改动，也未自动重试"}, origin)
        except ValueError as error:
            self._json(400, {"error": str(error)}, origin)
        except Exception:
            # Error text may contain local paths or library details; keep them
            # out of the browser response. stderr is the local operator log.
            self._json(500, {"error": "本地分割或 alpha 估算失败；原图未改动，也未自动重试"}, origin)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5278)
    parser.add_argument("--origin", action="append", type=parse_loopback_origin, default=[],
                        help="explicitly allow a local StoryForge browser origin; may be repeated")
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost"}:
        raise SystemExit("仅允许绑定本机 loopback 地址")
    base = Path.home() / ".local" / "share" / "storyforge" / "avg-local-foreground"
    model_dir = Path(os.environ.get("AVG_SAM2_MODEL_DIR", str(base / "models"))).expanduser()
    source_dir = Path(os.environ.get("AVG_SAM2_SOURCE_DIR", str(base / "sam2-source"))).expanduser()
    selected_device = os.environ.get("AVG_SAM2_DEVICE")
    engine = Sam2MattingEngine(model_dir, source_dir, selected_device)
    server = ForegroundHTTPServer((args.host, args.port), engine, ALLOWED_ORIGINS.union(args.origin))
    print(f"AVG local foreground ready at http://{args.host}:{args.port} ({MODEL_ID}, {engine.device}); images stay in memory", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
