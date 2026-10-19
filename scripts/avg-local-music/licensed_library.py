"""Read pinned original Kenney CC0 members, without extraction or conversion.

No network/download, model, Work access or author adoption. Catalogue identity
is metadata; actual serving separately verifies archive, licence and member.
"""
import hashlib
import json
from pathlib import Path
import stat
import zipfile

from runtime_guard import sha256, unique_fields

CATALOGUE = Path(__file__).with_name("library-source.json")


def catalogue():
    value = json.loads(CATALOGUE.read_text(), object_pairs_hook=unique_fields)
    if value["schema"] != "storyforge.avg.licensed-audio-catalogue" or value["version"] != 1:
        raise ValueError("Reviewed catalogue required")
    return value


def original_member(directory, archive_hash, member_hash):
    if directory is None:
        raise ValueError("Explicit original archive directory not configured")
    sources = catalogue()
    archives = [a for a in sources["archives"] if a["archiveHash"] == archive_hash]
    if len(archives) != 1:
        raise ValueError("Unknown reviewed archive")
    archive = archives[0]
    members = [m for m in archive["members"] if m["memberHash"] == member_hash]
    if len(members) != 1:
        raise ValueError("Unknown or ambiguous original member")
    member = members[0]
    path = directory / (archive["key"] + ".zip")
    if path.is_symlink() or not path.is_file() or path.stat().st_size != archive["archiveBytes"] or sha256(path) != archive_hash:
        raise ValueError("Reviewed original archive bytes differ")
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
        licence = source.read(archive["licenseMember"])
        if hashlib.sha256(licence).hexdigest() != archive["licenseHash"] or licence.decode("utf-8") != archive["licenseText"]:
            raise ValueError("Original included licence differs")
        if not member["memberPath"].startswith("Audio/") or not 1 <= member["bytes"] <= 4 * 1024**2:
            raise ValueError("Only bounded original audio, not demonstration mixes")
        data = source.read(member["memberPath"])
    if len(data) != member["bytes"] or hashlib.sha256(data).hexdigest() != member_hash or not data.startswith(b"OggS"):
        raise ValueError("Original OGG bytes differ")
    result = {"schema": "storyforge.avg.licensed-audio-result", "version": 1,
        "publisherPage": archive["publisherPage"], "license": sources["license"], "archiveHash": archive_hash,
        "archiveBytes": archive["archiveBytes"], "licenseMember": archive["licenseMember"], "licenseHash": archive["licenseHash"],
        "licenseText": archive["licenseText"], **member, "inferenceCalls": 0, "supplierCostUsd": 0,
        "originalBytes": True, "transcoded": False, "hearing": "unobserved", "authorAdopted": False}
    return data, result
