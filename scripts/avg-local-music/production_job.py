"""One bounded local provider job. Never reads or writes StoryForge Work data.

The runner and inference child share an inherited OS lease; killing/restarting
the HTTP server cannot release capacity while the original child is still live.
"""
import argparse
import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import wave

from local_protocol import MAX_AUDIO, MODEL_ID, PROFILE_ID, atomic_json, bridge_sources, fingerprint, journal_identity, read_request, read_json
from runtime_guard import CODE_REVISION, forbid_network, sha256


def inspect_wav(path, request):
    if path.is_symlink() or not path.is_file() or not 44 <= path.stat().st_size <= MAX_AUDIO:
        raise ValueError("Bounded original WAV required")
    try:
        with wave.open(str(path), "rb") as audio:
            frames, rate, channels = audio.getnframes(), audio.getframerate(), audio.getnchannels()
            if (channels, rate, audio.getsampwidth(), audio.getcomptype()) != (2, 48000, 2, "NONE"):
                raise ValueError("Actual fixed PCM format differs")
            if abs(frames / rate - request["durationSeconds"]) > .5:
                raise ValueError("Actual music duration differs")
            if len(audio.readframes(frames + 1)) != frames * channels * 2:
                raise ValueError("Truncated original audio")
    except (wave.Error, EOFError) as error:
        raise ValueError("Malformed original WAV") from error
    return {"sha256": sha256(path), "bytes": path.stat().st_size, "durationMs": round(frames / rate * 1000),
            "sampleRateHz": rate, "channels": channels, "pcmBits": 16, "sampleFrames": frames}


