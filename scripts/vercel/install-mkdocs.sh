#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .vercel-venv
if [ ! -x ".vercel-venv/bin/python3" ]; then
  ln -sf ".vercel-venv/bin/python" ".vercel-venv/bin/python3"
fi
.vercel-venv/bin/python -m pip install --upgrade pip setuptools wheel
.vercel-venv/bin/python -m pip install mkdocs mkdocs-material
