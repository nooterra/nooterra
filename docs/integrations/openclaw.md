---
title: "OpenClaw"
description: "Use Nooterra workers from OpenClaw IDE."
---

# OpenClaw

Nooterra integrates with OpenClaw as an MCP plugin, exposing worker management tools directly in the IDE.

## Setup

Add Nooterra to your OpenClaw MCP configuration:

```json
{
  "mcpServers": {
    "nooterra": {
      "command": "npx",
      "args": ["-y", "nooterra", "mcp"]
    }
  }
}
```

Alternatively, go to **Extensions** in OpenClaw and search for "Nooterra".

## Usage

Once connected, Nooterra tools are available in OpenClaw's AI context:

- Create workers from descriptions
- Run workers and see results inline
- Manage worker charters
- View execution logs

## Configuration

The plugin connects to your Nooterra account. If you haven't signed up yet, go to [nooterra.ai/signup](https://nooterra.ai/signup) to get started.
