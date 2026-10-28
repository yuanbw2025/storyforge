"""Finite installation of a pinned model; no inference, Work or credentials."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


RESERVE_BYTES = 8 * 1024**3
LOCK_NAME = "storyforge-model-lock.json"


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate model metadata field: " + key)
        result[key] = value
    return result


def digest(path, metadata):
    if "sha256" in metadata:
        with path.open("rb") as source:
            return hashlib.file_digest(source, "sha256").hexdigest() == metadata["sha256"]
    raw = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == metadata["gitBlob"]


def read_manifest(path):
    manifest = json.loads(Path(path).read_text(), object_pairs_hook=unique_fields)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("repository"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}", manifest["repository"]):
        raise ValueError("A specific official repository is required")
    if not isinstance(manifest.get("revision"), str) or not re.fullmatch(r"[a-f0-9]{40}", manifest["revision"]):
        raise ValueError("A complete immutable revision is required")
    files = manifest.get("files")
    if not isinstance(files, dict) or not 1 <= len(files) <= 256:
        raise ValueError("A bounded pinned file list is required")
    for name, metadata in files.items():
        if (not isinstance(name, str) or "\\" in name or any(part in ("", ".", "..") for part in name.split("/"))
                or name in (LOCK_NAME, ".storyforge-model-install.lock") or name.endswith((".part", ".tmp"))):
            raise ValueError("Unsafe or reserved model path")
        if (not isinstance(metadata, dict) or type(metadata.get("size")) is not int or not 0 < metadata["size"] <= 16 * 1024**3):
            raise ValueError("Invalid pinned file size")
        algorithm, length = ("sha256", 64) if "sha256" in metadata else ("gitBlob", 40)
        if not isinstance(metadata.get(algorithm), str) or not re.fullmatch(r"[a-f0-9]{" + str(length) + "}", metadata[algorithm]):
            raise ValueError("A pinned content hash is required")
        if any(name.startswith(other + "/") for other in files if other != name):
            raise ValueError("A model file cannot also be a parent directory")
    if sum(metadata["size"] for metadata in files.values()) > 32 * 1024**3:
        raise ValueError("Pinned snapshot exceeds installation limit")
    return manifest


def checked_path(root, name):
    current = root
    for part in name.split("/"):
        current = current / part
        if current.is_symlink():
            raise RuntimeError("Model paths cannot traverse symbolic links: " + name)
    return current


@contextmanager
def installation_lease(root):
    path = checked_path(root, ".storyforge-model-install.lock")
    with path.open("a+b") as lease:
        if os.name == "nt":
            import msvcrt
            lease.seek(0, 2)
            if lease.tell() == 0:
                lease.write(b"\0")
                lease.flush()
            lease.seek(0)
            msvcrt.locking(lease.fileno(), msvcrt.LK_NBLCK, 1)
            try:
                yield
            finally:
                lease.seek(0)
                msvcrt.locking(lease.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                yield
            finally:
                fcntl.flock(lease.fileno(), fcntl.LOCK_UN)


def install_from_manifest(destination, manifest_path, weight_host="huggingface"):
    if weight_host not in ("huggingface", "modelscope"):
        raise ValueError("Unsupported weight host")
    manifest = read_manifest(manifest_path)
    root = Path(destination).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    with installation_lease(root):
        lock_path = checked_path(root, LOCK_NAME)
        if lock_path.exists():
            previous = json.loads(lock_path.read_text(), object_pairs_hook=unique_fields)
            if not isinstance(previous, dict):
                raise ValueError("Existing model seal must be an object")
            if any(previous.get(key) != manifest[key] for key in ("repository", "revision")):
                raise RuntimeError("Existing model identity differs; preserve it and choose another directory")
        remaining = 0
        for name, metadata in manifest["files"].items():
            target, partial = checked_path(root, name), checked_path(root, name + ".part")
            if target.exists():
                if target.stat().st_size != metadata["size"] or not digest(target, metadata):
                    raise RuntimeError("Existing model file mismatches; preserve and inspect: " + name)
            else:
                size = partial.stat().st_size if partial.exists() else 0
                if size > metadata["size"] or size == metadata["size"] and not digest(partial, metadata):
                    raise RuntimeError("Completed/oversized partial mismatches; preserve and inspect: " + name)
                remaining += metadata["size"] - size
        if shutil.disk_usage(root).free < remaining + RESERVE_BYTES:
            raise RuntimeError("Not enough free space for the pinned model plus 8 GiB reserve")

        def download(item):
            name, metadata = item
            target = checked_path(root, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = checked_path(root, name + ".part")
            if target.exists():
                return
            if partial.exists() and partial.stat().st_size == metadata["size"] and digest(partial, metadata):
                partial.rename(target)
                return
            url = f"https://huggingface.co/{manifest['repository']}/resolve/{manifest['revision']}/{name}"
            if weight_host == "modelscope" and "sha256" in metadata:
                # A mirror is a byte source, never authority for model identity.
                url = f"https://modelscope.cn/models/{manifest['repository']}/resolve/master/{name}"
            subprocess.run(["curl", "-fLSs", "--max-time", "1800", "--continue-at", "-", url, "-o", str(partial)], check=True)
            if partial.stat().st_size != metadata["size"] or not digest(partial, metadata):
                raise RuntimeError("Downloaded bytes mismatch: " + name)
            partial.rename(target)
            print(json.dumps({"verified": name, "bytes": metadata["size"]}), flush=True)

        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(download, manifest["files"].items()))
        files = {}
        for name, metadata in manifest["files"].items():
            target = checked_path(root, name)
            if target.stat().st_size != metadata["size"] or not digest(target, metadata):
                raise RuntimeError("Model changed before installation seal: " + name)
            with target.open("rb") as source:
                files[name] = {"size": metadata["size"], "sha256": hashlib.file_digest(source, "sha256").hexdigest()}
        # Preserve the prior complete seal on interruption. Failed pending
        # seals remain available for inspection instead of overwriting it.
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=root,
                prefix=".storyforge-model-lock-", suffix=".tmp", delete=False) as pending:
            json.dump({"repository": manifest["repository"], "revision": manifest["revision"], "files": files}, pending, indent=2)
            pending.write("\n")
            pending.flush()
            os.fsync(pending.fileno())
        os.replace(pending.name, lock_path)
