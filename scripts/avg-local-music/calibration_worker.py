"""One offline evaluator child; only the parent launches this bounded worker."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time

from engine import InstrumentalEngine, parse_request
from runtime_guard import forbid_network, unique_fields, sha256


def write_record(path, value):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix="." + path.name + "-", delete=False) as target:
        pending = Path(target.name)
        target.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
        target.flush()
        os.fsync(target.fileno())
    pending.replace(path)


def evaluate(args):
    root = args.output.resolve(strict=True)
    receipt = root / "worker-receipt.json"
    if receipt.exists() or any((root / name).exists() for name in ("clip.wav", "raw-float32.npy")):
        raise ValueError("Evaluation output already exists; never overwrite or resend")
    request = parse_request(json.loads(args.request.read_text(), object_pairs_hook=unique_fields))
    record = {"schema": "storyforge.avg.instrumental-calibration-worker", "version": 1,
        "startedAt": time.time(), "phase": "initializing", "maximumModelCalls": 1, "modelCalls": 0,
        "request": request, "device": args.device, "hearing": "unobserved", "authorAdopted": False}
    write_record(receipt, record)
    engine = None
    try:
        forbid_network()
        engine = InstrumentalEngine(args.model, args.source, args.device)
        record.update(phase="inference-started", modelCalls=None, resultDisposition="unknown-until-terminal")
        write_record(receipt, record)
        data, samples, evidence = engine.generate(request)
        wav = root / "clip.wav"
        with wav.open("xb") as target:
            target.write(data)
        import numpy as np
        with (root / "raw-float32.npy").open("xb") as target:
            np.save(target, samples, allow_pickle=False)
        record.update(phase="completed", completedAt=time.time(), modelCalls=engine.model_calls,
            resultDisposition="evaluation-only-unreviewed", evidence=evidence,
            audio={"path": str(wav), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()},
            floatAudio={"path": str(root / "raw-float32.npy"), "sha256": sha256(root / "raw-float32.npy")})
        write_record(receipt, record)
        return 0
    except Exception as error:
        record.update(phase="failed", completedAt=time.time(), errorType=type(error).__name__, error=str(error),
            modelCalls=engine.model_calls if engine is not None else 0, resultDisposition="failed-preserve-do-not-retry")
        if engine is not None and engine.last_samples is not None:
            try:
                import numpy as np
                failed = root / "failed-raw-float32.npy"
                with failed.open("xb") as target:
                    np.save(target, engine.last_samples, allow_pickle=False)
                record["unverifiedFloatAudio"] = {"path": str(failed), "sha256": sha256(failed), "authorAdopted": False}
            except Exception as preservation_error:
                record["rawPreservationError"] = str(preservation_error)
        write_record(receipt, record)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "model", "request", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--device", choices=("cpu",), required=True)
    raise SystemExit(evaluate(parser.parse_args()))
