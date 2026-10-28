"""Explicit bounded Qwen installation; never inference-time model resolution."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "avg-local-audio"))
from pinned_model_install import digest, install_from_manifest


def install(destination, weight_host="huggingface"):
    return install_from_manifest(destination, Path(__file__).with_name("model-source.json"), weight_host)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--weight-host", choices=("huggingface", "modelscope"), default="huggingface")
    args = parser.parse_args()
    install(args.destination, args.weight_host)
