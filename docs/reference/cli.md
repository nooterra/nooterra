---
title: "CLI Reference"
description: "Complete reference for every Nooterra CLI command, flag, and option."
---

# CLI Reference

Nooterra ships a terminal UI (TUI) that handles onboarding, worker creation, management, monitoring, and more. Launch it with:

```bash
node scripts/worker-builder/cli.mjs
```

The CLI operates in two modes:

- **Interactive (REPL)** -- the default. Shows a banner, status bar, and prompt. Accepts `/commands` and natural language.
- **Non-interactive (flags)** -- pass `--flag` arguments to run a single command and exit.

---

## Non-Interactive Flags

Run any of these from your shell without entering the REPL.

| Flag | Description |
|------|-------------|
| `--workers` | List all workers and exit |
| `--dashboard`, `--dash` | Show the system dashboard and exit |
| `--approvals` | Show pending approval queue and exit |
| `--cost` | Show provider cost tracking and exit |
| `--health` | Show provider health and circuit breaker status and exit |
| `--logs <worker>` | Show execution logs for a worker and exit |
| `--schedule [args]` | Show schedule info and exit |
| `--run <worker>` | Execute a worker and exit |
| `--teach <worker> <info>` | Teach a worker knowledge non-interactively |
| `--new` | Launch the REPL and jump straight to worker creation |

### Examples

```bash
# List all workers
node scripts/worker-builder/cli.mjs --workers

# Run a worker by name
node scripts/worker-builder/cli.mjs --run "Price Monitor"

# Show execution logs
node scripts/worker-builder/cli.mjs --logs "Price Monitor"

# Teach a worker company knowledge
node scripts/worker-builder/cli.mjs --teach "Support Bot" "Our refund policy is 30 days"

# Show the dashboard
node scripts/worker-builder/cli.mjs --dashboard
```

---

## Interactive Commands

Inside the REPL, all commands start with `/`. You can also type natural language to create workers instantly.

### Worker Commands

#### `/new [description]`

Start the guided worker creation flow. If a description is provided, it seeds the conversation.

```
/new I need a worker that monitors competitor prices
```

#### `/workers`

List all workers with their current status (running, paused, error, ready), provider, and run count.

#### `/run <name>`

Execute a worker immediately with live progress output. Shows real-time activity including:
- Thinking rounds
- Tool calls with argument previews
- Tool results with character counts and durations
- Charter enforcement (blocked/approval-needed actions)
- Memory saves
- Completion summary (rounds, tool calls, duration)

```
/run Price Monitor
```

#### `/stop <name>`

Stop a running worker.

```
/stop Price Monitor
```

#### `/teach <worker> <info>`

Give a worker company knowledge. Supports multiple input formats:

```bash
# Add text knowledge
/teach "Price Monitor" "Competitor list: Acme Corp, Globex, Initech"

# Add from URL
/teach "Support Bot" https://company.com/faq

# Add from file
/teach "Support Bot" ~/file.txt

# Interactive mode (prompts for input)
/teach "Support Bot"

# List what a worker knows
/teach "Support Bot" --list

# Clear all knowledge
/teach "Support Bot" --clear
```

#### `/templates`

Show the template picker. Displays all pre-built worker templates with numbered selection. Available templates:

- `price-monitor`
- `inbox-triage`
- `standup-summarizer`
- `competitor-watcher`
- `pr-reviewer`
- `social-monitor`

After selecting, shows the charter preview and asks to deploy, edit, or cancel.

#### `/delegate`

Show delegation help. Workers can delegate tasks to each other during execution using the `__delegate_to_worker` tool.

```
/delegate "sales lead" to "Price Monitor" "check competitor pricing"
```

Features:
- Transitive trust with attenuation (delegations inherit constraints)
- Max depth of 3 to prevent infinite loops
- Full audit trail
- Results flow back to parent worker

#### `/schedule [args]`

Manage worker schedules.

```bash
/schedule list                        # List all schedules
/schedule <worker> every 5m           # Every 5 minutes
/schedule <worker> daily 9am          # Daily at 9 AM
/schedule <worker> weekdays 9am       # Weekdays at 9 AM
/schedule pause <id>                  # Pause a schedule
/schedule delete <id>                 # Delete a schedule
```

---

### Monitoring Commands

#### `/dashboard` (alias: `/dash`)

Real-time system dashboard showing:
- Connected providers with model info
- All workers with status and run counts (up to 8)
- System stats: total workers, receipts, heap usage, Node.js version

#### `/status`

Quick status overview: provider, worker count, receipt count, and config path (`~/.nooterra/`).

#### `/logs <name>`

Execution history for a specific worker. Shows the last 15 runs with:
- Success/failure status
- Timestamp and duration
- Round count and tool call count
- Tool names used
- Blocked action count
- Response preview (first 70 characters)

```
/logs Price Monitor
```

#### `/receipts`

Show the 10 most recent execution receipts across all workers, with worker name, success/failure, and timestamp.

#### `/approvals`

Show all pending approval requests. Each entry shows the worker name, action description, age, and the approval/deny commands:

```
/approve <id>
/deny <id>
```

#### `/cost`

Provider cost tracking. Shows total cost and call count per provider, read from `~/.nooterra/provider-health.json`.

#### `/health`

Provider health and circuit breaker status. Shows each provider's state:
- **healthy** (circuit breaker CLOSED)
- **testing** (circuit breaker HALF-OPEN)
- **down** (circuit breaker OPEN)

Also shows p95 latency when available.

---

### Setup Commands

#### `/auth`

Run the provider onboarding flow. Choose from:

| # | Provider | Auth Method |
|---|----------|-------------|
| 1 | ChatGPT | OAuth (browser flow) |
| 2 | OpenAI | API key |
| 3 | Anthropic | API key |
| 4 | OpenRouter | API key (200+ models) |
| 5 | Groq | API key (fast, free tier) |
| 6 | Local (Ollama) | None (runs locally) |

#### `/help`

Show the full command reference.

#### `/quit` (aliases: `/exit`, `/q`)

Exit the CLI.

---

## Natural Language Input

If your input is not a `/command`, the CLI checks whether it looks like a worker creation request. The following patterns trigger instant worker creation:

- Starts with: `i want`, `i need`, `create`, `make`, `build`, `help me`, `can you`, `set up`, `monitor`, `watch`, `check`, `track`, `send`, `forward`, `process`, `automate`, `schedule`
- Contains: `worker that`, `bot that`, `agent that`

When detected, the CLI runs the **instant creation** flow: it infers capabilities, schedule, and charter rules from your description, shows a preview, and asks to deploy, edit, or cancel.

```
> I need a worker that monitors competitor prices every hour and alerts me on Slack
```

---

## Configuration

All Nooterra configuration is stored in `~/.nooterra/`:

| Path | Contents |
|------|----------|
| `~/.nooterra/` | Base configuration directory |
| `~/.nooterra/runs/` | Execution receipts (JSON) |
| `~/.nooterra/approvals/` | Approval request history |
| `~/.nooterra/schedules.json` | Worker schedule definitions |
| `~/.nooterra/provider-health.json` | Provider cost and health data |

---

## Environment

The CLI reads the version from `package.json` (falls back to `0.4.0`). It uses ANSI color codes for terminal output and adapts line width to `process.stdout.columns` (max 72).
