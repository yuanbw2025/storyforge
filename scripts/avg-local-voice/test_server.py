"""Standard-library HTTP boundary tests; original PCM tone, no model/speech claims."""
import http.client
import io
import json
import threading
import unittest
import wave
from server import VoiceServer, MODEL_ID, parse_request, capabilities


class Engine:
    def __init__(self):
        self.calls = []
        self.fail = False
    def synthesize(self, *args):
        self.calls.append(args)
        if self.fail:
            raise RuntimeError("internal detail must not leak")
        out = io.BytesIO()
        with wave.open(out, "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
            wav.writeframes(b"\x00\x01" * 240)
        return out.getvalue(), {"input_characters": 4}


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.server = VoiceServer(0, ["http://127.0.0.1:5196"], self.engine)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def body(self, **patch):
        return json.dumps({"input": "封口仍在。", "voice": "Serena", "model": MODEL_ID,
                           "response_format": "wav", "instructions": "低声，谨慎。", **patch}, ensure_ascii=False).encode()

    def request(self, method="POST", path="/v1/audio/speech", body=None, **headers):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            conn.request(method, path, body=body if body is not None else self.body(),
                         headers={"Origin": "http://127.0.0.1:5196", "Content-Type": "application/json",
                                  "x-storyforge-idempotency-key": "avg.test.1", **headers})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            conn.close()

    def test_exact_input_instructions_real_pcm_and_no_remote_key(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(self.engine.calls, [("封口仍在。", "Serena", "低声，谨慎。")])
        self.assertEqual(headers["x-storyforge-cost-usd"], "0")
        self.assertIn("x-storyforge-cost-usd", headers["Access-Control-Expose-Headers"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:5196")
        with wave.open(io.BytesIO(body)) as clip:
            self.assertEqual((clip.getframerate(), clip.getsampwidth(), clip.getnframes()), (24000, 2, 240))

    def test_duplicate_never_generates_again(self):
        self.assertEqual(self.request()[0], 200)
        self.assertEqual(self.request()[0], 409)
        self.assertEqual(len(self.engine.calls), 1)

    def test_failed_request_is_held_and_does_not_leak_or_replay(self):
        self.engine.fail = True
        status, _, body = self.request()
        self.assertEqual(status, 500); self.assertNotIn(b"internal detail", body)
        self.assertEqual(self.request()[0], 409)
        self.assertEqual(len(self.engine.calls), 1)

    def test_foreign_null_and_rebound_origins_make_zero_calls(self):
        for headers in [{"Origin": "https://foreign.invalid"}, {"Origin": "null"}, {"Host": "rebound.invalid"}]:
            self.assertEqual(self.request(**headers)[0], 403)
        self.assertEqual(self.engine.calls, [])

    def test_bad_model_voice_speed_format_and_oversize_make_zero_calls(self):
        for patch in [{"model": "changed"}, {"voice": "actor-clone"}, {"speed": 1},
                      {"response_format": "mp3"}, {"input": "😀" * 129}, {"instructions": "x" * 2049}]:
            self.assertEqual(self.request(body=self.body(**patch))[0], 400)
        self.assertEqual(self.engine.calls, [])

    def test_duplicate_json_fields_are_rejected(self):
        with self.assertRaises(ValueError):
            parse_request(b'{"input":"one","input":"two"}')

    def test_busy_and_exhausted_batches_never_call_model(self):
        self.server.generation_lock.acquire()
        try:
            self.assertEqual(self.request()[0], 409)
        finally:
            self.server.generation_lock.release()
        self.server.seen = {str(i) for i in range(256)}
        self.assertEqual(self.request()[0], 409)
        self.assertEqual(self.engine.calls, [])

    def test_declared_capability_and_preflight_have_zero_generation(self):
        status, _, body = self.request("GET", "/v1/capabilities", b"")
        self.assertEqual(status, 200); self.assertEqual(json.loads(body), capabilities())
        self.assertEqual(self.request("OPTIONS", body=b"")[0], 204)
        self.assertEqual(self.request("GET", "/unknown", b"")[0], 404)
        self.assertEqual(self.engine.calls, [])


if __name__ == "__main__":
    unittest.main()
