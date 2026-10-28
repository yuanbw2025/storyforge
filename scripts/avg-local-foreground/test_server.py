import argparse
import hashlib
import io
import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from unittest import mock
import numpy as np
from PIL import Image

from server import (ALLOWED_ORIGINS, ALGORITHM_V5, ForegroundHTTPServer, ForegroundQualityError,
                    MATTING_METHOD, MODEL_ID, PROMPT_STRATEGY, PROMPT_STRATEGY_V5, QUALITY_GATE_V5,
                    canonical_json, parse_loopback_origin, portrait_prompts, prompt_manifest,
                    select_candidate_observations_v5, select_portrait_mask, sha256)
from server import (ALGORITHM_V6, MATTING_METHOD_V6, NEUTRAL_BACKGROUND_RULE, QUALITY_GATE_V6,
                    derive_neutral_background_v1)

ORIGIN = "http://127.0.0.1:5196"


def png_bytes(width=40, height=48):
    image = Image.new("RGB", (width, height), (22, 30, 40))
    for y in range(8, height - 5):
        for x in range(10, width - 9):
            image.putpixel((x, y), (230, 160, 90))
    target = io.BytesIO()
    image.save(target, format="PNG")
    return target.getvalue()


class FakeEngine:
    device = "cpu"

    def __init__(self):
        self.calls = 0
        self.prompt_sets = None

    def segment(self, rgb, prompt_sets):
        self.calls += 1
        self.prompt_sets = prompt_sets
        alpha = np.zeros(rgb.shape[:2], dtype=np.uint8)
        alpha[8:-5, 10:-9] = 255
        return alpha, rgb.copy(), 0.91, float(np.mean(alpha >= 128)), MATTING_METHOD

    def segment_v5(self, rgb, prompt_sets):
        alpha, foreground, _score, ratio, matting = self.segment(rgb, prompt_sets)
        candidates = [{"promptIndex": index // 3, "maskIndex": index % 3,
                       "score": score, "maskCoverage": ratio if index != 2 else 0.02}
                      for index, score in enumerate([0.65, 0.80, 0.99, 0.93, 0.70, 0.85])]
        return alpha, foreground, 0.93, ratio, matting, {
            "selectedCandidateIndex": 3, "maskCoverage": ratio, "candidates": candidates}

    def segment_v6(self, rgb, prompt_sets):
        flood, background = derive_neutral_background_v1(rgb)
        self.calls += 1
        self.prompt_sets = prompt_sets
        alpha = (~flood).astype(np.uint8) * 255
        foreground = rgb.copy(); foreground[flood] = 0
        ratio = float(np.mean(alpha >= 128))
        candidates = [{"promptIndex": index // 3, "maskIndex": index % 3,
                       "score": score, "maskCoverage": 0.02 if index in (1, 2) else 0.4}
                      for index, score in enumerate([0.65, 0.99, 0.98, 0.92, 0.80, 0.86])]
        background["removedMaskPixelCount"] = round(alpha.size * 0.4) - int(np.count_nonzero(alpha))
        return alpha, foreground, 0.92, ratio, MATTING_METHOD_V6, {
            "selectedCandidateIndex": 3, "maskCoverage": 0.4, "candidates": candidates}, background


def neutral_fixture(scale=1):
    value = json.loads((Path(__file__).resolve().parents[2] / "tests/helpers/avg-neutral-background.json").read_text())
    rgb = np.array([[value["colors"][symbol] for symbol in row] for row in value["rows"]], dtype=np.uint8)
    expected = np.array([[symbol == "." for symbol in row] for row in value["rows"]], dtype=bool)
    if scale != 1:
        rgb = np.repeat(np.repeat(rgb, scale, axis=0), scale, axis=1)
        expected = np.repeat(np.repeat(expected, scale, axis=0), scale, axis=1)
    target = io.BytesIO(); Image.fromarray(rgb, mode="RGB").save(target, format="PNG")
    return rgb, expected, target.getvalue()


class ForegroundServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = FakeEngine()
        cls.server = ForegroundHTTPServer(("127.0.0.1", 0), cls.engine)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, raw=None, *, operation=None, origin=ORIGIN, width=40, height=48, declared_width=None, digest=None, mime="image/png", path="/v1/segment"):
        raw = png_bytes(40, 48) if raw is None else raw
        headers = {"Origin": origin, "Content-Type": "application/octet-stream",
                   "X-SF-Operation-ID": operation or str(uuid.uuid4()),
                   "X-SF-Source-SHA256": digest or sha256(raw), "X-SF-Source-Mime": mime,
                   "X-SF-Source-Width": str(width if declared_width is None else declared_width), "X-SF-Source-Height": str(height)}
        req = urllib.request.Request(self.url + path, data=raw, headers=headers, method="POST")
        return req

    def test_capability_is_local_and_discloses_fixed_model(self):
        request = urllib.request.Request(self.url + "/v1/capabilities", headers={"Origin": ORIGIN})
        with urllib.request.urlopen(request) as response:
            import json
            capability = json.loads(response.read())
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertTrue(capability["ready"])
        self.assertEqual(capability["model"], MODEL_ID)
        self.assertFalse(capability["networkInference"])
        self.assertEqual(capability["storage"], "none")

    def test_source_bound_candidate_returns_a_hashed_alpha_plane(self):
        before = self.engine.calls
        request = self.request()
        with urllib.request.urlopen(request) as response:
            body = response.read()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Content-Type"], "image/png")
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], ORIGIN)
            self.assertEqual(response.headers["X-SF-Algorithm"], "storyforge.avg.foreground.sam2.1-pymatting.v4")
            self.assertEqual(response.headers["X-SF-Prompt-Strategy"], PROMPT_STRATEGY)
            candidate = Image.open(io.BytesIO(body)).convert("RGBA")
            rgba = np.asarray(candidate, dtype=np.uint8)
            self.assertEqual(response.headers["X-SF-Alpha-SHA256"], hashlib.sha256(rgba[:, :, 3].tobytes()).hexdigest())
            self.assertEqual(response.headers["X-SF-Cutout-Pixel-SHA256"], hashlib.sha256(rgba.tobytes()).hexdigest())
            self.assertEqual(response.headers["X-SF-Result-PNG-SHA256"], hashlib.sha256(body).hexdigest())
            self.assertEqual(response.headers["X-SF-Source-SHA256"], request.get_header("X-sf-source-sha256"))
            self.assertEqual(response.headers["X-SF-Width"], "40")
        self.assertGreater(len(body), 20)
        self.assertEqual(self.engine.calls, before + 1)
        self.assertEqual(self.engine.prompt_sets, portrait_prompts(40, 48))
        self.assertEqual(self.engine.prompt_sets[0]["box"], {"x1": 1250, "x2": 8750, "y1": 100, "y2": 9900})
        self.assertEqual(len(self.engine.prompt_sets[0]["box_coords"]), 2)

    def test_portrait_box_is_stable_and_maps_to_source_pixels(self):
        prompt = portrait_prompts(1024, 1536)[0]
        self.assertEqual(prompt["box"], {"x1": 1250, "x2": 8750, "y1": 100, "y2": 9900})
        self.assertEqual(prompt["box_coords"], [(127.875, 15.35), (895.125, 1519.65)])

    def test_v5_capability_has_its_own_identity_and_fixed_gate(self):
        import json
        request = urllib.request.Request(self.url + "/v2/capabilities", headers={"Origin": ORIGIN})
        with urllib.request.urlopen(request) as response:
            capability = json.loads(response.read())
        self.assertEqual(capability["version"], 2)
        self.assertEqual(capability["algorithm"], ALGORITHM_V5)
        self.assertEqual(capability["promptStrategy"], PROMPT_STRATEGY_V5)
        self.assertEqual(capability["qualityGate"], QUALITY_GATE_V5)

    def test_v5_binds_six_mask_observations_and_both_prompt_sets(self):
        import json
        with urllib.request.urlopen(self.request(path="/v2/segment")) as response:
            response.read()
            candidates = json.loads(response.headers["X-SF-Candidates"])
            self.assertEqual(response.headers["X-SF-Algorithm"], ALGORITHM_V5)
            self.assertEqual(response.headers["X-SF-Quality-Gate"], QUALITY_GATE_V5)
            self.assertEqual(response.headers["X-SF-Selected-Candidate"], "3")
            self.assertEqual(len(candidates), 6)
            self.assertEqual(select_candidate_observations_v5(candidates), 3)
            expected = sha256(canonical_json({"prompts": prompt_manifest(portrait_prompts(40, 48, 5)), "strategy": PROMPT_STRATEGY_V5}))
            self.assertEqual(response.headers["X-SF-Prompt-SHA256"], expected)
        prompts = self.engine.prompt_sets
        self.assertEqual(len(prompts), 2)
        self.assertNotIn("points", prompts[0])
        self.assertEqual(prompts[1]["point_labels"], [1, 1, 1])
        np.testing.assert_allclose(prompts[1]["point_coords"], [(19.5, 7.52), (19.5, 18.8), (19.5, 33.84)])

    def test_v5_quality_failure_is_explicit_and_does_not_replay_the_operation(self):
        operation = str(uuid.uuid4())
        with mock.patch.object(self.engine, "segment_v5", side_effect=ForegroundQualityError("rejected")):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(self.request(path="/v2/segment", operation=operation))
            self.assertEqual(caught.exception.code, 422)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.request(path="/v2/segment", operation=operation))
        self.assertEqual(caught.exception.code, 409)

    def test_v6_capability_and_source_bound_background_do_not_change_v5(self):
        request = urllib.request.Request(self.url + "/v3/capabilities", headers={"Origin": ORIGIN})
        with urllib.request.urlopen(request) as response:
            capability = json.loads(response.read())
        self.assertEqual(capability["version"], 3)
        self.assertEqual(capability["algorithm"], ALGORITHM_V6)
        self.assertEqual(capability["backgroundRule"], NEUTRAL_BACKGROUND_RULE)
        self.assertEqual(capability["qualityGate"], QUALITY_GATE_V6)
        rgb, expected, raw = neutral_fixture(2)
        with urllib.request.urlopen(self.request(raw=raw, width=32, height=40, path="/v3/segment")) as response:
            pixels = np.asarray(Image.open(io.BytesIO(response.read())).convert("RGBA"))
            self.assertEqual(response.headers["X-SF-Algorithm"], ALGORITHM_V6)
            self.assertEqual(response.headers["X-SF-Matting-Method"], MATTING_METHOD_V6)
            self.assertEqual(response.headers["X-SF-Prompt-Strategy"], PROMPT_STRATEGY_V5)
            evidence = json.loads(response.headers["X-SF-Neutral-Background"])
            self.assertEqual(evidence["floodPixelCount"], 840)
            self.assertEqual(evidence["removedMaskPixelCount"], 72)
            self.assertEqual(evidence["floodMaskSha256"], sha256(expected.astype(np.uint8).tobytes()))
            self.assertEqual(response.headers["X-SF-Source-Pixel-SHA256"], sha256(rgb.tobytes()))
            np.testing.assert_array_equal(pixels[:, :, 3], (~expected).astype(np.uint8) * 255)

    def test_v6_rejects_dishonest_statistics_and_opaque_connected_background(self):
        _rgb, _expected, raw = neutral_fixture(2)
        real = self.engine.segment_v6
        for corruption in ("flood", "alpha", "excess"):
            def corrupt(*args):
                result = list(real(*args))
                if corruption == "flood":
                    result[6]["floodPixelCount"] -= 1
                elif corruption == "excess":
                    result[6]["removedMaskPixelCount"] = int(round(result[0].size * 0.4) * 0.15) + 1
                else:
                    result[0][0, 0] = 255
                    result[3] = float(np.mean(result[0] >= 128))
                return result
            with self.subTest(corruption=corruption), mock.patch.object(self.engine, "segment_v6", side_effect=corrupt):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(self.request(raw=raw, width=32, height=40, path="/v3/segment"))
                self.assertEqual(caught.exception.code, 500)

    def test_v6_rejects_unstable_background_before_inference(self):
        before = self.engine.calls
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.request(path="/v3/segment"))
        self.assertEqual(caught.exception.code, 422)
        self.assertEqual(self.engine.calls, before)

    def test_v5_preserves_existing_alpha_by_rejecting_it_before_model_inference(self):
        image = Image.new("RGBA", (40, 48), (100, 110, 120, 255))
        image.putpixel((0, 0), (90, 80, 70, 0))
        target = io.BytesIO(); image.save(target, format="PNG")
        before = self.engine.calls
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.request(raw=target.getvalue(), path="/v2/segment"))
        self.assertEqual(caught.exception.code, 400)
        self.assertEqual(self.engine.calls, before)

    def test_bad_source_hash_is_rejected_before_model_call(self):
        before = self.engine.calls
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.request(digest="0" * 64))
        self.assertEqual(caught.exception.code, 400)
        self.assertEqual(self.engine.calls, before)

    def test_unauthorized_origin_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.request(origin="https://example.invalid"))
        self.assertEqual(caught.exception.code, 403)

    def test_explicit_extra_loopback_origin_is_allowed_and_remote_origins_stay_rejected(self):
        extra_origin = "http://127.0.0.1:5206"
        server = ForegroundHTTPServer(("127.0.0.1", 0), FakeEngine(), ALLOWED_ORIGINS.union({extra_origin}))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/v1/capabilities", headers={"Origin": extra_origin})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], extra_origin)
            denied = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/v1/capabilities",
                                            headers={"Origin": "http://127.0.0.1:5207"})
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(denied)
            self.assertEqual(caught.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_extra_origin_parser_accepts_only_canonical_loopback_http(self):
        self.assertEqual(parse_loopback_origin("http://localhost:5206"), "http://localhost:5206")
        for value in ("https://127.0.0.1:5206", "http://example.invalid:5206", "http://127.0.0.1:5206/",
                      "http://user@127.0.0.1:5206", "http://127.0.0.1"):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                parse_loopback_origin(value)

    def test_operation_id_cannot_be_replayed(self):
        operation = str(uuid.uuid4())
        with urllib.request.urlopen(self.request(operation=operation)):
            pass
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.request(operation=operation))
        self.assertEqual(caught.exception.code, 409)

    def test_claimed_dimensions_must_match_decoded_image(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.request(declared_width=41))
        self.assertEqual(caught.exception.code, 400)


