---
title: "Cursor"
description: "Use Nooterra workers from Cursor via MCP."
---

# Cursor

Use Nooterra as an MCP server in Cursor. Create and manage workers while you code.

## Setup

1. Install Nooterra:

```bash
npm install -g nooterra
```

2. Open Cursor Settings (Cmd+, or Ctrl+,) and go to **MCP Servers**.

3. Add a new server with this configuration:

```json
{
  "nooterra": {
    "command": "npx",
    "args": ["-y", "nooterra", "mcp"]
  }
}
```

4. Restart Cursor.

## Usage

In Cursor's AI chat, you can now reference Nooterra tools:

- "Create a nooterra worker that reviews my PRs"
- "List my nooterra workers"
- "Run my Data Monitor worker"

## First-time Setup

The first time Nooterra runs via MCP, it uses whatever provider credentials you've configured. If you haven't set up a provider yet, run `nooterra` in your terminal first to complete onboarding.
