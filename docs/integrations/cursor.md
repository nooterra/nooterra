---
title: "Cursor"
description: "Use Nooterra workers from Cursor via MCP."
---

# Cursor

Use Nooterra as an MCP server in Cursor. Create and manage workers while you code.

## Setup

1. Open Cursor Settings (Cmd+, or Ctrl+,) and go to **MCP Servers**.

2. Add a new server with this configuration:

```json
{
  "nooterra": {
    "command": "npx",
    "args": ["-y", "nooterra", "mcp"]
  }
}
```

Or add it to your project's `.cursor/mcp.json`:

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

3. Restart Cursor.

## Usage

In Cursor's AI chat, you can now reference Nooterra tools:

- "Create a nooterra worker that reviews my PRs"
- "List my nooterra workers"
- "Run my Data Monitor worker"

## Troubleshooting

**Cursor doesn't see Nooterra tools:**
- Make sure you restarted Cursor after adding the config
- Check that `npx nooterra mcp` works in your terminal
- Verify Node.js 20+ is installed: `node --version`
