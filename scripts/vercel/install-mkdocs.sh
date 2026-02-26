#!/usr/bin/env bash
set -euo pipefail

PIP_FLAGS=()
if python3 -m pip help install 2>/dev/null | grep -q -- "--break-system-packages"; then
  PIP_FLAGS+=(--break-system-packages)
fi

python3 -m pip install "${PIP_FLAGS[@]}" --upgrade pip setuptools wheel
python3 -m pip install "${PIP_FLAGS[@]}" mkdocs mkdocs-material
