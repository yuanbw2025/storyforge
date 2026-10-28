"""Real local Git/file integrity and bounded request tests; no model loading."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from engine import InstrumentalEngine, parse_request
import runtime_guard as guard


class RuntimeGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        (self.source / "acestep").mkdir(parents=True)
        for name in ("acestep/handler.py", "acestep/inference.py", "LICENSE", "pyproject.toml"):
            (self.source / name).write_text("fixture-original\n")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "Fixture source")
        self.revision = self.git("rev-parse", "HEAD").strip()
        self.model = self.root / "model"
        self.model.mkdir()
        self.body = b"original-pinned-public-fixture"
        self.target = self.model / "weights.bin"
        self.target.write_bytes(self.body)
        digest = hashlib.sha256(self.body).hexdigest()
        self.manifest = self.root / "manifest.json"
        self.manifest.write_text(json.dumps({"repository": guard.MODEL_REPOSITORY, "revision": guard.MODEL_REVISION,
            "files": {"weights.bin": {"size": len(self.body), "sha256": digest}}}))
        self.seal = self.model / "storyforge-model-lock.json"
        self.seal.write_text(json.dumps({"repository": guard.MODEL_REPOSITORY, "revision": guard.MODEL_REVISION,
            "files": {"weights.bin": {"size": len(self.body), "sha256": digest}}}))

    def git(self, *arguments):
        return subprocess.check_output(["git", "-C", str(self.source), *arguments], stderr=subprocess.DEVNULL, text=True)

    def test_original_code_and_model_proofs_are_stable_and_read_only(self):
        before = {p: p.read_bytes() for p in [self.target, self.seal, self.manifest]}
        source = guard.verify_source(self.source, self.revision)
        self.assertEqual(source, guard.verify_source(self.source, self.revision))
        with patch.object(guard, "MANIFEST", self.manifest):
            self.assertEqual(guard.verify_model(self.model), guard.verify_model(self.model))
        self.assertTrue(all(p.read_bytes() == value for p, value in before.items()))

    def test_wrong_revision_modified_code_and_hidden_index_changes_are_refused(self):
        with self.assertRaisesRegex(ValueError, "revision"):
            guard.verify_source(self.source, "f" * 40)
        self.git("update-index", "--assume-unchanged", "acestep/handler.py")
        (self.source / "acestep/handler.py").write_text("changed-with-hidden-index\n")
        with self.assertRaisesRegex(ValueError, "bytes differ"):
            guard.verify_source(self.source, self.revision)

    def test_untracked_import_shadow_and_symbolic_source_are_refused(self):
        shadow = self.source / "torch.py"
        shadow.write_text("unreviewed-import\n")
        with self.assertRaisesRegex(ValueError, "shadow"):
            guard.verify_source(self.source, self.revision)
        shadow.unlink()
        original = self.source / "acestep/handler.py"
        original.unlink()
        original.symlink_to(self.target)
        with self.assertRaises(ValueError):
            guard.verify_source(self.source, self.revision)

    def test_bad_bytes_identity_members_and_symbolic_models_are_refused(self):
        with patch.object(guard, "MANIFEST", self.manifest):
            self.target.write_bytes(b"x" * len(self.body))
            with self.assertRaisesRegex(ValueError, "bytes"):
                guard.verify_model(self.model)
            self.target.write_bytes(self.body)
            original = self.seal.read_bytes()
            for key, value in (("revision", "f" * 40), ("files", {})):
                changed = json.loads(original)
                changed[key] = value
                self.seal.write_text(json.dumps(changed))
                with self.assertRaises(ValueError):
                    guard.verify_model(self.model)
            self.seal.write_bytes(original)
            self.target.unlink()
            outside = self.root / "outside"
            outside.write_bytes(self.body)
            self.target.symlink_to(outside)
            with self.assertRaisesRegex(RuntimeError, "symbolic"):
                guard.verify_model(self.model)

    def test_package_directory_and_cached_bytecode_cannot_shadow_reviewed_source(self):
        package = self.source / "torch"
        package.mkdir()
        module = package / "__init__.py"
        module.write_text("unreviewed package\n")
        with self.assertRaisesRegex(ValueError, "shadow"):
            guard.verify_source(self.source, self.revision)
        module.unlink()
        package.rmdir()
        cache = self.source / "acestep/__pycache__"
        cache.mkdir()
        (cache / "handler.cpython-312.pyc").write_bytes(b"unreviewed bytecode")
        with self.assertRaisesRegex(ValueError, "bytecode"):
            guard.verify_source(self.source, self.revision)

    def test_explicit_bounded_request_rejects_reference_lyrics_unknowns_and_bad_scalars(self):
        request = {"caption": "Quiet original instrumental piano", "durationSeconds": 12, "seed": 103,
                   "bpm": 68, "keyscale": "A Minor"}
        self.assertEqual(parse_request(request), request)
        for changes in ({"reference_audio": "file.wav"}, {"lyrics": "unrequested"}, {"workId": 1},
                        {"seed": True}, {"durationSeconds": 600}, {"bpm": 0}, {"keyscale": "anything"},
                        {"caption": "\0bad"}, {"caption": "😀" * 257}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                parse_request({**request, **changes})

    def test_offline_child_refuses_network_before_any_connection(self):
        command = """from runtime_guard import forbid_network
import socket
forbid_network()
try:
    socket.socket().connect(('127.0.0.1', 9))
except RuntimeError as error:
    assert 'Network access is disabled' in str(error)
else:
    raise AssertionError('Offline evaluation connected')
print('offline-network-refused')
"""
        result = subprocess.run([sys.executable, "-c", command], cwd=Path(guard.__file__).parent,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "offline-network-refused")

    def test_consumed_evaluation_cannot_restart_after_failure(self):
        with self.assertRaisesRegex(ValueError, "CPU"):
            InstrumentalEngine(self.model, self.source, "mps")
        engine = object.__new__(InstrumentalEngine)
        engine.used = True
        with self.assertRaisesRegex(ValueError, "already used"):
            engine.generate({"caption": "Quiet original instrumental piano", "durationSeconds": 12,
                             "seed": 103, "bpm": 68, "keyscale": "A Minor"})


if __name__ == "__main__":
    unittest.main()
