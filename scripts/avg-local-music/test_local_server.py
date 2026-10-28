"""Provider protocol fixtures only: synthetic PCM, no model/Work/author proof."""
from contextlib import contextmanager
import fcntl
import http.client
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import wave
import zipfile
import hashlib
import signal

import numpy as np

from engine import PROFILE_ID
from local_protocol import MODEL_ID, atomic_json, capabilities, fingerprint, journal_identity, parse_body, read_json, request_key
from production_job import inspect_wav, validated_result
from runtime_guard import CODE_REVISION, MODEL_REPOSITORY, MODEL_REVISION, sha256
from server import MusicServer
from licensed_library import original_member

REQUEST = {"caption": "Original sparse piano, engineering protocol fixture.", "durationSeconds": 10, "seed": 103, "bpm": 68, "keyscale": "A Minor"}


def original_fixture(root):
    """Synthetic response fixture; it does not certify an actual neural call."""
    claim = read_json(root / "claim.json")
    samples = np.full((2, 48000 * REQUEST["durationSeconds"]), .05, dtype=np.float32)
    pcm = np.rint(samples.T * 32768).astype("<i2")
    with wave.open(str(root / "clip.wav"), "wb") as wav:
        wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(48000); wav.writeframes(pcm.tobytes())
    np.save(root / "raw-float32.npy", samples, allow_pickle=False)
    evidence = {"request": REQUEST, "requestHash": fingerprint(REQUEST), "modelCalls": 1,
        "modelRepository": MODEL_REPOSITORY, "modelRevision": MODEL_REVISION, "runtimeCodeRevision": CODE_REVISION,
        "profile": PROFILE_ID, "device": "cpu", "providerChargeUsd": 0, "waveletSteps": 8,
        "sourceHash": "1" * 64, "modelHash": "2" * 64, "waveletBackend": "fixture-not-real-inference",
        "inferenceSeconds": .1, "peakAmplitude": .05, "rmsAmplitude": .05}
    atomic_json(root / "worker.json", {"schema": "storyforge.avg.local-music-worker", "version": claim["version"], "journalId": claim["journalId"],
        "jobId": claim["jobId"], "phase": "completed", "modelCalls": 1, "requestHash": claim["requestHash"],
        "bridgeHash": claim["bridgeHash"], "audio": inspect_wav(root / "clip.wav", REQUEST),
        "floatSHA256": sha256(root / "raw-float32.npy"), "evidence": evidence})
    result = validated_result(root)
    atomic_json(root / "runner.json", {"status": "completed", "modelCalls": 1, "result": result})


@contextmanager
def serve(root):
    server = MusicServer(0, ["http://127.0.0.1:5196"], root, root, root, 30)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        yield server
    finally:
        server.shutdown(); thread.join(timeout=3); server.server_close()


