"""Local provider protocol; no model loading, download or Work authority."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import tempfile

from engine import PROFILE_ID, parse_request
from runtime_guard import CODE_REVISION, MODEL_REPOSITORY, MODEL_REVISION, fingerprint, sha256, unique_fields

MAX_BODY = 8192
MAX_AUDIO = 32 * 1024**2
MAX_JOBS = 256
ADAPTER_ID = "storyforge.avg.local-music.v1"
MODEL_ID = f"{MODEL_REPOSITORY}@{MODEL_REVISION}"


def atomic_json(path, value):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".pending-", delete=False) as target:
        pending = Path(target.name)
        os.fchmod(target.fileno(), 0o600)
        json.dump(value, target, ensure_ascii=False, sort_keys=True)
        target.write("\n")
        target.flush()
        os.fsync(target.fileno())
    pending.replace(path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def bridge_sources():
    root = Path(__file__).resolve().parent
    names = ("local_protocol.py", "server.py", "production_job.py", "licensed_library.py", "library-source.json", "publisher-library-source.json", "engine.py", "offline_handler.py",
             "runtime_guard.py", "haar_correction.py", "model-source.json", "requirements-macos-arm64.lock")
    result = {name: sha256(root / name) for name in names}
    result["avg-local-audio/pinned_model_install.py"] = sha256(root.parent / "avg-local-audio/pinned_model_install.py")
    return result


def capabilities():
    return {"schema": "storyforge.avg.local-music-capability", "version": 1, "adapterId": ADAPTER_ID,
        "model": MODEL_ID, "runtimeCodeRevision": CODE_REVISION, "profile": PROFILE_ID,
        "bridgeHash": fingerprint(bridge_sources()), "executionLocation": "loopback-local", "device": "cpu",
        "minimumSeconds": 10, "maximumSeconds": 30, "sampleRateHz": 48000, "channels": 2, "pcmBits": 16,
        "maximumModelCalls": 1, "automaticRetries": 0, "maximumDeadlineSeconds": 900,
        "supplierCostUsd": 0, "chargeScope": "local inference; device, power and labor excluded",
        "modelLoadObservation": "not-asserted-by-capability", "hearing": "unobserved"}


def journal_identity(root, create=False):
    """V2 identity is durable and never recreated over existing records.

    Old/missing-identity journals remain readable, never dispatchable. A fresh
    directory has a different identity, so a frozen client binding refuses it.
    """
    path = root / "journal.json"
    if not path.exists():
        if not create or any(root.iterdir()):
            return None
        value = {"schema": "storyforge.avg.local-music-journal", "version": 2, "journalId": secrets.token_hex(32)}
        try:
            with path.open("x", encoding="utf-8") as target:
                os.fchmod(target.fileno(), 0o600)
                json.dump(value, target, sort_keys=True); target.write("\n"); target.flush(); os.fsync(target.fileno())
            directory = os.open(root, os.O_RDONLY)
            try: os.fsync(directory)
            finally: os.close(directory)
        except FileExistsError:
            pass
    value = read_json(path)
    if (set(value) != {"schema", "version", "journalId"} or value["schema"] != "storyforge.avg.local-music-journal"
            or value["version"] != 2 or not isinstance(value["journalId"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["journalId"])):
        raise ValueError("Original V2 journal identity missing or invalid; never reset it")
    return value["journalId"]


def parse_body(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BODY:
        raise ValueError("Bounded UTF8 JSON required")
    return parse_request(json.loads(raw.decode("utf-8"), object_pairs_hook=unique_fields))


def read_request(root):
    path = root / "request.json"
    if path.is_symlink() or not path.is_file() or not 1 <= path.stat().st_size <= MAX_BODY:
        raise ValueError("Bounded ordinary original request required")
    return parse_body(path.read_bytes())


def request_key(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}", value):
        raise ValueError("Exact bounded request identity required")
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 512 * 1024:
        raise ValueError("Bounded ordinary receipt required")
    value = json.loads(path.read_text(), object_pairs_hook=unique_fields)
    if not isinstance(value, dict):
        raise ValueError("Receipt must be an object")
    return value
