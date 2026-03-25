---
title: "OpenClaw"
description: "Use Nooterra workers from OpenClaw IDE."
---

# OpenClaw

Nooterra integrates with OpenClaw as a plugin, exposing worker management tools directly in the IDE.

## Setup

1. Install Nooterra:

```bash
npm install -g nooterra
```

2. In OpenClaw, go to **Extensions** and search for "Nooterra".

3. Install the Nooterra extension. It reads the `openclaw.plugin.json` from the Nooterra package automatically.

## Usage

Once installed, Nooterra tools are available in OpenClaw's AI context:

- Create workers from descriptions
- Run workers and see results inline
- Manage worker charters
- View execution logs

## Configuration

The OpenClaw plugin uses the same credentials stored in `~/.nooterra/credentials/`. Set up a provider by running `nooterra` in your terminal first.
