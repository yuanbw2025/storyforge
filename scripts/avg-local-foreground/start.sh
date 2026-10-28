#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AVG_FOREGROUND_HOME="$HOME/.local/share/storyforge/avg-local-foreground"
AVG_SAM2_MODEL_DIR="$AVG_FOREGROUND_HOME/models" \
AVG_SAM2_SOURCE_DIR="$AVG_FOREGROUND_HOME/sam2-source" \
  exec "$AVG_FOREGROUND_HOME/venv/bin/python" "$REPO_ROOT/scripts/avg-local-foreground/server.py" "$@"
