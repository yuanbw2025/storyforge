"""Explicit one-clip local evaluation with a deadline; never a product entry.

No Work/World/IndexedDB or provider credential access, author adoption, output
reuse, device fallback, model download or automatic generation retry exists.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import wave

from calibration_worker import write_record
from engine import parse_request
from runtime_guard import CODE_REVISION, MODEL_REVISION, fingerprint, sha256, unique_fields


def stop_owned_worker(process):
    if process.poll() is not None:
        return
    if os.name == "posix":
        os.killpg(process.pid, signal.SIGTERM)
    else:
        process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        process.wait(timeout=10)


def run(args):
    if args.device != "cpu":
        raise ValueError("Only the evaluated CPU device profile is available")
    if type(args.timeout_seconds) is not int or not 30 <= args.timeout_seconds <= 900:
        raise ValueError("Explicit evaluation deadline must be30..900 seconds")
    request = parse_request(json.loads(args.request.read_text(), object_pairs_hook=unique_fields))
    output = args.output.expanduser().resolve()
    repository = Path(__file__).resolve().parents[2]
    if output.is_relative_to(repository) or output.exists():
        raise ValueError("Use a fresh external evaluation directory; no overwrite or product writes")
    output.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output.parent).free < 8 * 1024**3 + 32 * 1024**2:
        raise ValueError("Evaluation requires32MiB output budget plus8GiB reserve")
    output.mkdir()
    frozen = output / "request.json"
    frozen.write_text(json.dumps(request, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    adapter_paths = [Path(__file__).with_name(name) for name in
        ("calibrate.py", "calibration_worker.py", "engine.py", "offline_handler.py", "runtime_guard.py", "haar_correction.py", "model-source.json")]
    adapter_paths.append(Path(__file__).resolve().parent.parent / "avg-local-audio/pinned_model_install.py")
    sources = {str(p): sha256(p) for p in adapter_paths}
    evidence = {"schema": "storyforge.avg.instrumental-calibration", "version": 1, "status": "prepared",
        "startedAt": time.time(), "requestHash": fingerprint(request), "device": args.device,
        "maximumModelCalls": 1, "automaticRetries": 0, "deadlineSeconds": args.timeout_seconds,
        "hearing": "unobserved", "rightsReview": "unreviewed", "authorAdopted": False,
        "modelDirectory": str(args.model.resolve()), "sourceDirectory": str(args.source.resolve()),
        "scope": "external offline provider evaluation only; no product candidate, Work or adoption",
        "adapterSources": sources}
    receipt = output / "evaluation.json"
    write_record(receipt, evidence)
    process = None
    worker = None
    try:
        command = [sys.executable, str(Path(__file__).with_name("calibration_worker.py")),
            "--source", str(args.source.resolve()), "--model", str(args.model.resolve()),
            "--request", str(frozen), "--output", str(output), "--device", args.device]
        with (output / "runtime.log").open("x") as log:
            process = subprocess.Popen(command, cwd=output, stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
            evidence.update(status="running", workerPid=process.pid)
            write_record(receipt, evidence)
            result = process.wait(timeout=args.timeout_seconds)
        worker = json.loads((output / "worker-receipt.json").read_text())
        if not isinstance(worker, dict):
            raise ValueError("Worker receipt must be an object")
        if result != 0 or worker.get("phase") != "completed":
            terminal = worker.get("phase") in ("completed", "failed")
            evidence.update(status="failed" if terminal else "result-unknown-preserved",
                            completedAt=time.time(), worker=worker)
            write_record(receipt, evidence)
            return result or 1
        reported = worker.get("evidence", {})
        if worker.get("request") != request or reported.get("requestHash") != fingerprint(request) or worker.get("modelCalls") != 1:
            raise ValueError("Worker request or bounded execution identity differs")
        if reported.get("modelRevision") != MODEL_REVISION or reported.get("runtimeCodeRevision") != CODE_REVISION:
            raise ValueError("Worker runtime or model identity differs")
        if {str(p): sha256(p) for p in adapter_paths} != sources:
            raise ValueError("Evaluation adapter source changed during execution")
        audio = output / "clip.wav"
        if sha256(audio) != worker["audio"]["sha256"] or audio.stat().st_size != worker["audio"]["bytes"]:
            raise ValueError("Actual saved WAV differs from worker bytes")
        raw = output / "raw-float32.npy"
        if not raw.is_file() or not 0 < raw.stat().st_size <= 32 * 1024**2 or sha256(raw) != worker["floatAudio"]["sha256"]:
            raise ValueError("Actual original float audio differs from worker bytes")
        with wave.open(str(audio), "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (2, 2, 48000, "NONE"):
                raise ValueError("Actual WAV format differs from declared profile")
            seconds = wav.getnframes() / wav.getframerate()
        if abs(seconds - request["durationSeconds"]) > .5:
            raise ValueError("Actual WAV duration differs")
        evidence.update(status="completed", completedAt=time.time(), worker=worker, wavDurationSeconds=seconds)
        write_record(receipt, evidence)
        print(json.dumps({"receipt": str(receipt), "audio": str(audio), "sha256": worker["audio"]["sha256"],
                          "seconds": seconds, "hearing": "unobserved", "authorAdopted": False}), flush=True)
        return 0
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        if process is not None:
            stop_owned_worker(process)
        evidence.update(status="result-unknown-preserved", completedAt=time.time(),
                        error="Worker deadline/cancellation; inspect original worker receipt and bytes before any new evaluation")
        write_record(receipt, evidence)
        return 124
    except Exception as error:
        if process is not None:
            stop_owned_worker(process)
        known_terminal = isinstance(worker, dict) and worker.get("phase") in ("completed", "failed")
        evidence.update(status="result-unknown-preserved" if process is not None and not known_terminal else "failed",
                        completedAt=time.time(), errorType=type(error).__name__, error=str(error))
        write_record(receipt, evidence)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "model", "request", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--device", choices=("cpu",), default="cpu")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    raise SystemExit(run(parser.parse_args()))