def call(server, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse(); return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


class LocalMusicProtocolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.calls = []

    def tearDown(self):
        self.temp.cleanup()

    def fake_process(self, command, **kwargs):
        self.calls.append(command)
        job = Path(command[command.index("--job") + 1]); original_fixture(job)
        class Done:
            def wait(self, timeout): return 0
        return Done()

    def post(self, server, identity="request.one"):
        return call(server, "POST", "/v1/audio/music", json.dumps(REQUEST),
            {"Content-Type": "application/json", "x-storyforge-idempotency-key": identity, "Origin": "http://127.0.0.1:5196"})

    def test_capability_has_pins_no_loaded_model_or_hearing_claim(self):
        with serve(self.root) as server:
            status, _, body = call(server, "GET", "/v1/capabilities")
            self.assertEqual(status, 200); result = json.loads(body)
            self.assertEqual(result["model"], MODEL_ID); self.assertEqual(result["automaticRetries"], 0)
            self.assertEqual(result["modelLoadObservation"], "not-asserted-by-capability")
            self.assertEqual(result["hearing"], "unobserved")
            self.assertEqual(len(self.calls), 0)

    def test_journal_identity_survives_restart_and_changes_for_another_root(self):
        with serve(self.root) as server:
            first = json.loads(call(server, "GET", "/v1/capabilities")[2])
            self.assertEqual(first["version"], 2); self.assertEqual(len(first["journalId"]), 64)
        with serve(self.root) as server:
            self.assertEqual(json.loads(call(server, "GET", "/v1/capabilities")[2])["journalId"], first["journalId"])
        with tempfile.TemporaryDirectory() as other, serve(Path(other)) as server:
            self.assertNotEqual(json.loads(call(server, "GET", "/v1/capabilities")[2])["journalId"], first["journalId"])

    def test_lost_journal_becomes_readonly_without_recreating_identity_or_replaying(self):
        with patch("server.subprocess.Popen", side_effect=self.fake_process):
            with serve(self.root) as server:
                status, _, data = self.post(server); self.assertEqual(status, 200)
                (self.root / "journal.json").unlink()
                self.assertEqual(self.post(server, "new.id.same.body")[0], 409)
            with serve(self.root) as server:
                self.assertEqual(json.loads(call(server, "GET", "/v1/capabilities")[2])["version"], 1)
                self.assertEqual(self.post(server, "new.id.after.restart")[0], 409)
                self.assertEqual(call(server, "GET", f'/v1/jobs/{request_key("request.one")}/audio')[2], data)
                self.assertFalse((self.root / "journal.json").exists())
            self.assertEqual(len(self.calls), 1)

    def test_original_post_get_and_restart_never_dispatch_same_id_again(self):
        with patch("server.subprocess.Popen", side_effect=self.fake_process):
            with serve(self.root) as server:
                status, headers, data = self.post(server)
                self.assertEqual(status, 200); self.assertEqual(headers["Content-Type"], "audio/wav")
                result = json.loads(headers["x-storyforge-music-result"])
                self.assertEqual(result["audio"]["bytes"], len(data)); self.assertFalse(result["authorAdopted"])
                self.assertEqual(len(self.calls), 1)
                self.assertEqual(self.post(server)[0], 409)
                self.assertEqual(call(server, "GET", f'/v1/jobs/{result["jobId"]}/audio')[2], data)
            with serve(self.root) as restarted:
                self.assertEqual(self.post(restarted)[0], 409)
                self.assertEqual(call(restarted, "GET", f'/v1/jobs/{result["jobId"]}/audio')[2], data)
            self.assertEqual(len(self.calls), 1)

    def test_claim_exists_before_spawn_and_survives_launcher_failure(self):
        def failed_launch(command, **_):
            job = Path(command[command.index("--job") + 1])
            self.assertEqual(read_json(job / "claim.json")["requestHash"], fingerprint(REQUEST))
            raise OSError("engineering launch failure")
        with patch("server.subprocess.Popen", side_effect=failed_launch) as launch, serve(self.root) as server:
            self.assertEqual(self.post(server)[0], 500); self.assertEqual(self.post(server)[0], 409)
            self.assertEqual(self.post(server, "request.second.id")[0], 409)
            self.assertEqual(launch.call_count, 1)
            status, _, body = call(server, "GET", f'/v1/jobs/{request_key("request.one")}')
            self.assertEqual(status, 200); self.assertEqual(json.loads(body)["status"], "result-unknown-preserved")

    def test_readback_recovers_completed_original_worker_after_runner_loss(self):
        with patch("server.subprocess.Popen", side_effect=self.fake_process), serve(self.root) as server:
            self.assertEqual(self.post(server)[0], 200)
            job = request_key("request.one"); (self.root / job / "runner.json").unlink()
            self.assertEqual(call(server, "GET", f"/v1/jobs/{job}/audio")[0], 200)
            self.assertEqual(self.post(server)[0], 409); self.assertEqual(len(self.calls), 1)

    def test_bad_bytes_receipts_or_float_conversion_cannot_be_served(self):
        with patch("server.subprocess.Popen", side_effect=self.fake_process), serve(self.root) as server:
            self.assertEqual(self.post(server)[0], 200)
            root = self.root / request_key("request.one")
            samples = np.load(root / "raw-float32.npy", allow_pickle=False); samples[0, 0] += .2
            np.save(root / "raw-float32.npy", samples, allow_pickle=False)
            worker = read_json(root / "worker.json"); worker["floatSHA256"] = sha256(root / "raw-float32.npy"); atomic_json(root / "worker.json", worker)
            self.assertEqual(call(server, "GET", f"/v1/jobs/{root.name}/audio")[0], 409)
            self.assertEqual(self.post(server)[0], 409); self.assertEqual(len(self.calls), 1)

    def test_malformed_wave_or_changed_model_profile_is_rejected_without_replay(self):
        with patch("server.subprocess.Popen", side_effect=self.fake_process), serve(self.root) as server:
            self.assertEqual(self.post(server)[0], 200)
            root = self.root / request_key("request.one")
            worker = read_json(root / "worker.json"); worker["evidence"]["profile"] = "unreviewed"; atomic_json(root / "worker.json", worker)
            self.assertEqual(call(server, "GET", f"/v1/jobs/{root.name}/audio")[0], 409)
            worker["evidence"]["profile"] = PROFILE_ID; atomic_json(root / "worker.json", worker)
            (root / "clip.wav").write_bytes(b"corrupt original" * 10)
            self.assertEqual(call(server, "GET", f"/v1/jobs/{root.name}/audio")[0], 409)
            self.assertEqual(self.post(server)[0], 409); self.assertEqual(len(self.calls), 1)

    def test_licensed_library_preserves_exact_member_and_licence_and_rejects_changed_archive(self):
        data, licence = b"OggS controlled protocol fixture", b"CC0 controlled licence fixture"
        digest = lambda b: hashlib.sha256(b).hexdigest()
        path = self.root / "fixture.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("Audio/click.ogg", data); archive.writestr("License.txt", licence)
        member = {"memberPath": "Audio/click.ogg", "memberHash": digest(data), "bytes": len(data), "mimeType": "audio/ogg"}
        source = {"schema": "storyforge.avg.licensed-audio-catalogue", "version": 1, "license": "CC0-1.0", "archives": [{
            "key": "fixture", "archiveHash": sha256(path), "archiveBytes": path.stat().st_size, "publisherPage": "https://kenney.nl/assets/interface-sounds",
            "licenseMember": "License.txt", "licenseHash": digest(licence), "licenseText": licence.decode(), "members": [member]}]}
        with patch("licensed_library.catalogue", return_value=source):
            actual, receipt = original_member(self.root, sha256(path), digest(data))
            self.assertEqual(actual, data); self.assertEqual(receipt["licenseText"], licence.decode()); self.assertFalse(receipt["transcoded"])
            self.assertEqual(receipt["inferenceCalls"], 0)
            with self.assertRaises(ValueError): original_member(self.root, sha256(path), "f" * 64)
            archive_hash = sha256(path); path.write_bytes(path.read_bytes() + b"changed")
            with self.assertRaises(ValueError): original_member(self.root, archive_hash, digest(data))

    def test_unapproved_origin_host_paths_body_and_identity_never_launch(self):
        with patch("server.subprocess.Popen") as launch, serve(self.root) as server:
            for origin in ["null", "https://external.invalid", "http://localhost:5196"]:
                self.assertEqual(call(server, "GET", "/v1/capabilities", headers={"Origin": origin})[0], 403)
            self.assertEqual(call(server, "GET", "/v1/capabilities", headers={"Host": "external.invalid"})[0], 403)
            self.assertEqual(call(server, "GET", "/v1/jobs/../audio")[0], 404)
            self.assertEqual(call(server, "POST", "/v1/audio/music", b"{}", {"Content-Type": "application/json", "x-storyforge-idempotency-key": "../bad"})[0], 400)
            self.assertEqual(call(server, "POST", "/v1/audio/music", b'{}', {"Content-Type": "application/json"})[0], 400)
            self.assertEqual(launch.call_count, 0)

    def test_exact_body_rejects_duplicates_controls_unicode_and_extra_generation_options(self):
        for body in [b'{"caption":"x","caption":"y"}', b"[]", b'{}', b'{"caption":"\\ud800"}']:
            with self.assertRaises((ValueError, UnicodeError)):
                parse_body(body)
        for field, value in [("caption", "x\0y"), ("durationSeconds", True), ("seed", -1), ("bpm", 301)]:
            wrong = {**REQUEST, field: value}
            with self.assertRaises((ValueError, UnicodeError)):
                parse_body(json.dumps(wrong).encode())
        with self.assertRaises(ValueError):
            parse_body(json.dumps({**REQUEST, "device": "mps"}).encode())

    def test_inherited_os_lease_stays_busy_after_parent_close_until_child_exits(self):
        lock = self.root / "inference.lock"
        parent = lock.open("a+b"); fcntl.flock(parent, fcntl.LOCK_EX | fcntl.LOCK_NB)
        child = subprocess.Popen([sys.executable, "-c", "import sys;sys.stdin.buffer.read(1)"], stdin=subprocess.PIPE, pass_fds=(parent.fileno(),))
        parent.close()
        try:
            with lock.open("a+b") as other:
                with self.assertRaises(BlockingIOError): fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
                child.communicate(input=b"x", timeout=3)
                fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            if child.poll() is None: child.kill(); child.wait(timeout=3)

    def test_kernel_deadline_ends_owned_worker_without_supervisor_or_model(self):
        # Exercise the internal alarm at1s without loading Torch. The public
        # production CLI still enforces its separate30..900s admission.
        identity = journal_identity(self.root, create=True)
        root = self.root / request_key("alarm.fixture"); root.mkdir()
        atomic_json(root / "request.json", REQUEST)
        atomic_json(root / "claim.json", {"version": 2, "journalId": identity, "jobId": root.name, "requestHash": fingerprint(REQUEST), "bridgeHash": capabilities()["bridgeHash"]})
        script = """from argparse import Namespace
from pathlib import Path
import sys,time,engine,production_job
class Blocked:
 def __init__(self,*args): self.model_calls=0
 def generate(self,request): self.model_calls+=1; time.sleep(30)
engine.InstrumentalEngine=Blocked
production_job.worker(Namespace(job=Path(sys.argv[1]),model=Path(sys.argv[1]),source=Path(sys.argv[1]),deadline=1,lease_fd=int(sys.argv[2])))
"""
        with (self.root / "inference.lock").open("a+b") as lease:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            child = subprocess.Popen([sys.executable, "-B", "-c", script, str(root), str(lease.fileno())],
                cwd=Path(__file__).parent, pass_fds=(lease.fileno(),), start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                _, stderr = child.communicate(timeout=5)
                self.assertEqual(child.returncode, -signal.SIGALRM, stderr.decode())
            finally:
                if child.poll() is None: child.kill(); child.wait(timeout=3)
        self.assertEqual(read_json(root / "worker.json")["phase"], "inference-started")
        self.assertIsNone(read_json(root / "worker.json")["modelCalls"])
        self.assertFalse((root / "clip.wav").exists())


if __name__ == "__main__":
    unittest.main()
