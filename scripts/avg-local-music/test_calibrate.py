"""Deadline/overwrite guards using a controlled subprocess, never a model."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

import calibrate
import calibration_worker


class CalibrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.request = self.root / "input.json"
        self.request.write_text(json.dumps({"caption": "Original quiet piano", "durationSeconds": 12,
            "seed": 103, "bpm": 68, "keyscale": "A Minor"}))
        self.args = SimpleNamespace(request=self.request, output=self.root / "evaluation",
            source=self.root / "source", model=self.root / "model", device="cpu", timeout_seconds=900)

    def test_bad_request_deadline_low_disk_and_existing_output_never_launch(self):
        with patch.object(calibrate.subprocess, "Popen") as start:
            self.args.device = "mps"
            with self.assertRaisesRegex(ValueError, "CPU"):
                calibrate.run(self.args)
            self.args.device = "cpu"
            self.args.timeout_seconds = 901
            with self.assertRaises(ValueError):
                calibrate.run(self.args)
            self.args.timeout_seconds = 900
            self.request.write_text(self.request.read_text()[:-1] + ',"lyrics":"not permitted"}')
            with self.assertRaises(ValueError):
                calibrate.run(self.args)
            self.request.write_text('{"caption":"Original quiet piano","durationSeconds":12,"seed":103,"bpm":68,"keyscale":"A Minor"}')
            with patch.object(calibrate.shutil, "disk_usage", return_value=SimpleNamespace(free=1)):
                with self.assertRaises(ValueError):
                    calibrate.run(self.args)
            self.args.output.mkdir()
            original = self.args.output / "original.wav"
            original.write_bytes(b"must remain")
            with self.assertRaises(ValueError):
                calibrate.run(self.args)
            self.assertEqual(original.read_bytes(), b"must remain")
            start.assert_not_called()

    def test_timeout_preserves_unknown_without_second_launch(self):
        class WaitingWorker:
            pid = 123456789
            def __init__(self):
                self.dead = False
            def wait(self, timeout):
                if self.dead:
                    return -15
                raise subprocess.TimeoutExpired("controlled worker", timeout)
            def poll(self):
                return -15 if self.dead else None
        worker = WaitingWorker()
        def stopped(_pid, _signal):
            worker.dead = True
        with patch.object(calibrate.subprocess, "Popen", return_value=worker) as start, patch.object(calibrate.os, "killpg", side_effect=stopped) as stop:
            self.assertEqual(calibrate.run(self.args), 124)
            start.assert_called_once()
            stop.assert_called_once()
        result = json.loads((self.args.output / "evaluation.json").read_text())
        self.assertEqual(result["status"], "result-unknown-preserved")
        self.assertFalse(result["authorAdopted"])
        self.assertTrue((self.args.output / "runtime.log").exists())
        self.assertEqual(json.loads((self.args.output / "request.json").read_text()), json.loads(self.request.read_text()))

    def completed_worker(self, command, **_):
        output = Path(command[command.index("--output") + 1])
        data = io.BytesIO()
        with wave.open(data, "wb") as writer:
            writer.setnchannels(2)
            writer.setsampwidth(2)
            writer.setframerate(48000)
            writer.writeframes(b"\0" * (12 * 48000 * 2 * 2))
        body = data.getvalue()
        (output / "clip.wav").write_bytes(body)
        import numpy as np
        np.save(output / "raw-float32.npy", np.zeros((2, 12 * 48000), dtype=np.float32), allow_pickle=False)
        request = json.loads(self.request.read_text())
        (output / "worker-receipt.json").write_text(json.dumps({"phase": "completed", "modelCalls": 1, "request": request,
            "evidence": {"requestHash": calibrate.fingerprint(request), "modelRevision": calibrate.MODEL_REVISION,
                         "runtimeCodeRevision": calibrate.CODE_REVISION},
            "audio": {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)},
            "floatAudio": {"sha256": calibrate.sha256(output / "raw-float32.npy")}}))
        return SimpleNamespace(pid=123456789, wait=lambda timeout: 0, poll=lambda: 0)

    def test_success_reads_actual_wav_and_preserves_unreviewed_status(self):
        with patch.object(calibrate.subprocess, "Popen", side_effect=self.completed_worker) as process:
            self.assertEqual(calibrate.run(self.args), 0)
            process.assert_called_once()
        result = json.loads((self.args.output / "evaluation.json").read_text())
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["wavDurationSeconds"], 12)
        self.assertEqual(result["hearing"], "unobserved")
        self.assertEqual(result["rightsReview"], "unreviewed")
        self.assertFalse(result["authorAdopted"])

    def test_corrupted_wav_float_request_revision_or_count_never_succeed_or_resend(self):
        for kind in ("wav", "float", "request", "revision", "count"):
            with self.subTest(kind=kind):
                self.args.output = self.root / ("bad-" + kind)
                def start(command, **kwargs):
                    process = self.completed_worker(command, **kwargs)
                    output = self.args.output
                    if kind in ("wav", "float"):
                        path = output / ("clip.wav" if kind == "wav" else "raw-float32.npy")
                        path.write_bytes(path.read_bytes()[:-1] + b"x")
                    else:
                        path = output / "worker-receipt.json"
                        value = json.loads(path.read_text())
                        if kind == "request":
                            value["request"]["seed"] += 1
                        elif kind == "revision":
                            value["evidence"]["runtimeCodeRevision"] = "f" * 40
                        else:
                            value["modelCalls"] = 2
                        path.write_text(json.dumps(value))
                    return process
                with patch.object(calibrate.subprocess, "Popen", side_effect=start) as process:
                    with self.assertRaises(ValueError):
                        calibrate.run(self.args)
                    process.assert_called_once()
                result = json.loads((self.args.output / "evaluation.json").read_text())
                self.assertEqual(result["status"], "failed")
                self.assertFalse(result["authorAdopted"])
                self.assertTrue((self.args.output / "raw-float32.npy").exists())

    def test_nonterminal_worker_exit_preserves_unknown_and_original_receipt(self):
        def start(command, **_):
            output = Path(command[command.index("--output") + 1])
            (output / "worker-receipt.json").write_text('{"phase":"inference-started","modelCalls":null}')
            return SimpleNamespace(pid=123456789, wait=lambda timeout: -9, poll=lambda: -9)
        with patch.object(calibrate.subprocess, "Popen", side_effect=start) as process:
            self.assertEqual(calibrate.run(self.args), -9)
            process.assert_called_once()
        result = json.loads((self.args.output / "evaluation.json").read_text())
        self.assertEqual(result["status"], "result-unknown-preserved")
        self.assertEqual(result["worker"]["phase"], "inference-started")
        self.assertTrue((self.args.output / "worker-receipt.json").exists())

    def test_lost_worker_receipt_preserves_unknown_and_never_resends(self):
        worker = SimpleNamespace(pid=123456789, wait=lambda timeout: -9, poll=lambda: -9)
        with patch.object(calibrate.subprocess, "Popen", return_value=worker) as process:
            with self.assertRaises(FileNotFoundError):
                calibrate.run(self.args)
            process.assert_called_once()
        result = json.loads((self.args.output / "evaluation.json").read_text())
        self.assertEqual(result["status"], "result-unknown-preserved")
        self.assertFalse(result["authorAdopted"])
        self.assertTrue((self.args.output / "runtime.log").exists())

    def test_nonobject_worker_receipt_preserves_unknown_instead_of_remaining_running(self):
        def start(command, **_):
            output = Path(command[command.index("--output") + 1])
            (output / "worker-receipt.json").write_text('[]')
            return SimpleNamespace(pid=123456789, wait=lambda timeout: -9, poll=lambda: -9)
        with patch.object(calibrate.subprocess, "Popen", side_effect=start) as process:
            with self.assertRaisesRegex(ValueError, "object"):
                calibrate.run(self.args)
            process.assert_called_once()
        result = json.loads((self.args.output / "evaluation.json").read_text())
        self.assertEqual(result["status"], "result-unknown-preserved")

    def test_worker_marks_inflight_count_unknown_and_only_terminal_count_exact(self):
        self.args.output.mkdir()
        owner = self
        class ControlledEngine:
            model_calls = 0
            last_samples = None
            def __init__(self, *_):
                pass
            def generate(self, _):
                record = json.loads((owner.args.output / "worker-receipt.json").read_text())
                owner.assertEqual(record["phase"], "inference-started")
                owner.assertIsNone(record["modelCalls"])
                self.model_calls += 1
                raise RuntimeError("Controlled failure; no model executed")
        with patch.object(calibration_worker, "InstrumentalEngine", ControlledEngine), patch.object(calibration_worker, "forbid_network") as offline:
            with self.assertRaisesRegex(RuntimeError, "Controlled failure"):
                calibration_worker.evaluate(self.args)
            offline.assert_called_once()
        result = json.loads((self.args.output / "worker-receipt.json").read_text())
        self.assertEqual(result["phase"], "failed")
        self.assertEqual(result["modelCalls"], 1)
        self.assertFalse(result["authorAdopted"])


if __name__ == "__main__":
    unittest.main()
