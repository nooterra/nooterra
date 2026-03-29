---
title: "MCP Server Integration"
description: "How to use Nooterra as an MCP server with Claude Desktop, Cursor, and other MCP hosts."
---

# MCP Server Integration

Nooterra ships an MCP (Model Context Protocol) server that exposes worker management as tools. Add it to any MCP-compatible client and say "create a nooterra worker that monitors competitor prices" -- it just works.

No global install needed. The server runs via `npx`.

---

## Quick Start

Add this to your MCP client's config:

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

See [Claude Desktop](./claude-desktop.md) and [Cursor](./cursor.md) for client-specific setup.

---

## Server Details

| Property | Value |
|----------|-------|
| Server name | `nooterra` |
| Protocol version | `2024-11-05` |
| Transport | STDIO (JSON-RPC 2.0 over stdin/stdout) |
| Entry point | `npx nooterra mcp` |

Diagnostic output goes to stderr to avoid corrupting the wire protocol.

---

## Available Tools

The MCP server exposes 10 tools:

### `nooterra_create_worker`

Create a worker from a natural language description.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | `string` | Yes | Natural language description of what the worker should do |

**Returns:** `workerId`, `name`, `capabilities`, `schedule`, `charterSummary`.

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

Execute a worker immediately. May take 10-30 seconds.

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

Connect a tool/integration to Nooterra.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool` | `string` | Yes | Tool ID (e.g., `browser`, `slack`, `github`, `email`, `filesystem`, `search`) |

**Returns:** `{ status, needsAuth, instructions }`.

### `nooterra_list_tools`

List all available tools/integrations and whether they are connected.

No parameters.

**Returns:** Array of `{ id, name, description, ready, needsAuth }`.

### `nooterra_daemon_status`

Check if the background daemon is running.

No parameters.

**Returns:** `{ running, pid, uptime, workers, nextScheduledRun }`.

### `nooterra_templates`

List all available worker templates.

No parameters.

**Returns:** Array of `{ id, name, description, icon }`.

---

## JSON-RPC Protocol

Any MCP client that supports STDIO transport can connect. The server speaks JSON-RPC 2.0 over stdin/stdout.

### Start the server

```bash
npx nooterra mcp
```

### Get the manifest

```bash
npx nooterra mcp --manifest
```

### Supported methods

| Method | Description |
|--------|-------------|
| `initialize` | Returns server info, protocol version, and capabilities |
| `notifications/initialized` | Client acknowledgment (no response) |
| `tools/list` | Returns the full list of tools with input schemas |
| `tools/call` | Executes a tool by name with arguments |

### Example: Initialize

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

### Example: Call a tool

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

| Code | Meaning |
|------|---------|
| `-32700` | Parse error (invalid JSON) |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |

Tool execution errors return successful responses with `isError: true` in the result, following MCP conventions.

---

## Lifecycle

The server runs until stdin is closed or a `SIGINT`/`SIGTERM` signal is received. Lifecycle events are logged to stderr.
