---
title: "MCP Setup"
description: "Use Nooterra from Claude Desktop, Cursor, or any MCP-compatible client."
---

# MCP Setup

Nooterra exposes worker management tools via the Model Context Protocol (MCP). This lets you create, run, and manage workers from Claude Desktop, Cursor, or any MCP-compatible AI tool.

## Quick setup

Add this to your MCP client's configuration:

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

No global install needed — `npx` handles everything.

## Client-specific guides

- [Claude Desktop setup](/integrations/claude-desktop)
- [Cursor setup](/integrations/cursor)
- [Other MCP clients](/integrations/mcp-servers)

## What you can do

Once connected, your AI tool can:

| Tool | Description |
|---|---|
| `create_worker` | Create a new worker from a description |
| `list_workers` | List all workers and their status |
| `run_worker` | Execute a worker on demand |
| `get_worker` | Get full worker details including charter |
| `update_worker` | Modify a worker's charter or settings |
| `delete_worker` | Remove a worker |

## Requirements

- Node.js 20+
- A Nooterra account at [nooterra.ai](https://nooterra.ai)
