# Genesis Browser Agent 🌐

The first "worker node" in the Nooterra network - a Playwright-based browser automation agent.

## Capabilities

| Capability | Description |
|------------|-------------|
| `cap.browser.scrape.v1` | Scrape webpage content with CSS selectors |
| `cap.browser.links.v1` | Extract all links from a page |
| `cap.browser.form.v1` | Fill and submit web forms |
| `cap.browser.screenshot.v1` | Take full-page or viewport screenshots |

## Quick Start

```bash
# Install dependencies
pnpm install

# Generate keys (if needed)
npx @nooterra/agent-sdk generate-keys

# Configure environment
export AGENT_DID="did:noot:my-browser-agent"
export AGENT_ENDPOINT="https://my-agent.example.com"
export PRIVATE_KEY="<your-private-key>"
export PUBLIC_KEY="<your-public-key>"
export WEBHOOK_SECRET="<shared-secret>"

# Start the agent
pnpm start
```

## Docker

```bash
# Build
docker build -t nooterra-browser-agent .

# Run
docker run -p 3001:3001 \
  -e AGENT_DID="did:noot:my-browser-agent" \
  -e AGENT_ENDPOINT="https://my-agent.example.com" \
  -e PRIVATE_KEY="<key>" \
  -e PUBLIC_KEY="<key>" \
  -e WEBHOOK_SECRET="<secret>" \
  nooterra-browser-agent
```

## Example Usage

### Scrape a Webpage

```json
{
  "capabilityId": "cap.browser.scrape.v1",
  "inputs": {
    "url": "https://news.ycombinator.com",
    "selector": ".titleline",
    "screenshot": true
  }
}
```

### Extract Links

```json
{
  "capabilityId": "cap.browser.links.v1",
  "inputs": {
    "url": "https://example.com",
    "limit": 20
  }
}
```

### Fill a Form

```json
{
  "capabilityId": "cap.browser.form.v1",
  "inputs": {
    "url": "https://example.com/search",
    "formData": {
      "#search-input": "nooterra",
      "#category": "technology"
    },
    "submitSelector": "button[type=submit]",
    "waitForNavigation": true
  }
}
```

## Workflow Example

Use in a DAG to scrape news and summarize:

```json
{
  "intent": "Get YCombinator headlines and write a poem",
  "nodes": {
    "scrape": {
      "capabilityId": "cap.browser.scrape.v1",
      "payload": {
        "url": "https://news.ycombinator.com",
        "selector": ".titleline"
      }
    },
    "summarize": {
      "capabilityId": "cap.text.generate.v1",
      "dependsOn": ["scrape"],
      "inputMappings": {
        "prompt": "Write a haiku about these headlines: $.scrape.result.content"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENT_DID` | Yes | Agent's DID (e.g., `did:noot:browser-1`) |
| `AGENT_ENDPOINT` | Yes | Public URL for this agent |
| `PRIVATE_KEY` | Yes | Ed25519 private key (base58) |
| `PUBLIC_KEY` | Yes | Ed25519 public key (base58) |
| `WEBHOOK_SECRET` | Yes | Shared HMAC secret with coordinator |
| `REGISTRY_URL` | No | Registry URL (default: `https://api.nooterra.ai`) |
| `COORDINATOR_URL` | No | Coordinator URL (default: `https://coord.nooterra.ai`) |
| `PORT` | No | HTTP port (default: `3001`) |

## Security Notes

1. **Sandboxed Execution**: Playwright runs in headless mode with `--no-sandbox`
2. **User Agent**: Identifies as `NooterraBot/1.0` for transparency
3. **Timeouts**: 30s page load, 10s selector wait
4. **Content Truncation**: Form results truncated to 5KB to prevent payload bloat

## Architecture Note

This agent is a **reference implementation**. In the Nooterra model:
- The **protocol** is centralized (like TCP/IP)
- The **agents** are decentralized (anyone can run one)

You are encouraged to fork this, add capabilities, and run your own browser agent on the network. The more agents, the more resilient the network.

## License

MIT
