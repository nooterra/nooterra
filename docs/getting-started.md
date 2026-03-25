---
title: "Getting Started"
description: "Install Nooterra and create your first AI worker in under 5 minutes."
---

# Getting Started

Create your first AI worker in under 5 minutes.

## Install

```bash
npm install -g nooterra
```

Requires Node.js 20.x.

## Connect an AI Provider

Launch Nooterra for the first time:

```bash
nooterra
```

You'll see the provider selection screen:

```
How should your workers think?

  1  ChatGPT (use your subscription -- recommended)
  2  OpenAI API key
  3  Anthropic API key
  4  OpenRouter (200+ models)
  5  Groq (fast, free tier)
  6  Local (Ollama -- free, runs on your machine)
```

Pick a provider and enter your credentials. ChatGPT connects via OAuth (opens your browser). API key providers ask you to paste a key. Local mode uses Ollama with no key required.

You can change providers later with `/auth`.

## Create Your First Worker

Once connected, describe what you need in plain English:

```
> Monitor competitor websites for pricing changes and alert me
```

Nooterra infers the tools, rules, and schedule from your description. It shows you what it understood:

```
This worker will use:
  Web Browser
  Web Search

I also need to know:
  - Can this worker spend money? If so, what's the budget?
  - Should it need approval before taking action?
  - Any services it should NEVER access?

Let's start -- are these tools right? (yes / add more / change)
```

Answer the follow-up questions. Nooterra walks you through capabilities, rules, schedule, and naming -- one question at a time.

When you confirm, the worker is deployed:

```
Worker created: Competitor Watcher

Run it with /run Competitor Watcher
```

## Run the Worker

```
> /run Competitor Watcher
```

You'll see a live activity feed as the worker executes:

```
  0.0s  Starting Competitor Watcher (run_abc123)
  0.1s  Thinking... (round 1)
  1.2s  web_search({"query":"competitor pricing"})
  2.8s  web_search -> 1240 chars (1600ms)
  3.0s  Thinking... (round 2)
  ...
  8.5s  Complete -- 3 rounds, 4 tool calls, 8.5s
```

After execution, the full output is printed along with a receipt ID for the audit trail.

## Faster: Instant Mode

Skip the conversation entirely. Just describe what you want:

```
> I need a worker that checks my inbox every 15 minutes and forwards urgent emails to Slack
```

Nooterra detects this is a worker request and infers everything -- name, capabilities, charter rules, and schedule. You review the charter and deploy with a single "yes".

## Even Faster: Templates

```
> /templates
```

Pick from pre-built workers:

```
  1  Price Monitor -- Track prices on websites and alert you when they change
  2  Inbox Triage -- Read your email, categorize messages, and forward urgent ones
  3  Standup Summarizer -- Read team standup messages and create a daily summary
  4  Competitor Watcher -- Monitor competitor websites for changes and new content
  5  PR Reviewer -- Review pull requests and leave comments on code quality
  6  Social Monitor -- Track mentions of your brand across the web
```

Select a number, confirm, and the worker is live.

## What's Next

- [Creating Workers](creating-workers.md) -- Full guide to worker creation modes
- [Charters](charters.md) -- How worker permissions and rules work
- [Capabilities](capabilities.md) -- Available tools and integrations
- [Scheduling](scheduling.md) -- Run workers on cron, intervals, or triggers
- [Approvals](approvals.md) -- Human-in-the-loop approval system

## Key Commands

| Command | Description |
|---------|-------------|
| `/new [description]` | Create a new worker |
| `/workers` | List all workers |
| `/run <name>` | Run a worker with live progress |
| `/templates` | Quick start from a template |
| `/teach <name> <info>` | Give a worker company knowledge |
| `/status` | Quick status overview |
| `/dashboard` | Real-time system dashboard |
| `/logs <name>` | Execution logs for a worker |
| `/receipts` | Recent execution receipts |
| `/auth` | Change AI provider |
| `/help` | Show all commands |

## File Locations

All state is stored in `~/.nooterra/`:

| Path | Contents |
|------|----------|
| `~/.nooterra/credentials/` | Encrypted API keys |
| `~/.nooterra/config.json` | Default provider and settings |
| `~/.nooterra/workers/` | Worker definitions and charters |
| `~/.nooterra/runs/` | Execution receipts and activity logs |
| `~/.nooterra/approvals/` | Approval history |
| `~/.nooterra/logs/` | Daemon logs |