class NeutralBackgroundTests(unittest.TestCase):
    def test_shared_topology_fixture_preserves_enclosed_colour_and_skin(self):
        rgb, expected, _raw = neutral_fixture()
        flood, observation = derive_neutral_background_v1(rgb)
        np.testing.assert_array_equal(flood, expected)
        self.assertEqual(observation, {"rule": NEUTRAL_BACKGROUND_RULE, "median": [229., 228., 229.],
                                      "borderP99Deviation": 0., "radius": 8, "borderCoverage": 1.,
                                      "floodPixelCount": 210, "floodMaskSha256": sha256(expected.astype(np.uint8).tobytes())})

    def test_non_neutral_unstable_empty_and_invalid_rasters_are_rejected(self):
        rgb, _expected, _raw = neutral_fixture()
        unstable = rgb.copy(); unstable[0] = 255
        for source in (np.full(rgb.shape, [255, 0, 255], dtype=np.uint8), unstable,
                       np.full(rgb.shape, [229, 228, 229], dtype=np.uint8)):
            with self.subTest(source=source[0, 0]), self.assertRaises(ForegroundQualityError):
                derive_neutral_background_v1(source)
        with self.assertRaises(ValueError):
            derive_neutral_background_v1(rgb.astype(np.float64))


class PortraitMaskSelectionTests(unittest.TestCase):
    @staticmethod
    def predictor(scores):
        class Predictor:
            def __init__(self):
                self.calls = []

            def predict(self, **kwargs):
                index = len(self.calls)
                self.calls.append(kwargs)
                masks = np.full((3, 40, 48), -1, dtype=np.float32)
                for mask, ratio in zip(masks, ([0.30, 0.01, 0.02] if index == 0 else [0.40, 0.25, 0.35])):
                    mask.flat[:round(mask.size * ratio)] = 1
                return masks, np.asarray(scores[index], dtype=np.float32), None
        return Predictor()

    def test_v5_ignores_high_scored_fragments_and_records_all_six_candidates(self):
        predictor = self.predictor([[0.65, 0.99, 0.98], [0.92, 0.80, 0.86]])
        mask, score, selection = select_portrait_mask(predictor, portrait_prompts(48, 40, 5), (40, 48), 5)
        self.assertAlmostEqual(score, 0.92, places=6)
        self.assertEqual(selection["selectedCandidateIndex"], 3)
        self.assertEqual(len(selection["candidates"]), 6)
        self.assertAlmostEqual(float(np.mean(mask > 0)), 0.4)
        self.assertNotIn("point_coords", predictor.calls[0])
        np.testing.assert_array_equal(predictor.calls[1]["point_labels"], [1, 1, 1])

    def test_v5_rejects_all_low_confidence_masks_and_keeps_first_eligible_tie(self):
        predictor = self.predictor([[0.65, 0.99, 0.98], [0.74, 0.70, 0.72]])
        with self.assertRaises(ForegroundQualityError):
            select_portrait_mask(predictor, portrait_prompts(48, 40, 5), (40, 48), 5)
        candidates = [{"promptIndex": i // 3, "maskIndex": i % 3, "score": 0.9, "maskCoverage": 0.3} for i in range(6)]
        self.assertEqual(select_candidate_observations_v5(candidates), 0)
        candidates[0].update(score=0.81, maskCoverage=0.6)
        self.assertEqual(select_candidate_observations_v5(candidates), 0)
        candidates[0]["unexpected"] = True
        with self.assertRaises(RuntimeError):
            select_candidate_observations_v5(candidates)

    def test_v4_retains_its_original_single_box_choice(self):
        predictor = self.predictor([[0.65, 0.99, 0.98]])
        mask, score, selection = select_portrait_mask(predictor, portrait_prompts(48, 40), (40, 48), 4)
        self.assertAlmostEqual(score, 0.99, places=6)
        self.assertIsNone(selection)
        self.assertAlmostEqual(float(np.mean(mask > 0)), 0.01, places=2)
        self.assertEqual(len(predictor.calls), 1)


if __name__ == "__main__":
    unittest.main()
