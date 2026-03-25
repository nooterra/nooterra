---
title: "MCP Server Integration"
description: "How to use Nooterra as an MCP server with Claude Desktop, Cursor, and other MCP hosts."
---

# MCP Server Integration

Nooterra ships an MCP (Model Context Protocol) server that exposes worker management as tools. Add it to Claude Desktop, Cursor, or any MCP-compatible client and say "create a nooterra worker that monitors competitor prices" -- it just works.

---

## Server Details

| Property | Value |
|----------|-------|
| Server name | `nooterra` |
| Version | `0.4.0` |
| Protocol version | `2024-11-05` |
| Transport | STDIO (JSON-RPC 2.0 over stdin/stdout) |
| Entry point | `node scripts/worker-builder/mcp-server.mjs` |

Diagnostic output goes to stderr to avoid corrupting the wire protocol.

---

## Available Tools

The MCP server exposes 10 tools:

### `nooterra_create_worker`

Create a worker from a natural language description.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | `string` | Yes | Natural language description of what the worker should do |

**Returns:** `workerId`, `name`, `capabilities`, `schedule`, `charterSummary` (with `purpose`, `canDo`, `askFirst`, `neverDo`).

**Example input:**
```
"monitor competitor prices every hour and alert me on Slack"
```

### `nooterra_create_from_template`

Create a worker from a pre-built template.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `template` | `string` (enum) | Yes | Template ID |

**Valid values:** `price-monitor`, `inbox-triage`, `standup-summarizer`, `competitor-watcher`, `pr-reviewer`, `social-monitor`

**Returns:** `workerId`, `name`, `charterSummary`.

### `nooterra_list_workers`

List all workers with status, provider, capabilities, and run stats.

No parameters.

**Returns:** Array of `{ id, name, status, provider, capabilities, lastRun, totalRuns }`.

### `nooterra_run_worker`

Execute a worker immediately. Calls the AI provider and runs the worker's tools. May take 10-30 seconds.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `worker` | `string` | Yes | Worker name or ID |

**Returns:** `{ success, taskId, duration, toolCalls, response }`.

### `nooterra_worker_logs`

Get execution history for a worker.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `worker` | `string` | Yes | Worker name or ID |
| `limit` | `number` | No | Max entries to return (default: 20) |

**Returns:** Array of `{ taskId, success, duration, completedAt, toolCallCount }`.

### `nooterra_worker_status`

Get detailed status including charter, provider, run history, and next scheduled run.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `worker` | `string` | Yes | Worker name or ID |

**Returns:** `{ id, name, status, charter, provider, model, lastRun, totalRuns, nextScheduledRun }`.

### `nooterra_add_tool`

Connect a tool/integration to Nooterra. Returns what credentials are needed and setup instructions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool` | `string` | Yes | Tool ID (e.g., `browser`, `slack`, `github`, `email`, `filesystem`, `search`) |

**Returns:** `{ status, needsAuth, instructions }` where status is `"ready"` or `"needs_setup"`.

### `nooterra_list_tools`

List all available tools/integrations and whether they are connected.

No parameters.

**Returns:** Array of `{ id, name, description, ready, needsAuth }`.

### `nooterra_daemon_status`

Check if the background daemon is running. The daemon executes scheduled workers automatically.

No parameters.

**Returns:** `{ running, pid, uptime, workers, nextScheduledRun }`.

### `nooterra_templates`

List all available worker templates.

No parameters.

**Returns:** Array of `{ id, name, description, icon }`.

---

## Setup for Claude Desktop

Add the following to your Claude Desktop MCP configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**Linux:** `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "nooterra": {
      "command": "node",
      "args": ["/absolute/path/to/nooterra/scripts/worker-builder/mcp-server.mjs"]
    }
  }
}
```

Replace `/absolute/path/to/nooterra` with the actual path to your Nooterra installation.

After saving, restart Claude Desktop. You can then say things like:

- "Create a worker that monitors competitor prices every hour"
- "List my workers"
- "Run the Price Monitor worker"
- "What templates are available?"

---

## Setup for Cursor

Add the server to your Cursor MCP settings. Open **Settings > MCP Servers** and add:

```json
{
  "nooterra": {
    "command": "node",
    "args": ["/absolute/path/to/nooterra/scripts/worker-builder/mcp-server.mjs"]
  }
}
```

Or add it to your project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nooterra": {
      "command": "node",
      "args": ["./scripts/worker-builder/mcp-server.mjs"]
    }
  }
}
```

---

## Setup for Generic MCP Hosts

Any MCP client that supports STDIO transport can connect to Nooterra. The server speaks JSON-RPC 2.0 over stdin/stdout.

### Start the server

```bash
node scripts/worker-builder/mcp-server.mjs
```

### Get the manifest

```bash
node scripts/worker-builder/mcp-server.mjs --manifest
```

This prints a JSON manifest with server name, version, description, transport type, command, args, and tool summaries.

### JSON-RPC protocol

The server handles these MCP methods:

| Method | Description |
|--------|-------------|
| `initialize` | Returns server info, protocol version, and capabilities |
| `notifications/initialized` | Client acknowledgment (no response) |
| `tools/list` | Returns the full list of tools with input schemas |
| `tools/call` | Executes a tool by name with arguments |

**Example: Initialize**

```json
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "tools": {} },
    "serverInfo": { "name": "nooterra", "version": "0.4.0" }
  }
}
```

**Example: List tools**

```json
{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
```

**Example: Call a tool**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "nooterra_create_worker",
    "arguments": {
      "description": "monitor competitor prices every hour and alert me on Slack"
    }
  }
}
```

### Error codes

The server uses standard JSON-RPC error codes:

| Code | Meaning |
|------|---------|
| `-32700` | Parse error (invalid JSON) |
| `-32600` | Invalid request (missing jsonrpc or method) |
| `-32601` | Method not found |
| `-32602` | Invalid params (unknown tool name) |
| `-32603` | Internal error |

Tool execution errors are returned as successful responses with `isError: true` in the result, following MCP conventions.

---

## Lifecycle

The server runs until stdin is closed or a `SIGINT`/`SIGTERM` signal is received. It logs lifecycle events to stderr:

```
[nooterra-mcp] Starting MCP server on stdio...
[nooterra-mcp] MCP server ready.
[nooterra-mcp] stdin closed, shutting down.
```
