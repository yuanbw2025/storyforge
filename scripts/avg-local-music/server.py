"""Loopback-only bounded music provider. No credentials, Work access or adoption.

An original POST id is consumed durably before launch. GET only reads original
results; restart, disconnect, timeout or a repeated id never launches again.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from local_protocol import MAX_BODY, MAX_JOBS, atomic_json, bridge_sources, capabilities, fingerprint, journal_identity, parse_body, read_json, read_request, request_key
from production_job import validated_result
from licensed_library import catalogue, original_member


class MusicServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port, origins, root, model, source, deadline=900, library=None):
        self.origins, self.root, self.model, self.source = frozenset(origins), root, model, source
        self.deadline, self.claim_lock = deadline, threading.Lock()
        self.library = library
        self.capability = {**capabilities(), "deadlineSeconds": deadline}
        self.journal_id = journal_identity(root, create=True)
        if self.journal_id:
            self.capability.update(version=2, journalId=self.journal_id)
        super().__init__(("127.0.0.1", port), MusicHandler)


class MusicHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def allowed(self):
        host = self.headers.get_all("Host", [])
        origins = self.headers.get_all("Origin", [])
        return (host == [f"127.0.0.1:{self.server.server_port}"]
                and (not origins or len(origins) == 1 and origins[0] in self.server.origins))

    def send(self, status, body, mime="application/json", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Access-Control-Expose-Headers", "x-request-id,x-storyforge-music-result,x-storyforge-library-result")
        origin = self.headers.get("Origin")
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def error(self, code, message, job=None):
        self.close_connection = True
        self.send(code, json.dumps({"error": message, "jobId": job, "automaticRetryAllowed": False}).encode())

    def do_OPTIONS(self):
        if not self.allowed():
            return self.error(403, "origin or host denied")
        self.send(204, b"", extra={"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "content-type,x-storyforge-idempotency-key"})

    def do_GET(self):
        if not self.allowed():
            return self.error(403, "origin or host denied")
        if self.path == "/v1/capabilities":
            if fingerprint(bridge_sources()) != self.server.capability["bridgeHash"]:
                return self.error(409, "bridge source changed; no new request allowed")
            return self.send(200, json.dumps(self.server.capability, sort_keys=True).encode())
        if self.path == "/v1/library/catalogue":
            return self.send(200, json.dumps({**catalogue(), "observation": "metadata-only; no original bytes or hearing proven"}).encode())
        member = re.fullmatch(r"/v1/library/audio/([a-f0-9]{64})/([a-f0-9]{64})", self.path)
        if member:
            try:
                data, receipt = original_member(self.server.library, *member.groups())
                return self.send(200, data, receipt["mimeType"], {"x-storyforge-library-result": json.dumps(receipt, ensure_ascii=True, separators=(",", ":"))})
            except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile):
                return self.error(409, "original archive, licence witness or member cannot be verified")
        match = re.fullmatch(r"/v1/jobs/([a-f0-9]{64})(/audio)?", self.path)
        if not match:
            return self.error(404, "unknown route")
        self.result(match[1], bool(match[2]))

    def result(self, job, audio):
        root = self.server.root / job
        if root.is_symlink() or not root.is_dir():
            return self.error(404, "original request not found", job)
        try:
            claim = read_json(root / "claim.json")
            state = read_json(root / "runner.json") if (root / "runner.json").exists() else {"status": "result-unknown-preserved", "modelCalls": None}
            original_completed = (root / "worker.json").exists() and read_json(root / "worker.json").get("phase") == "completed"
            if state["status"] != "completed" and not original_completed:
                if audio:
                    return self.error(409, "no verified original audio; inspect original status, do not replay", job)
                return self.send(200, json.dumps({"schema": "storyforge.avg.local-music-job", "version": 1,
                    "jobId": job, "requestHash": claim["requestHash"], "bridgeHash": claim["bridgeHash"],
                    "status": state["status"], "modelCalls": state.get("modelCalls"), "automaticRetryAllowed": False}).encode())
            result = validated_result(root)
            if audio:
                return self.send(200, (root / "clip.wav").read_bytes(), "audio/wav", {"x-request-id": job,
                    "x-storyforge-music-result": json.dumps(result, ensure_ascii=True, sort_keys=True, separators=(",", ":"))})
            self.send(200, json.dumps({"schema": "storyforge.avg.local-music-job", "version": 1,
                "jobId": job, "status": "completed", "result": result, "automaticRetryAllowed": False}).encode())
        except (OSError, ValueError, KeyError, TypeError):
            self.error(409, "original receipt or audio cannot be verified; preserved without replay", job)

    def do_POST(self):
        if not self.allowed():
            return self.error(403, "origin or host denied")
        if self.path != "/v1/audio/music":
            return self.error(404, "unknown route")
        try:
            identity_valid = self.server.journal_id and journal_identity(self.server.root) == self.server.journal_id
        except (OSError, ValueError):
            identity_valid = False
        if not identity_valid:
            return self.error(409, "original journal identity unavailable; read-only, never recreate or replay")
        lengths = self.headers.get_all("Content-Length", [])
        keys = self.headers.get_all("x-storyforge-idempotency-key", [])
        if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isdigit() or not 0 < int(lengths[0]) <= MAX_BODY or len(keys) != 1:
            return self.error(400, "bounded JSON and unique request identity required")
        if len(self.headers.get_all("Content-Type", [])) != 1 or self.headers.get_content_type() != "application/json":
            return self.error(400, "JSON content type required")
        try:
            raw = self.rfile.read(int(lengths[0]))
            request, job = parse_body(raw), request_key(keys[0])
            if len(raw) != int(lengths[0]):
                raise ValueError("incomplete body")
        except (ValueError, UnicodeError, TimeoutError):
            return self.error(400, "unsupported exact music request")
        root = self.server.root / job
        with self.server.claim_lock:
            if fingerprint(bridge_sources()) != self.server.capability["bridgeHash"] or journal_identity(self.server.root) != self.server.journal_id:
                return self.error(409, "bridge source changed; request not dispatched")
            if root.exists() or root.is_symlink():
                return self.error(409, "original id already claimed; GET reads it without another inference", job)
            if self.unresolved_request(fingerprint(request)):
                return self.error(409, "same original request remains unresolved; no new id may replay it", job)
            if len([p for p in self.server.root.iterdir() if re.fullmatch(r"[a-f0-9]{64}", p.name)]) >= MAX_JOBS:
                return self.error(409, "provider journal batch limit; retain original records")
            try:
                root.mkdir(mode=0o700)
                atomic_json(root / "request.json", request)
                atomic_json(root / "claim.json", {"schema": "storyforge.avg.local-music-claim", "version": 2,
                    "jobId": job, "journalId": self.server.journal_id, "requestHash": fingerprint(request), "bridgeHash": self.server.capability["bridgeHash"],
                    "createdAt": time.time(), "deadlineSeconds": self.server.deadline, "maximumModelCalls": 1, "automaticRetries": 0})
                command = [sys.executable, str(Path(__file__).with_name("production_job.py")), "--job", str(root),
                    "--model", str(self.server.model), "--source", str(self.server.source), "--deadline", str(self.server.deadline)]
                with (root / "runner.log").open("xb") as log:
                    process = subprocess.Popen(command, cwd=root, stdout=log, stderr=subprocess.STDOUT,
                        start_new_session=True, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
            except OSError:
                return self.error(500, "claim retained; inspect original id before any new request", job)
        try:
            process.wait(timeout=self.server.deadline + 20)
        except subprocess.TimeoutExpired:
            return self.error(504, "original owned job deadline; inspect same id, never replay", job)
        self.result(job, True)

    def unresolved_request(self, request_hash):
        # A new id or Build must not turn the same unknown request into a retry.
        # Known completed/failed attempts stay recorded and are never replayed
        # by the server itself. Bad journals conservatively block new dispatch.
        for root in self.server.root.iterdir():
            if not re.fullmatch(r"[a-f0-9]{64}", root.name):
                continue
            try:
                if root.is_symlink() or not root.is_dir(): return True
                claim = read_json(root / "claim.json")
                if (claim.get("schema") != "storyforge.avg.local-music-claim" or claim.get("version") not in (1, 2)
                        or claim.get("jobId") != root.name or fingerprint(read_request(root)) != claim.get("requestHash")):
                    return True
                if claim["requestHash"] != request_hash: continue
                if (root / "worker.json").exists():
                    worker = read_json(root / "worker.json")
                    if (worker.get("schema") != "storyforge.avg.local-music-worker" or worker.get("version") != claim["version"]
                            or worker.get("jobId") != root.name or worker.get("requestHash") != request_hash
                            or worker.get("bridgeHash") != claim.get("bridgeHash")
                            or claim["version"] == 2 and worker.get("journalId") != claim.get("journalId")): return True
                    if worker.get("phase") == "completed":
                        validated_result(root); continue
                    if worker.get("phase") == "failed" and type(worker.get("modelCalls")) is int and worker["modelCalls"] in (0, 1): continue
                elif (root / "runner.json").exists():
                    runner = read_json(root / "runner.json")
                    if runner.get("status") in ("busy-no-inference", "failed-before-inference") and type(runner.get("modelCalls")) is int and runner.get("modelCalls") == 0: continue
                return True
            except (OSError, ValueError, KeyError, TypeError):
                return True
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5298)
    parser.add_argument("--origin", action="append", default=[])
    for name in ("data", "model", "source"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--deadline", type=int, default=900)
    parser.add_argument("--library", type=Path, help="Directory containing pinned original archives and licence witness files; never downloaded by this service")
    args = parser.parse_args()
    origins = args.origin or ["http://127.0.0.1:5196", "http://127.0.0.1:1111"]
    if not 1 <= args.port <= 65535 or not 30 <= args.deadline <= 900 or any(not re.fullmatch(r"http://127\.0\.0\.1:[1-9][0-9]{0,4}", origin) for origin in origins):
        parser.error("Explicit loopback origins/port and30..900s deadline required")
    data = args.data.expanduser().resolve()
    if data.is_relative_to(Path(__file__).resolve().parents[2]) or args.data.is_symlink():
        parser.error("Provider journal must be a dedicated external ordinary directory")
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(data, 0o700)
    server = MusicServer(args.port, origins, data, args.model.resolve(strict=True), args.source.resolve(strict=True), args.deadline,
        args.library.resolve(strict=True) if args.library else None)
    print(f"Local fixed music provider on127.0.0.1:{server.server_port}; no automatic retry", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
