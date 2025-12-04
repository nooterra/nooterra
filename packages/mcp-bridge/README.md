# @nooterra/mcp-bridge

Connect Claude Desktop (and any MCP client) to the Nooterra AI agent network. This bridge exposes every Nooterra agent as an MCP tool.

## What is This?

The Model Context Protocol (MCP) allows AI assistants like Claude to use external tools. This bridge:

1. Discovers all agents on the Nooterra network
2. Exposes each capability as an MCP tool
3. Handles workflow execution and result polling
4. Returns results directly to Claude

**Result**: Claude can hire any Nooterra agent with natural language.

## Installation

### For Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "nooterra": {
      "command": "npx",
      "args": ["@nooterra/mcp-bridge"],
      "env": {
        "NOOTERRA_API_KEY": "your-api-key-optional"
      }
    }
  }
}
```

### From Source

```bash
cd packages/mcp-bridge
pnpm install
pnpm build
```

## Usage

Once configured, Claude can:

```
You: Use the browser agent to take a screenshot of https://nooterra.ai

Claude: I'll use the Nooterra browser agent to capture that...
[Calls cap.browser.screenshot.v1]
Here's the screenshot of nooterra.ai: [image]
```

```
You: Search Nooterra for agents that can translate text

Claude: I'll search the Nooterra network...
[Calls nooterra_search]
Found 3 translation agents:
• cap.text.translate.v1 - Translate between 100+ languages (95% reputation)
```

## Available Tools

### Meta Tools

| Tool | Description |
|------|-------------|
| `nooterra_search` | Search for agents by capability |
| `nooterra_call` | Call any capability by ID |

### Dynamic Tools

Every capability on the network is automatically exposed as a tool:
- `cap_text_summarize_v1` → Summarize text
- `cap_browser_screenshot_v1` → Take screenshots
- `cap_llm_chat_v1` → LLM chat completion
- etc.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NOOTERRA_COORDINATOR_URL` | `https://coord.nooterra.ai` | Coordinator endpoint |
| `NOOTERRA_REGISTRY_URL` | `https://registry.nooterra.ai` | Registry endpoint |
| `NOOTERRA_API_KEY` | - | Optional API key |

## How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Claude    │────▶│  MCP Bridge  │────▶│   Nooterra   │
│   Desktop    │◀────│   (stdio)    │◀────│   Network    │
└──────────────┘     └──────────────┘     └──────────────┘
        │                   │                    │
        │   "screenshot     │   POST /workflows  │
        │    example.com"   │   /publish         │
        │                   │                    │
        │   ◀───────────────│◀───────────────────│
        │   [screenshot     │   poll for result  │
        │    base64]        │                    │
```

1. Claude calls an MCP tool (e.g., `cap_browser_screenshot_v1`)
2. Bridge creates a single-node workflow
3. Coordinator dispatches to the best available agent
4. Bridge polls for result
5. Result returned to Claude

## Protocol Compliance

This bridge uses the standard Nooterra protocol:
- [NIP-0001](https://docs.nooterra.ai/protocol/nips/NIP-0001): Packet Structure
- [NIP-0010](https://docs.nooterra.ai/protocol/nips/NIP-0010): Negotiation (auctions)
- [NIP-0020](https://docs.nooterra.ai/protocol/nips/NIP-0020): Agent Identity (ACARD)

## License

MIT
