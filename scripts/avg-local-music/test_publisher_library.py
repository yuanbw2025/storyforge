"""Controlled protocol fixtures, not actual licence, decoder or hearing proof."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

from licensed_library import original_member


class PublisherLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = b"OggS explicit protocol fixture; not decoded audio"
        self.page = b'<a href="/users/original-author">author</a><a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a><a href="https://example.invalid/original.zip">original</a>'
        self.legal = b"Controlled CC0 reference fixture, not an actual publisher licence"
        (self.root / "page.html").write_bytes(self.page)
        (self.root / "cc0.txt").write_bytes(self.legal)
        with zipfile.ZipFile(self.root / "original.zip", "w") as z:
            z.writestr("rain.ogg", self.data)
        digest = lambda b: hashlib.sha256(b).hexdigest()
        self.member = {"sourceKey": "fixture.original.rain", "memberPath": "rain.ogg", "memberHash": digest(self.data),
                       "bytes": len(self.data), "mimeType": "audio/ogg"}
        self.archive = {"key": "fixture", "publisher": "original-author", "publisherPage": "https://example.invalid/original",
            "archiveFile": "original.zip", "archiveBytes": (self.root / "original.zip").stat().st_size,
            "archiveHash": digest((self.root / "original.zip").read_bytes()), "members": [self.member],
            "licenseEvidence": {"kind": "publisher-page", "publisherPageFile": "page.html", "publisherPageBytes": len(self.page),
                "publisherPageHash": digest(self.page), "authorPath": "/users/original-author",
                "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/", "downloadUrl": "https://example.invalid/original.zip",
                "legalCodeFile": "cc0.txt", "legalCodeUrl": "https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt",
                "legalCodeBytes": len(self.legal), "legalCodeHash": digest(self.legal)}}
        self.catalogue = {"schema": "storyforge.avg.publisher-audio-catalogue", "version": 2,
                          "license": "CC0-1.0", "archives": [self.archive]}

    def tearDown(self):
        self.temp.cleanup()

    def read(self):
        with patch("licensed_library.catalogue", return_value={"archives": []}), patch("licensed_library.publisher_catalogue", return_value=self.catalogue):
            return original_member(self.root, self.archive["archiveHash"], self.member["memberHash"])

    def test_preserves_original_root_member_with_explicit_external_witness_and_no_fabricated_archive_licence(self):
        before = (self.root / "original.zip").read_bytes()
        data, receipt = self.read()
        self.assertEqual(data, self.data)
        self.assertEqual(receipt["version"], 2)
        self.assertEqual(receipt["publisher"], "original-author")
        self.assertEqual(receipt["licenseEvidence"], self.archive["licenseEvidence"])
        self.assertNotIn("licenseMember", receipt)
        self.assertNotIn("licenseText", receipt)
        self.assertEqual(receipt["inferenceCalls"], 0)
        self.assertEqual(receipt["supplierCostUsd"], 0)
        self.assertFalse(receipt["transcoded"])
        self.assertFalse(receipt["authorAdopted"])
        self.assertEqual(receipt["hearing"], "unobserved")
        self.assertEqual((self.root / "original.zip").read_bytes(), before)
        with zipfile.ZipFile(self.root / "original.zip") as z:
            self.assertEqual(z.namelist(), ["rain.ogg"])

    def test_rejects_changed_missing_or_symlinked_publisher_page(self):
        page = self.root / "page.html"
        page.write_bytes(self.page + b"changed")
        with self.assertRaises(ValueError): self.read()
        page.unlink()
        with self.assertRaises(ValueError): self.read()
        (self.root / "other.html").write_bytes(self.page)
        page.symlink_to(self.root / "other.html")
        with self.assertRaises(ValueError): self.read()

    def test_rejects_changed_or_missing_external_legal_code_without_repacking_archive(self):
        legal = self.root / "cc0.txt"
        legal.write_bytes(self.legal + b"changed")
        with self.assertRaises(ValueError): self.read()
        legal.unlink()
        with self.assertRaises(ValueError): self.read()

    def test_does_not_accept_a_rehashed_page_without_original_author_licence_and_download_links(self):
        for link in [b"/users/original-author", b"https://creativecommons.org/publicdomain/zero/1.0/", b"https://example.invalid/original.zip"]:
            page = self.page.replace(link, b"https://example.invalid/unrelated")
            (self.root / "page.html").write_bytes(page)
            evidence = self.archive["licenseEvidence"]
            evidence["publisherPageBytes"], evidence["publisherPageHash"] = len(page), hashlib.sha256(page).hexdigest()
            with self.assertRaisesRegex(ValueError, "links differ"): self.read()

    def test_rejects_unsafe_external_locator_even_when_replacement_bytes_would_match(self):
        for key, value in [("publisherPageFile", "../page.html"), ("legalCodeFile", "/cc0.txt")]:
            original = self.archive["licenseEvidence"][key]
            self.archive["licenseEvidence"][key] = value
            with self.assertRaises(ValueError): self.read()
            self.archive["licenseEvidence"][key] = original
        self.archive["archiveFile"] = "../original.zip"
        with self.assertRaises(ValueError): self.read()

    def test_rejects_rehashed_traversal_and_duplicate_members_before_returning_any_original_audio(self):
        for unsafe in ["../escape.ogg", "rain.ogg"]:
            with zipfile.ZipFile(self.root / "original.zip", "w") as z, warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                z.writestr("rain.ogg", self.data)
                z.writestr(unsafe, self.data)
            raw = (self.root / "original.zip").read_bytes()
            self.archive["archiveHash"], self.archive["archiveBytes"] = hashlib.sha256(raw).hexdigest(), len(raw)
            with self.assertRaises(ValueError): self.read()

    def test_rejects_changed_archive_and_member_metadata(self):
        original = copy.deepcopy(self.archive)
        for key, value in [("bytes", len(self.data) + 1), ("memberPath", "different.ogg")]:
            self.member[key] = value
            with self.assertRaises((ValueError, KeyError)): self.read()
            self.member.clear(); self.member.update(original["members"][0])
        (self.root / "original.zip").write_bytes((self.root / "original.zip").read_bytes() + b"changed")
        with self.assertRaises(ValueError): self.read()

    def test_same_http_library_route_serves_external_witness_and_explicitly_refuses_changed_source_without_inference(self):
        from test_local_server import serve, call
        path = f'/v1/library/audio/{self.archive["archiveHash"]}/{self.member["memberHash"]}'
        with patch("licensed_library.catalogue", return_value={"archives": []}), patch("licensed_library.publisher_catalogue", return_value=self.catalogue), \
                patch("server.subprocess.Popen") as spawn, serve(self.root) as server:
            server.library = self.root
            status, headers, data = call(server, "GET", path)
            self.assertEqual(status, 200); self.assertEqual(data, self.data)
            result = json.loads(headers["x-storyforge-library-result"])
            self.assertEqual(result["version"], 2); self.assertEqual(result["licenseEvidence"], self.archive["licenseEvidence"])
            self.assertNotIn("licenseMember", result); self.assertEqual(result["inferenceCalls"], 0)
            (self.root / "page.html").write_bytes(self.page + b"changed")
            self.assertEqual(call(server, "GET", path)[0], 409)
            spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
