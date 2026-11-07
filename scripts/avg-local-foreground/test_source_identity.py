"""Offline public engine tests using disposable Git trees and synthetic modules."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ACTOR = r"""
import http.client
import importlib
import json
from pathlib import Path
import sys
import threading
import types

scripts, root, model_dir, search_root, revision, digest, expected = sys.argv[1:]
ndimage = types.ModuleType("scipy.ndimage")
ndimage.binary_dilation = ndimage.binary_erosion = None
sys.modules["scipy.ndimage"] = ndimage
sys.path[:0] = [scripts, search_root]
from server import ForegroundHTTPServer, Sam2MattingEngine
import server
server.MODEL_REVISION = revision
server.WEIGHTS_SHA256 = digest
if expected == "preloaded":
    importlib.import_module("sam2.build_sam")
    Path("imports").unlink()

try:
    engine = Sam2MattingEngine(Path(model_dir), Path(root), "cpu")
except RuntimeError as error:
    assert expected != "success", str(error)
    assert {
        "dirty": "源码",
        "assumed": "源码",
        "config": "源码",
        "shadow": "源码",
        "bytecode": "源码",
        "foreign": "导入",
        "preloaded": "导入",
        "head": "commit",
        "weights": "SHA-256",
    }[expected] in str(error), str(error)
    assert not Path("imports").exists(), "Rejected after import side effects"
else:
    with ForegroundHTTPServer(("127.0.0.1", 0), engine) as service:
        worker = threading.Thread(target=service.serve_forever)
        worker.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", service.server_port, timeout=2)
            for version in (1, 2, 3):
                connection.request("GET", f"/v{version}/capabilities")
                reply = connection.getresponse()
                data = json.load(reply)
                assert reply.status == 200 and data["ready"] and data["version"] == version, data
                assert data["codeRevision"] == revision and data["checkpointSha256"] == digest, data
            connection.close()
        finally:
            service.shutdown()
            worker.join()
    assert expected == "success", f"Unexpected READY with {expected}"
    for name in ("sam2", "sam2.build_sam", "sam2.sam2_image_predictor"):
        assert Path(sys.modules[name].__file__).resolve().is_relative_to(Path(root))
    assert Path("imports").read_text() == "torch\npackage\nbuild\npredictor\n"
    assert engine.predictor.model == "reviewed config"
    late = importlib.import_module("sam2.modeling.late")
    assert Path(late.__file__) == Path(root) / "sam2/modeling/late.py"
    assert not list((Path(root) / "sam2").rglob("*.pyc"))
    tampered = Path(root) / "sam2/modeling/pending.py"
    tampered.write_text('raise AssertionError("unverified bytes executed")')
    try:
        importlib.import_module("sam2.modeling.pending")
    except RuntimeError as error:
        assert "源码字节" in str(error), str(error)
    else:
        raise AssertionError("late import did not recheck source bytes")
"""


class SourceIdentityTest(unittest.TestCase):
    def run_case(self, case):
        with tempfile.TemporaryDirectory() as scratch:
            base = Path(scratch)
            source = base / "source"
            model_dir = base / "models"
            dependencies = base / "dependencies"
            model_dir.mkdir()
            dependencies.mkdir()
            (source / "sam2" / "configs" / "sam2.1").mkdir(parents=True)
            checkpoint = model_dir / "sam2.1_hiera_tiny.pt"
            checkpoint.write_bytes(b"synthetic weights")
            digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
            def mark(name):
                return f'with open("imports", "a") as handle: handle.write({name + chr(10)!r})\n'

            (source / "sam2/__init__.py").write_text(mark("package"))
            builder = source / "sam2/build_sam.py"
            builder.write_text(mark("build") + """
from importlib.resources import files
def build_sam2(config, checkpoint, *, device, mode):
    return files("sam2").joinpath(config).read_text()
""")
            (source / "sam2/sam2_image_predictor.py").write_text(mark("predictor") + """
class SAM2ImagePredictor:
    def __init__(self, model): self.model = model
""")
            modeling = source / "sam2/modeling"
            modeling.mkdir()
            (modeling / "late.py").write_text("ORIGIN = 'reviewed namespace module'\n")
            (modeling / "pending.py").write_text("ORIGIN = 'reviewed lazy module'\n")
            config = source / "sam2/configs/sam2.1/sam2.1_hiera_t.yaml"
            config.write_text("reviewed config")
            (dependencies / "torch.py").write_text(mark("torch") + "def set_num_threads(n): pass\n")

            env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}
            def git(*args):
                return subprocess.check_output(["git", "-C", source, *args], env=env, stderr=subprocess.PIPE, text=True, timeout=10).strip()

            git("init", "-q")
            git("add", "sam2")
            git("-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "source")
            revision = git("rev-parse", "HEAD")
            search = source
            if case == "dirty":
                builder.write_text(builder.read_text() + "# altered at same HEAD\n")
            elif case == "assumed":
                git("update-index", "--assume-unchanged", "sam2/build_sam.py")
                builder.write_text(builder.read_text() + "# hidden index change\n")
                self.assertEqual(git("status", "--porcelain"), "")
            elif case == "config":
                config.write_text("modified config")
            elif case == "shadow":
                (source / "sam2/build_sam").mkdir()
                (source / "sam2/build_sam/__init__.py").write_text(builder.read_text())
            elif case == "bytecode":
                cache = source / "sam2/__pycache__"
                cache.mkdir()
                (cache / f"build_sam.{sys.implementation.cache_tag}.pyc").write_bytes(b"unreviewed bytecode")
            elif case in {"foreign", "preloaded"}:
                shutil.copytree(source / "sam2", dependencies / "sam2")
                search = dependencies
            elif case == "head":
                revision = "0" * 40
            elif case == "weights":
                checkpoint.write_bytes(b"wrong weight")
            # Keep normal third-party lookup available without adding unreviewed SAM to the positive case.
            actor = f"import sys; sys.path.append({str(dependencies)!r})\n" + ACTOR
            result = subprocess.run(
                [sys.executable, "-I", "-B", "-c", actor, str(Path(__file__).resolve().parent),
                 str(source.resolve()), str(model_dir), str(search), revision, digest, case],
                cwd=base, capture_output=True, text=True, env=env, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_reviewed_source_capabilities(self):
        self.run_case("success")

    def test_reject_before_import(self):
        for case in ("dirty", "assumed", "config", "shadow", "bytecode", "foreign", "preloaded", "head", "weights"):
            with self.subTest(case=case):
                self.run_case(case)


if __name__ == "__main__":
    unittest.main()