def worker(args):
    # The kernel deadline remains effective even if Python/native code holds
    # the GIL or its supervising runner has disappeared. No retry follows it.
    signal.signal(signal.SIGALRM, signal.SIG_DFL)
    signal.alarm(args.deadline)
    root = args.job.resolve(strict=True)
    lease = os.fstat(args.lease_fd)
    expected_lease = (root.parent / "inference.lock").stat()
    if (lease.st_dev, lease.st_ino) != (expected_lease.st_dev, expected_lease.st_ino):
        raise ValueError("Exact inherited inference lease required")
    fcntl.flock(args.lease_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    with (root / "worker.claim").open("xb"):
        pass
    request = read_request(root)
    claim = read_json(root / "claim.json")
    if claim.get("version") != 2 or claim.get("journalId") != journal_identity(root.parent):
        raise ValueError("New inference requires the original V2 journal identity")
    sources = bridge_sources()
    if fingerprint(sources) != claim["bridgeHash"] or fingerprint(request) != claim["requestHash"]:
        raise ValueError("Claim source/request changed before inference")
    receipt = root / "worker.json"
    if receipt.exists() or (root / "clip.wav").exists() or (root / "raw-float32.npy").exists():
        raise ValueError("Original provider output must never be replaced")
    state = {"schema": "storyforge.avg.local-music-worker", "version": 2, "jobId": claim["jobId"], "journalId": claim["journalId"],
        "phase": "initializing", "modelCalls": 0, "requestHash": claim["requestHash"], "bridgeHash": claim["bridgeHash"],
        "startedAt": time.time(), "hearing": "unobserved", "authorAdopted": False}
    atomic_json(receipt, state)
    engine = None
    try:
        forbid_network()
        from engine import InstrumentalEngine
        engine = InstrumentalEngine(args.model, args.source, "cpu")
        state.update(phase="inference-started", modelCalls=None)
        atomic_json(receipt, state)
        data, samples, evidence = engine.generate(request)
        with (root / "clip.wav").open("xb") as target:
            target.write(data)
        import numpy as np
        with (root / "raw-float32.npy").open("xb") as target:
            np.save(target, samples, allow_pickle=False)
        if bridge_sources() != sources:
            raise ValueError("Bridge source changed during inference")
        state.update(phase="completed", modelCalls=engine.model_calls, completedAt=time.time(), evidence=evidence,
            audio=inspect_wav(root / "clip.wav", request), floatSHA256=sha256(root / "raw-float32.npy"))
        atomic_json(receipt, state)
        return 0
    except Exception as error:
        state.update(phase="failed", completedAt=time.time(), modelCalls=engine.model_calls if engine else 0,
            errorType=type(error).__name__, error=str(error))
        if engine is not None and engine.last_samples is not None:
            try:
                import numpy as np
                with (root / "failed-raw-float32.npy").open("xb") as target:
                    np.save(target, engine.last_samples, allow_pickle=False)
                state["unverifiedFloatSHA256"] = sha256(root / "failed-raw-float32.npy")
            except Exception as preservation_error:
                state["rawPreservationError"] = str(preservation_error)
        atomic_json(receipt, state)
        return 1


def stop_owned(process):
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait(timeout=5)
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


def validated_result(root):
    claim, worker = read_json(root / "claim.json"), read_json(root / "worker.json")
    request = read_request(root)
    if (claim.get("schema") != "storyforge.avg.local-music-claim" or type(claim.get("version")) is not int or claim.get("version") not in (1, 2) or claim.get("jobId") != root.name
            or worker.get("schema") != "storyforge.avg.local-music-worker" or type(worker.get("version")) is not int or worker.get("version") != claim["version"]
            or claim["version"] == 2 and (not isinstance(claim.get("journalId"), str) or len(claim["journalId"]) != 64 or worker.get("journalId") != claim["journalId"])
            or worker.get("phase") != "completed" or type(worker.get("modelCalls")) is not int
            or worker.get("modelCalls") != 1 or worker.get("jobId") != claim["jobId"]):
        raise ValueError("No unique completed actual inference")
    evidence = worker["evidence"]
    if (worker["requestHash"] != claim["requestHash"] or fingerprint(request) != claim["requestHash"]
            or worker["bridgeHash"] != claim["bridgeHash"] or evidence["requestHash"] != claim["requestHash"]
            or evidence["request"] != request or type(evidence["modelCalls"]) is not int or evidence["modelCalls"] != 1
            or f'{evidence["modelRepository"]}@{evidence["modelRevision"]}' != MODEL_ID
            or evidence["runtimeCodeRevision"] != CODE_REVISION or evidence["device"] != "cpu"
            or evidence["profile"] != PROFILE_ID or evidence["providerChargeUsd"] != 0
            or type(evidence["waveletSteps"]) is not int or not 1 <= evidence["waveletSteps"] <= 100):
        raise ValueError("Actual provider identity/request differs")
    audio = inspect_wav(root / "clip.wav", request)
    floats = root / "raw-float32.npy"
    if floats.is_symlink() or not floats.is_file() or not 1 <= floats.stat().st_size <= 16 * 1024**2:
        raise ValueError("Bounded original model float evidence required")
    if audio != worker["audio"] or sha256(floats) != worker["floatSHA256"]:
        raise ValueError("Original provider audio bytes changed")
    import numpy as np
    samples = np.load(floats, allow_pickle=False)
    if samples.dtype != np.float32 or samples.shape != (2, audio["sampleFrames"]) or not np.isfinite(samples).all():
        raise ValueError("Original model float format/frames differ")
    expected_pcm = np.rint(np.clip(samples.T, -1, 32767 / 32768) * 32768).astype("<i2").tobytes()
    with wave.open(str(root / "clip.wav"), "rb") as wav:
        if wav.readframes(audio["sampleFrames"]) != expected_pcm:
            raise ValueError("Original float to PCM conversion differs")
    return {"schema": "storyforge.avg.local-music-result", "version": claim["version"], "jobId": claim["jobId"],
        **({"journalId": claim["journalId"]} if claim["version"] == 2 else {}),
        "requestHash": claim["requestHash"], "bridgeHash": claim["bridgeHash"], "model": MODEL_ID,
        "runtimeCodeRevision": CODE_REVISION, "profile": evidence["profile"], "device": "cpu", "modelCalls": 1,
        "supplierCostUsd": 0, "chargeScope": "local inference; device, power and labor excluded", "audio": audio,
        "floatSHA256": worker["floatSHA256"], "sourceHash": evidence["sourceHash"], "modelHash": evidence["modelHash"],
        "waveletBackend": evidence["waveletBackend"], "waveletSteps": evidence["waveletSteps"],
        "inferenceSeconds": evidence["inferenceSeconds"], "peakAmplitude": evidence["peakAmplitude"],
        "rmsAmplitude": evidence["rmsAmplitude"], "hearing": "unobserved", "rightsReview": "unreviewed", "authorAdopted": False}


def run(args):
    root = args.job.resolve(strict=True)
    claim = read_json(root / "claim.json")
    if claim.get("version") != 2 or claim.get("journalId") != journal_identity(root.parent):
        raise ValueError("New runner requires the original V2 journal identity")
    receipt = root / "runner.json"
    with (root / "runner.claim").open("xb"):
        pass
    if receipt.exists() or args.deadline != claim["deadlineSeconds"]:
        raise ValueError("Owned runner already claimed or deadline changed; never replay")
    state = {"schema": "storyforge.avg.local-music-runner", "version": 1, "status": "prepared", "jobId": claim["jobId"],
        "startedAt": time.time(), "modelCalls": 0, "maximumModelCalls": 1, "automaticRetries": 0}
    atomic_json(receipt, state)
    process = None
    with (root.parent / "inference.lock").open("a+b") as lease:
        try:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if shutil.disk_usage(root).free < 8 * 1024**3 + 64 * 1024**2:
                raise ValueError("Preserve8GiB reserve and64MiB bounded result budget")
            command = [sys.executable, str(Path(__file__).resolve()), "--worker", "--job", str(root), "--model", str(args.model.resolve()),
                "--source", str(args.source.resolve()), "--deadline", str(args.deadline), "--lease-fd", str(lease.fileno())]
            with (root / "runtime.log").open("xb") as log:
                process = subprocess.Popen(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                    pass_fds=(lease.fileno(),), env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
                state.update(status="running", workerPid=process.pid, modelCalls=None)
                atomic_json(receipt, state)
                code = process.wait(timeout=args.deadline + 5)
            actual = read_json(root / "worker.json")
            if code != 0 or actual.get("phase") != "completed":
                state.update(status="failed" if actual.get("phase") == "failed" else "result-unknown-preserved", modelCalls=actual.get("modelCalls"))
            else:
                state.update(status="completed", modelCalls=1, result=validated_result(root))
        except BlockingIOError:
            state.update(status="busy-no-inference", modelCalls=0)
        except BaseException as error:
            stop_owned(process)
            state.update(status="result-unknown-preserved" if process is not None else "failed-before-inference",
                modelCalls=None if process is not None else 0, errorType=type(error).__name__, error=str(error))
        state["completedAt"] = time.time()
        atomic_json(receipt, state)
    return 0 if state["status"] == "completed" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", action="store_true")
    for name in ("job", "source", "model"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--deadline", type=int, required=True)
    parser.add_argument("--lease-fd", type=int)
    args = parser.parse_args()
    if not 30 <= args.deadline <= 900 or args.worker and args.lease_fd is None:
        parser.error("Explicit30..900s deadline and worker lease required")
    raise SystemExit(worker(args) if args.worker else run(args))
