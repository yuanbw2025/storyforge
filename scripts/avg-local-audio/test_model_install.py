"""Public-byte installation tests; no real downloads, weights or inference."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pinned_model_install as installer


class ModelInstallationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.destination = self.root / "model"
        self.manifest = self.root / "source.json"
        self.body = b"original-public-model-fixture"
        self.write_manifest()

    def write_manifest(self, **changes):
        self.value = {"repository": "Official/Fixture", "revision": "a" * 40,
                      "files": {"weights.bin": {"size": len(self.body), "sha256": hashlib.sha256(self.body).hexdigest()}}}
        self.value.update(changes)
        self.manifest.write_text(json.dumps(self.value))

    def install(self, host="huggingface"):
        installer.install_from_manifest(self.destination, self.manifest, host)

    def fetch(self, command, **options):
        self.assertTrue(options["check"])
        self.assertIn("--continue-at", command)
        self.assertNotIn("--retry", command)
        self.assertNotIn("Authorization", " ".join(command))
        target = Path(command[command.index("-o") + 1])
        target.write_bytes(self.body)

    def test_exact_file_and_identical_seal_are_reused_without_network(self):
        with patch.object(installer.subprocess, "run", side_effect=self.fetch) as network:
            self.install()
            self.assertEqual(network.call_count, 1)
            self.assertIn("/resolve/" + "a" * 40 + "/weights.bin", network.call_args.args[0][-3])
        lock = (self.destination / installer.LOCK_NAME).read_bytes()
        with patch.object(installer.subprocess, "run") as network:
            self.install()
            network.assert_not_called()
        self.assertEqual((self.destination / installer.LOCK_NAME).read_bytes(), lock)

    def test_corrupt_existing_bytes_are_preserved_before_any_network(self):
        self.destination.mkdir()
        target = self.destination / "weights.bin"
        target.write_bytes(b"x" * len(self.body))
        with patch.object(installer.subprocess, "run") as network:
            with self.assertRaisesRegex(RuntimeError, "Existing model file mismatches"):
                self.install()
            network.assert_not_called()
        self.assertEqual(target.read_bytes(), b"x" * len(self.body))

    def test_partial_is_resumed_once_and_a_complete_partial_needs_no_network(self):
        self.destination.mkdir()
        partial = self.destination / "weights.bin.part"
        partial.write_bytes(self.body[:4])
        with patch.object(installer.subprocess, "run", side_effect=self.fetch) as network:
            self.install()
            self.assertEqual(network.call_count, 1)
        (self.destination / "weights.bin").rename(partial)
        with patch.object(installer.subprocess, "run") as network:
            self.install()
            network.assert_not_called()
        self.assertEqual((self.destination / "weights.bin").read_bytes(), self.body)

    def test_corrupt_download_is_retained_and_never_sealed_or_retried(self):
        def corrupt(command, **_):
            Path(command[command.index("-o") + 1]).write_bytes(b"x" * len(self.body))
        with patch.object(installer.subprocess, "run", side_effect=corrupt) as network:
            with self.assertRaisesRegex(RuntimeError, "Downloaded bytes mismatch"):
                self.install()
            self.assertEqual(network.call_count, 1)
        self.assertTrue((self.destination / "weights.bin.part").exists())
        self.assertFalse((self.destination / "weights.bin").exists())
        self.assertFalse((self.destination / installer.LOCK_NAME).exists())
        with patch.object(installer.subprocess, "run") as network:
            with self.assertRaisesRegex(RuntimeError, "partial mismatches"):
                self.install()
            network.assert_not_called()

    def test_transport_failure_is_not_retried(self):
        with patch.object(installer.subprocess, "run", side_effect=subprocess.CalledProcessError(22, "curl")) as network:
            with self.assertRaises(subprocess.CalledProcessError):
                self.install()
            self.assertEqual(network.call_count, 1)
        self.assertFalse((self.destination / installer.LOCK_NAME).exists())

    def test_paths_revisions_and_bounded_sizes_are_validated_before_network(self):
        bad = ["../escape", "/absolute", "nested//empty", "./relative", r"nested\escape",
               installer.LOCK_NAME, ".storyforge-model-install.lock", "weights.part", "weights.tmp"]
        metadata = dict(self.value["files"]["weights.bin"])
        with patch.object(installer.subprocess, "run") as network:
            for name in bad:
                with self.subTest(name=name):
                    self.write_manifest(files={name: metadata})
                    with self.assertRaises(ValueError):
                        self.install()
            for revision in ["main", "b" * 39, "b" * 41, None]:
                self.write_manifest(revision=revision)
                with self.assertRaises(ValueError):
                    self.install()
            for size in [0, -1, True, 16 * 1024**3 + 1]:
                self.write_manifest(files={"weights.bin": {"size": size, "sha256": "f" * 64}})
                with self.assertRaises(ValueError):
                    self.install()
            self.write_manifest(files={"a": {"size": 1, "sha256": "f" * 64}, "a/b": {"size": 1, "sha256": "e" * 64}})
            with self.assertRaises(ValueError):
                self.install()
            network.assert_not_called()

    def test_existing_other_model_identity_and_low_disk_refuse_network(self):
        self.destination.mkdir()
        (self.destination / installer.LOCK_NAME).write_text(json.dumps({"repository": "Other/Model", "revision": "a" * 40}))
        with patch.object(installer.subprocess, "run") as network:
            with self.assertRaisesRegex(RuntimeError, "identity differs"):
                self.install()
            network.assert_not_called()
        (self.destination / installer.LOCK_NAME).unlink()
        with patch.object(installer.shutil, "disk_usage", return_value=SimpleNamespace(free=installer.RESERVE_BYTES)), patch.object(installer.subprocess, "run") as network:
            with self.assertRaisesRegex(RuntimeError, "free space"):
                self.install()
            network.assert_not_called()

    def test_nested_and_partial_symbolic_links_never_write_outside_destination(self):
        self.destination.mkdir()
        outside = self.root / "outside"
        outside.mkdir()
        with patch.object(installer.subprocess, "run") as network:
            (self.destination / "weights.bin.part").symlink_to(outside / "unwritten")
            with self.assertRaisesRegex(RuntimeError, "symbolic"):
                self.install()
            (self.destination / "weights.bin.part").unlink()
            (self.destination / "nested").symlink_to(outside, target_is_directory=True)
            self.write_manifest(files={"nested/weights.bin": {"size": len(self.body), "sha256": hashlib.sha256(self.body).hexdigest()}})
            with self.assertRaisesRegex(RuntimeError, "symbolic"):
                self.install()
            network.assert_not_called()
        self.assertEqual(list(outside.iterdir()), [])

    def test_same_directory_cannot_have_two_active_installers(self):
        self.destination.mkdir()
        with installer.installation_lease(self.destination), patch.object(installer.subprocess, "run") as network:
            with self.assertRaises(OSError):
                self.install()
            network.assert_not_called()

    def test_ambiguous_manifest_fields_are_rejected_before_creating_destination(self):
        for old, new in [(f'"revision": "{"a" * 40}"', f'"revision": "{"b" * 40}", "revision": "{"a" * 40}"'),
                         ('"size": ' + str(len(self.body)), '"size": 1, "size": ' + str(len(self.body)))]:
            with self.subTest(field=old), patch.object(installer.subprocess, "run") as network:
                self.write_manifest()
                self.manifest.write_text(self.manifest.read_text().replace(old, new))
                with self.assertRaisesRegex(ValueError, "Duplicate"):
                    self.install()
                network.assert_not_called()
                self.assertFalse(self.destination.exists())

    def test_repository_path_segments_cannot_be_relative_or_url_components(self):
        with patch.object(installer.subprocess, "run") as network:
            for repository in ("../..", "./model", "official/..", "official/model?redirect", "https://host/model", "a" * 97 + "/model"):
                with self.subTest(repository=repository):
                    self.write_manifest(repository=repository)
                    with self.assertRaises(ValueError):
                        self.install()
            network.assert_not_called()
        self.assertFalse(self.destination.exists())

    def test_interrupted_seal_preserves_previous_complete_lock_and_pending_evidence(self):
        with patch.object(installer.subprocess, "run", side_effect=self.fetch):
            self.install()
        lock = self.destination / installer.LOCK_NAME
        before = lock.read_bytes()
        with patch.object(installer.os, "replace", side_effect=OSError("interrupted seal")), patch.object(installer.subprocess, "run") as network:
            with self.assertRaisesRegex(OSError, "interrupted seal"):
                self.install()
            network.assert_not_called()
        self.assertEqual(lock.read_bytes(), before)
        pending = list(self.destination.glob(".storyforge-model-lock-*.tmp"))
        self.assertEqual(len(pending), 1)
        self.assertEqual(json.loads(pending[0].read_text()), json.loads(before))

    def test_ambiguous_existing_seal_is_preserved_without_network(self):
        self.destination.mkdir()
        lock = self.destination / installer.LOCK_NAME
        before = '{"repository":"Other/Model","repository":"Official/Fixture","revision":"' + "a" * 40 + '"}'
        lock.write_text(before)
        with patch.object(installer.subprocess, "run") as network:
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                self.install()
            network.assert_not_called()
        self.assertEqual(lock.read_text(), before)

    def test_small_git_blobs_and_verified_mirror_use_the_same_content_authority(self):
        self.write_manifest(files={"weights.bin": {"size": len(self.body), "gitBlob": hashlib.sha1(
            b"blob " + str(len(self.body)).encode() + b"\0" + self.body).hexdigest()}})
        with patch.object(installer.subprocess, "run", side_effect=self.fetch) as network:
            self.install("modelscope")
            self.assertTrue(network.call_args.args[0][-3].startswith("https://huggingface.co/"))
        (self.destination / "weights.bin").unlink()
        self.write_manifest()
        with patch.object(installer.subprocess, "run", side_effect=self.fetch) as network:
            self.install("modelscope")
            self.assertTrue(network.call_args.args[0][-3].startswith("https://modelscope.cn/"))

    def test_voice_and_music_wrappers_use_their_own_pinned_manifest(self):
        scripts = Path(__file__).resolve().parent.parent
        for folder in ("avg-local-voice", "avg-local-music"):
            with self.subTest(folder=folder):
                path = scripts / folder / "download_model.py"
                spec = importlib.util.spec_from_file_location(folder, path)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                manifest = installer.read_manifest(path.with_name("model-source.json"))
                expected = "Qwen/" if folder.endswith("voice") else "ACE-Step/"
                self.assertTrue(manifest["repository"].startswith(expected))
                with patch.object(module, "install_from_manifest") as install:
                    module.install(self.destination)
                    self.assertEqual(install.call_args.args, (self.destination, path.with_name("model-source.json"), "huggingface"))


if __name__ == "__main__":
    unittest.main()
