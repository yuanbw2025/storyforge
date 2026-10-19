"""Offline code/model identity checks for an explicitly supplied evaluation.

These checks do not install, download, infer, read Work data or grant adoption.
The source checkout stays untouched, including the model-side Python files.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "avg-local-audio"))
from pinned_model_install import checked_path, read_manifest, unique_fields

CODE_REVISION = "ca1e85fe9430179831e6bc6be790c332190a3866"
MODEL_REPOSITORY = "ACE-Step/Ace-Step1.5"
MODEL_REVISION = "19671f406d603126926c1b7e2adc169acbcade22"
MANIFEST = Path(__file__).with_name("model-source.json")


def forbid_network():
    """Install only in the dedicated child, before importing the runtime."""
    def reject(event, _arguments):
        if event in ("socket.connect", "socket.getaddrinfo", "socket.sendto"):
            raise RuntimeError("Network access is disabled for this offline evaluation")
    sys.addaudithook(reject)


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def fingerprint(value):
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def verify_source(directory, expected_revision=CODE_REVISION):
    root = Path(directory).resolve(strict=True)
    env = dict(os.environ, GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0")

    def git(*args):
        return subprocess.check_output(["git", "-C", str(root), *args], env=env, timeout=30).decode("utf-8")

    if git("rev-parse", "HEAD").strip() != expected_revision:
        raise ValueError("Exact reviewed upstream code revision required")
    if git("diff", "--name-only", "HEAD", "--", "acestep", "LICENSE", "pyproject.toml").strip():
        raise ValueError("Reviewed upstream source has changed")
    entries = git("ls-tree", "-r", "-z", "HEAD", "--", "acestep", "LICENSE", "pyproject.toml").strip("\0").split("\0")
    if not 1 <= len(entries) <= 1000:
        raise ValueError("Unexpected upstream source inventory")
    hashes, total = {}, 0
    for entry in entries:
        metadata, name = entry.split("\t", 1)
        mode, kind, expected = metadata.split()
        if mode not in ("100644", "100755") or kind != "blob":
            raise ValueError("Only ordinary reviewed source files are supported")
        path = checked_path(root, name)
        if not path.is_file():
            raise ValueError("Reviewed source file missing: " + name)
        size = path.stat().st_size
        total += size
        if total > 20 * 1024**2:
            raise ValueError("Upstream source exceeds the declared size bound")
        raw = path.read_bytes()
        if hashlib.sha1(b"blob " + str(size).encode() + b"\0" + raw).hexdigest() != expected:
            raise ValueError("Reviewed source bytes differ: " + name)
        hashes[name] = hashlib.sha256(raw).hexdigest()
    import_suffixes = (".py", ".pyc", ".pyo", ".so", ".dylib")
    for path in root.iterdir():
        if path.name not in (".git", "acestep") and (path.is_dir() or path.is_symlink() or path.suffix in import_suffixes):
            raise ValueError("Unexpected root import may shadow a reviewed package")
    for path in (root / "acestep").rglob("*"):
        if path.is_symlink() or path.suffix in import_suffixes and path.relative_to(root).as_posix() not in hashes:
            raise ValueError("Unexpected source or bytecode may shadow a reviewed import")
    return {"revision": expected_revision, "files": hashes, "hash": fingerprint(hashes)}


def verify_model(directory):
    root = Path(directory).resolve(strict=True)
    manifest = read_manifest(MANIFEST)
    if manifest["repository"] != MODEL_REPOSITORY or manifest["revision"] != MODEL_REVISION:
        raise ValueError("Unexpected evaluation model identity")
    lock = json.loads(checked_path(root, "storyforge-model-lock.json").read_text(), object_pairs_hook=unique_fields)
    if not isinstance(lock, dict) or lock.get("repository") != MODEL_REPOSITORY or lock.get("revision") != MODEL_REVISION:
        raise ValueError("Installed model seal identity differs")
    files = lock.get("files")
    if not isinstance(files, dict) or set(files) != set(manifest["files"]):
        raise ValueError("Installed model seal has missing or unexpected files")
    hashes = {}
    for name, expected in manifest["files"].items():
        path = checked_path(root, name)
        if not path.is_file() or path.stat().st_size != expected["size"]:
            raise ValueError("Pinned model file missing or wrong size: " + name)
        digest = sha256(path)
        if files[name] != {"size": expected["size"], "sha256": digest} or expected.get("sha256", digest) != digest:
            raise ValueError("Pinned model bytes or seal differ: " + name)
        if "gitBlob" in expected:
            raw = path.read_bytes() if "sha256" not in expected else None
            if raw is not None and hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() != expected["gitBlob"]:
                raise ValueError("Pinned model configuration differs: " + name)
        hashes[name] = digest
    return {"repository": MODEL_REPOSITORY, "revision": MODEL_REVISION, "files": hashes, "hash": fingerprint(hashes)}
