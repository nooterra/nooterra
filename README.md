# Nooterra

[![CI](https://github.com/nooterra/nooterra/actions/workflows/tests.yml/badge.svg)](https://github.com/nooterra/nooterra/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/nooterra)](https://www.npmjs.com/package/nooterra)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

**AI workers that actually do things.** Create workers in plain English, teach them your business, and let them run 24/7 with guardrails.

## Quick Start

```sh
npm install -g nooterra
nooterra
```

That's it. Describe what you need and a worker deploys in seconds:

```
> monitor competitor prices on acme.com

  ⚡ Competitor Prices Monitor
    Tools: Web Browser
    Can do: Browse websites, Search the web
    Schedule: Every 1h
    Deploy? (yes)

> yes
  ✓ Competitor Prices Monitor deployed!
```

## What Can Workers Do?

Workers use real tools to do real work:

```
> /run Competitor Prices Monitor

  0.0s  Thinking... (round 1)
  2.1s  🔧 web_fetch (https://acme.com/pricing)
  3.8s  ✓ web_fetch → 2341 chars
  3.9s  🔧 web_search ("acme corp pricing changes")
  4.3s  ✓ web_search → 1204 chars
  6.1s  💾 Memory saved: acme_pricing_snapshot
  6.2s  ✅ Done — 2 rounds, 2 tools

  Acme Corp pricing as of today:
  - Starter: $29/mo (unchanged)
  - Pro: $79/mo (was $99 — price DROP detected!)
```

## Key Features

### One-Sentence Workers
Describe any job in plain English. Nooterra infers the name, tools, rules, and schedule.

```sh
nooterra
> make me a customer support bot      # Detects profile, sets up charter
> sales assistant to find leads        # Browser + email capabilities
> summarize our team standups          # Slack integration
```

### Teach Your Business
Give workers company knowledge — FAQs, policies, product info:

```sh
nooterra teach "Support Bot" "Our refund policy is 30 days no questions asked"
nooterra teach "Support Bot" https://company.com/faq
nooterra teach "Support Bot" ~/Documents/product-guide.pdf
```

### Real Tools, Zero Config
Workers come with built-in tools that work immediately:

| Tool | What It Does | Config |
|------|-------------|--------|
| `web_fetch` | Fetch any webpage, extract text/links/JSON | None |
| `web_search` | Search the web via DuckDuckGo/Brave | None |
| `read_file` / `write_file` | Read and write files | None |
| `slack_send` / `slack_read` | Send and read Slack messages | `nooterra add slack` |
| `github_api` | GitHub repos, issues, PRs | `nooterra add github` |
| `send_email` | Send emails via SMTP | `nooterra add email` |

```sh
nooterra add slack        # Paste token, validated, done
nooterra add github       # Paste token, validated, done
nooterra tools            # See what's connected
```

### Guardrails (Charter)
Every worker has a charter — what it can do, what needs approval, what it must never do:

```yaml
name: Customer Support Bot
canDo:
  - Read customer emails
  - Send helpful replies
  - Look up FAQ answers
askFirst:
  - Issue refunds
  - Make promises about features
neverDo:
  - Share customer data between customers
  - Make up information
```

### Run 24/7
Workers run in the background, even after you close the terminal:

```sh
nooterra daemon start     # Start background daemon
nooterra daemon status    # Check health
nooterra daemon install   # Auto-start on login (macOS/Linux)
nooterra daemon stop      # Stop daemon
```

### Live Activity Feed
See exactly what your workers are doing in real time:

```sh
nooterra run "Price Monitor"
nooterra logs "Price Monitor"
nooterra dashboard
```

### Notifications
Get alerted when workers find things:

- Desktop notifications (macOS — works immediately)
- Slack messages
- Email alerts
- Webhooks

## All Commands

```sh
# Create & manage
nooterra                      # Interactive TUI
nooterra new                  # Create a worker
nooterra workers              # List workers
nooterra templates            # Quick start templates
nooterra teach <worker> <info> # Teach company knowledge

# Run & monitor
nooterra run <worker>         # Run with live activity
nooterra test <worker>        # Dry run
nooterra logs <worker>        # Execution history
nooterra dashboard            # System dashboard

# Tools
nooterra add <tool>           # Connect a tool
nooterra tools                # List tool status

# Daemon
nooterra daemon start         # Run workers 24/7
nooterra daemon status        # Check health
nooterra daemon install       # Auto-start on login

# Advanced
nooterra approvals            # Pending approval queue
nooterra cost                 # Provider cost tracking
nooterra health               # Provider health
```

## Templates

Get started in seconds with pre-built workers:

| Template | What It Does |
|----------|-------------|
| Price Monitor | Track prices on websites, alert on changes |
| Inbox Triage | Read email, categorize, forward urgent to Slack |
| Standup Summarizer | Summarize team standup messages daily |
| Competitor Watcher | Monitor competitor sites for changes |
| PR Reviewer | Review pull requests, comment on quality |
| Social Monitor | Track brand mentions across the web |

```sh
nooterra
> /templates
```

## AI Providers

Works with any AI provider:

| Provider | Setup |
|----------|-------|
| ChatGPT (subscription) | OAuth sign-in |
| OpenAI API | API key |
| Anthropic (Claude) | API key |
| Google (Gemini) | API key |
| OpenRouter (200+ models) | API key |
| Groq (fast, free tier) | API key |
| Ollama (local, free) | No key needed |

## MCP Server

Use Nooterra from Claude Code, Codex, Cursor, or any MCP client:

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

Then in your AI tool: *"Create a nooterra worker that monitors competitor prices"*

## Architecture

```
scripts/worker-builder/
├── cli.mjs                  # TUI + CLI interface
├── worker-builder-core.mjs  # Conversation engine + instant creation
├── worker-daemon.mjs        # AI execution engine (multi-round agentic loop)
├── built-in-tools.mjs       # 10 real working tools (fetch, search, slack, etc)
├── daemon-service.mjs       # Persistent background daemon
├── worker-knowledge.mjs     # /teach knowledge store
├── guided-setup.mjs         # 6 worker type profiles
├── activity-feed.mjs        # Live execution progress
├── notification-delivery.mjs # Desktop, Slack, email, webhook
├── mcp-server.mjs           # MCP server for AI tool integration
├── tool-installer.mjs       # nooterra add <tool>
├── charter-compiler.mjs     # Charter generation + validation
├── provider-auth.mjs        # AI provider auth (OAuth, API keys)
├── worker-scheduler.mjs     # Cron scheduler
├── approval-engine.mjs      # Multi-channel approvals
├── worker-delegation.mjs    # Worker-to-worker delegation
├── execution-lanes.mjs      # Parallel execution
├── provider-fallback.mjs    # Circuit breakers + failover
├── streaming-executor.mjs   # Real-time streaming execution
└── ui/                      # Ink (React) TUI components
```

## Development

```sh
git clone https://github.com/nooterra/nooterra.git
cd nooterra
npm ci
node bin/nooterra.js
```

## Links

- [nooterra.ai](https://nooterra.ai)
- [Documentation](https://nooterra.ai/docs)
- [Security](./SECURITY.md)

## License

Apache-2.0
