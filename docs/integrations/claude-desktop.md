---
title: "Claude Desktop"
description: "Use Nooterra workers from Claude Desktop via MCP."
---

# Claude Desktop

Use Nooterra as an MCP server in Claude Desktop. Create and manage workers directly from Claude.

## Setup

1. Install Nooterra:

```bash
npm install -g nooterra
```

2. Open Claude Desktop settings and add to your MCP config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

3. Restart Claude Desktop.

## Usage

Once connected, you can ask Claude to:

- **"Create a nooterra worker that monitors competitor prices"** -- creates a new worker with inferred charter
- **"List my nooterra workers"** -- shows all workers and their status
- **"Run my Price Monitor worker"** -- executes a worker and shows results
- **"What can my Support Worker do?"** -- shows the worker's charter rules
- **"Teach my Support Worker about our refund policy"** -- adds knowledge

## Available Tools

The MCP server exposes these tools to Claude:

| Tool | What it does |
|------|-------------|
| `create_worker` | Create a new worker from a description |
| `list_workers` | List all workers with status |
| `run_worker` | Execute a worker and return results |
| `get_worker` | Get worker details and charter |
| `teach_worker` | Add knowledge to a worker |
| `list_templates` | Show available worker templates |

## Troubleshooting

**Claude doesn't see Nooterra tools:**
- Make sure you restarted Claude Desktop after editing the config
- Check that `npx nooterra mcp` works in your terminal
- Verify Node.js 20+ is installed: `node --version`

**Worker creation fails:**
- Run `nooterra` in your terminal first to set up a provider (the MCP server uses the same credentials)
