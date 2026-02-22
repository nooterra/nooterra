#!/usr/bin/env bash
set -euo pipefail

python3 -m pip install --break-system-packages --upgrade pip setuptools wheel
python3 -m pip install --break-system-packages mkdocs mkdocs-material
