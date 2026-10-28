# AVG local foreground processor

This optional local service creates a segmentation and alpha-matting candidate for an already-produced AVG image. It uses Meta SAM 2.1 Hiera Tiny and PyMatting's closed-form alpha estimation. The service has no StoryForge database, provider credentials, network inference, adoption, or publication authority. It binds only to loopback, accepts only configured local StoryForge origins, holds one image in memory for one request, and does not save or log image bytes.

The model and Python environment live outside the repository under `~/.local/share/storyforge/avg-local-foreground`. Model code, checkpoint, Python packages, model input, and output are not committed. The pinned source and license record is in `model-source.json`. Checkpoint SHA-256 is checked at startup.

## Setup

Use Python 3.12 on Apple Silicon or another supported CPU/MPS host. The service does not fetch code or weights at startup.

```sh
BASE="$HOME/.local/share/storyforge/avg-local-foreground"
mkdir -p "$BASE/models"
python3.12 -m venv "$BASE/venv"
"$BASE/venv/bin/python" -m pip install -r scripts/avg-local-foreground/requirements.txt
git clone https://github.com/facebookresearch/sam2.git "$BASE/sam2-source"
git -C "$BASE/sam2-source" fetch --depth 1 origin 2b90b9f5ceec907a1c18123530e92e794ad901a4
git -C "$BASE/sam2-source" checkout --detach 2b90b9f5ceec907a1c18123530e92e794ad901a4
SAM2_BUILD_CUDA=0 "$BASE/venv/bin/python" -m pip install -e "$BASE/sam2-source" --no-deps
curl --fail --location --output "$BASE/models/sam2.1_hiera_tiny.pt" \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
shasum -a 256 "$BASE/models/sam2.1_hiera_tiny.pt"
```

The expected checkpoint digest is recorded in `model-source.json`. If the bytes differ, do not start the service. The fixed foreground recipe uses a centered 75%-width person box and a four-pixel unknown band around the SAM mask for PyMatting. It is designed for a centered subject and is not a quality guarantee; low-confidence or implausible coverage results are rejected, and every alpha remains an unadopted candidate that must be reviewed against the original.

V4 keeps its original box-only recipe at `/v1`. V5 uses `/v2` and compares the box with a second prompt that adds centered foreground points at 16%, 40% and 72% of image height. It records all six masks, filters scores below 0.75 and mask areas outside 10%–90%, then selects the largest eligible mask (score and original order break ties). Matting output must also have 10%–90% coverage at alpha ≥ 128. These checks reduce obvious partial masks; complex backgrounds, off-center subjects and closeups can still fail visual review. Multi-person sheets must be separated into individual images first. V5 refuses images with any existing nonopaque alpha before model inference; use canvas processing to preserve that boundary instead of segmenting hidden RGB.

V6 is a separate, explicitly selected recipe at `/v3`, for one centered opaque person on a stable bright neutral background. It preserves V4/V5 identities and uses the same six SAM candidates and model pins. Source border medians must be at least 180 in every channel with at most 8 channel spread. Nearest-rank P99 of border L-infinity deviations must be at most 10; the allowed radius is `max(8, 2*P99+4)`. Pixels within that radius and at most 8 channel spread are flooded from the border using four-connected neighbours. At least 95% of border samples must qualify; an all-background source is rejected. Similar enclosed shirt colours are not flooded merely because they match the background.

The connected background is removed from the selected mask and made known background in the bounded 640-pixel matting trimap. Removing more than 15% of the selected mask is rejected. Its final source-resolution alpha is forced to zero on the same connected region. The browser independently derives the source RGB hash, statistics and exact 0/1 flood-mask hash, verifies them against the service, and checks the decoded alpha on every flood pixel. Decoder disagreements, unstable backgrounds and excessive changes fail without a replacement model or automatic retry. A passing numeric gate still requires inspection of hair, skin, clothing, holes and continuity before author adoption.

## Run

From the repository root after setup:

```sh
bash scripts/avg-local-foreground/start.sh
```

The server uses `127.0.0.1:5278`. By default it accepts `localhost`/`127.0.0.1` on StoryForge's local ports 5196 and 1111. To use another local development port, explicitly add its loopback origin; the start script forwards these options to the service:

```sh
bash scripts/avg-local-foreground/start.sh --origin http://127.0.0.1:5206
```

Repeat `--origin` for each additional origin. Only canonical `http://localhost:PORT` and `http://127.0.0.1:PORT` origins are accepted; remote hosts, HTTPS origins, paths and credentials are rejected. Set `AVG_SAM2_DEVICE=cpu` to select CPU explicitly; the default is MPS when available, otherwise CPU. On MPS, PyTorch's documented CPU fallback is enabled for unsupported operators and the receipt reports `mps+cpu-fallback`. A failed device or model load is reported and does not silently switch models.

`GET /v1/capabilities` reports the frozen V4 identity; `/v2/capabilities` additionally pins the V5 prompt strategy and gate; `/v3/capabilities` pins the V6 background rule and matting method. The matching `POST /v1/segment`, `/v2/segment` and `/v3/segment` consume the exact image bytes plus their hash, MIME type, dimensions and a one-use operation ID, then return an RGBA PNG candidate with model, code, checkpoint, source, prompt, alpha-plane, pixel and encoded-output hashes in response headers. V5/V6 record all six candidate observations and their deterministic selection. V6 adds `X-SF-Neutral-Background`. A V5/V6 plausibility rejection returns HTTP 422. Repeated operation IDs are rejected across all versions; concurrent inference is rejected instead of queued or repeated.

Run the protocol tests without loading model weights:

```sh
python3.12 -m unittest discover -s scripts/avg-local-foreground -p 'test_server.py'
```

No visual or commercial-quality claim follows from protocol tests. Evaluate accepted artwork in the AVG preview and review the original and candidate together.
