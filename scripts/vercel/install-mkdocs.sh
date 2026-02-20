#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .vercel-venv
.vercel-venv/bin/python -m pip install --upgrade pip setuptools wheel
.vercel-venv/bin/pip install mkdocs mkdocs-material
