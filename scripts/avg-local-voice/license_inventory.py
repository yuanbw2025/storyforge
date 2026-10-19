"""Read the isolated runtime's actual versions and installed license notices."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path


def inventory():
    result = []
    for distribution in sorted(importlib.metadata.distributions(), key=lambda d: d.metadata["Name"].lower()):
        metadata, notices = distribution.metadata, []
        for file in distribution.files or []:
            if any(word in file.name.lower() for word in ("license", "copying", "notice")):
                path = Path(distribution.locate_file(file))
                if path.is_file():
                    notices.append({"path": str(file), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        result.append({"name": metadata["Name"], "version": metadata["Version"],
                       "licenseExpression": metadata.get("License-Expression"),
                       "license": metadata.get("License"),
                       "classifiers": [c for c in metadata.get_all("Classifier", []) if c.startswith("License")],
                       "notices": notices})
    return {"schema": "storyforge.avg.local-voice-license-inventory", "version": 1,
            "scope": "Installed package metadata and notices only; not a legal or training-data clearance",
            "distributions": result}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    destination = parser.parse_args().output
    if destination.exists():
        parser.error("preserve existing evidence; choose a new output file")
    destination.write_text(json.dumps(inventory(), ensure_ascii=False, indent=2) + "\n")
