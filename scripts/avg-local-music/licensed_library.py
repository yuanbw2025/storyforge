"""Read pinned original CC0 members, without extraction or conversion.

No network/download, model, Work access or author adoption. Catalogue identity
is metadata; actual serving separately verifies archive, licence and member.
"""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import stat
import zipfile

from runtime_guard import sha256, unique_fields

CATALOGUE = Path(__file__).with_name("library-source.json")
PUBLISHER_CATALOGUE = Path(__file__).with_name("publisher-library-source.json")


def catalogue():
    value = json.loads(CATALOGUE.read_text(), object_pairs_hook=unique_fields)
    if value["schema"] != "storyforge.avg.licensed-audio-catalogue" or value["version"] != 1:
        raise ValueError("Reviewed catalogue required")
    return value


def publisher_catalogue():
    value = json.loads(PUBLISHER_CATALOGUE.read_text(), object_pairs_hook=unique_fields)
    if (value["schema"] != "storyforge.avg.publisher-audio-catalogue" or value["version"] != 2
            or value["license"] != "CC0-1.0"):
        raise ValueError("Reviewed original publisher catalogue required")
    return value


def original_file(directory, name, size, digest, maximum):
    if not isinstance(name, str) or Path(name).name != name or name in ("", ".", "..") or "\\" in name:
        raise ValueError("Safe original source file name required")
    path = directory / name
    if (path.is_symlink() or not path.is_file() or not 0 < size <= maximum
            or path.stat().st_size != size or sha256(path) != digest):
        raise ValueError("Reviewed original source bytes differ")
    return path


class OriginalPublisherLinks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = set()

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links.update(value for key, value in attrs if key == "href")


def original_publisher_licence(directory, evidence):
    if evidence["kind"] != "publisher-page":
        raise ValueError("Explicit publisher-page licence witness required")
    page = original_file(directory, evidence["publisherPageFile"], evidence["publisherPageBytes"],
                         evidence["publisherPageHash"], 128 * 1024)
    parser = OriginalPublisherLinks()
    parser.feed(page.read_bytes().decode("utf-8"))
    if not {evidence["authorPath"], evidence["licenseUrl"], evidence["downloadUrl"]} <= parser.links:
        raise ValueError("Original publisher, licence and download links differ")
    # The official CC0 text is an external reference, never a fabricated
    # License.txt member inside the publisher's original archive.
    legal = original_file(directory, evidence["legalCodeFile"], evidence["legalCodeBytes"],
                          evidence["legalCodeHash"], 128 * 1024)
    legal.read_bytes().decode("utf-8")
    return evidence


def original_member(directory, archive_hash, member_hash):
    if directory is None:
        raise ValueError("Explicit original archive directory not configured")
    sources = catalogue()
    archives = [a for a in sources["archives"] if a["archiveHash"] == archive_hash]
    version = 1
    if not archives:
        sources = publisher_catalogue()
        archives = [a for a in sources["archives"] if a["archiveHash"] == archive_hash]
        version = 2
    if len(archives) != 1:
        raise ValueError("Unknown reviewed archive")
    archive = archives[0]
    members = [m for m in archive["members"] if m["memberHash"] == member_hash]
    if len(members) != 1:
        raise ValueError("Unknown or ambiguous original member")
    member = members[0]
    path = original_file(directory, archive["archiveFile"] if version == 2 else archive["key"] + ".zip",
                         archive["archiveBytes"], archive_hash, 32 * 1024**2)
    licence_evidence = original_publisher_licence(directory, archive["licenseEvidence"]) if version == 2 else None
    with zipfile.ZipFile(path) as source:
        entries = source.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 500 or len(set(names)) != len(names) or sum(e.file_size for e in entries) > 128 * 1024**2:
            raise ValueError("Bounded unique archive inventory required")
        for entry in entries:
            name = entry.filename.rstrip("/")
            if (not name or name.startswith("/") or "\\" in name or any(p in ("", ".", "..") for p in name.split("/"))
                    or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1):
                raise ValueError("Unsafe original archive inventory")
        if version == 1:
            licence = source.read(archive["licenseMember"])
            if hashlib.sha256(licence).hexdigest() != archive["licenseHash"] or licence.decode("utf-8") != archive["licenseText"]:
                raise ValueError("Original included licence differs")
        if (version == 1 and not member["memberPath"].startswith("Audio/")) or not 1 <= member["bytes"] <= 4 * 1024**2:
            raise ValueError("Only bounded original audio, not demonstration mixes")
        data = source.read(member["memberPath"])
    if len(data) != member["bytes"] or hashlib.sha256(data).hexdigest() != member_hash or not data.startswith(b"OggS"):
        raise ValueError("Original OGG bytes differ")
    result = {"schema": "storyforge.avg.licensed-audio-result", "version": version,
        "publisherPage": archive["publisherPage"], "license": sources["license"], "archiveHash": archive_hash,
        "archiveBytes": archive["archiveBytes"],
        **({"publisher": archive["publisher"], "licenseEvidence": licence_evidence} if version == 2 else
           {"licenseMember": archive["licenseMember"], "licenseHash": archive["licenseHash"], "licenseText": archive["licenseText"]}),
        **member, "inferenceCalls": 0, "supplierCostUsd": 0,
        "originalBytes": True, "transcoded": False, "hearing": "unobserved", "authorAdopted": False}
    return data, result
