# Scheduling

Workers can run manually, on a schedule, or continuously via the background daemon.

## Manual Runs

Run any worker on demand from the REPL:

```
> /run "Price Monitor"
```

Or from the command line:

```bash
nooterra --run "Price Monitor"
```

You'll see a live activity feed as the worker executes, showing each thinking step, tool call, and result in real time.

## Schedule Types

Workers support four schedule types, configured in the charter's `schedule` field:

### Interval

Run at a fixed frequency:

```json
{ "type": "interval", "value": "1h" }
```

Supported intervals: `Nm` (minutes), `Nh` (hours), `Nd` (days). Examples:
- `"15m"` -- every 15 minutes
- `"1h"` -- every hour
- `"2h"` -- every 2 hours
- `"1d"` -- daily at midnight

Intervals are converted to cron expressions by the daemon:
- `"15m"` becomes `*/15 * * * *`
- `"1h"` becomes `0 */1 * * *`
- `"1d"` becomes `0 0 * * *`

### Cron

Standard cron expressions for precise scheduling:

```json
{ "type": "cron", "value": "0 9 * * 1-5" }
```

Examples:
- `"0 9 * * *"` -- daily at 9 AM
- `"0 9 * * 1"` -- every Monday at 9 AM
- `"0 10 * * 1-5"` -- weekdays at 10 AM
- `"0 8 * * *"` -- daily at 8 AM

### Continuous

Runs 24/7, restarting after each execution:

```json
{ "type": "continuous", "value": null }
```

### Trigger (On-Demand)

Only runs when manually triggered or invoked via API:

```json
{ "type": "trigger", "value": "on_demand" }
```

## Schedule Inference

When you describe a worker, the schedule is inferred from your language:

| Your description | Inferred schedule |
|-----------------|-------------------|
| "continuously", "always", "24/7" | `continuous` |
| "every 2 hours" | `interval: 2h` |
| "every 30 minutes" | `interval: 30m` |
| "hourly" | `interval: 1h` |
| "daily", "every day" | `cron: 0 9 * * *` (9 AM daily) |
| "weekly" | `cron: 0 9 * * 1` (Monday 9 AM) |
| "every morning" | `cron: 0 8 * * *` |
| "monitor", "watch", "check" | `interval: 1h` |
| "when", "if", "trigger" | `trigger: on_demand` |

## Managing Schedules

View all active schedules:

```
> /schedule list
```

```
  Schedules

    Inbox Triage -- every 15 minutes (*/15 * * * *)
    Price Monitor -- every 1 hour (0 */1 * * *)
    Standup Summarizer -- weekdays 10 AM (0 10 * * 1-5) (paused)
```

Schedule commands:

```
/schedule list                        List all schedules
/schedule <worker> every 5m           Every 5 minutes
/schedule <worker> daily 9am          Daily at 9 AM
/schedule <worker> weekdays 9am       Weekdays at 9 AM
/schedule pause <id>                  Pause a schedule
/schedule delete <id>                 Delete a schedule
```

## The Daemon

The daemon is a persistent background process that runs all scheduled workers. It survives terminal close and can be configured to start on boot.

### Starting the Daemon

```bash
nooterra daemon start
```

The daemon detaches from the terminal and runs in the background. The method varies by platform:

| Platform | Method | Details |
|----------|--------|---------|
| macOS | launchd | Uses `~/Library/LaunchAgents/com.nooterra.daemon.plist` |
| Linux | systemd | Uses `~/.config/systemd/user/nooterra.service` |
| Fallback | spawn | Detached child process |

### Daemon Commands

```bash
nooterra daemon start       # Start the daemon
nooterra daemon stop        # Stop the daemon
nooterra daemon restart     # Stop then start
nooterra daemon status      # Show daemon health
nooterra daemon logs        # Tail the daemon log (default: 50 lines)
nooterra daemon logs 100    # Tail last 100 lines
nooterra daemon install     # Install as system service (auto-start on login)
nooterra daemon uninstall   # Remove system service
```

### Daemon Status

```bash
nooterra daemon status
```

```
Daemon: running
  PID:            12345
  Phase:          running
  Started:        2026-03-25T08:00:00.000Z
  Last heartbeat: 2026-03-25T15:30:00.000Z
  Uptime:         27000s
  Workers:        4
  Next run:       2026-03-25T16:00:00.000Z
  Memory (RSS):   45.2 MB
```

### Install as System Service

To start the daemon automatically when you log in:

```bash
nooterra daemon install
```

On macOS, this creates a launchd plist with `RunAtLoad` and `KeepAlive` enabled. On Linux, this creates and enables a systemd user service with `Restart=on-failure`.

To remove:

```bash
nooterra daemon uninstall
```

### Health and Reliability

The daemon includes several reliability features:

**Heartbeat**: Every 30 seconds, the daemon writes its status to `~/.nooterra/daemon-status.json`. This is used to detect stale daemons.

**Stale detection**: If the heartbeat file is older than 2 minutes, the daemon is considered dead even if the PID is still alive (handles PID recycling).

**Auto-restart**: On crash, the daemon waits 5 seconds and restarts. Maximum 5 restarts within a 10-minute window before giving up.

**Log rotation**: The daemon log at `~/.nooterra/logs/daemon.log` is rotated when it exceeds 5 MB. Three rotated copies are kept.

**Graceful shutdown**: On SIGTERM or SIGINT, the daemon flushes state, cleans up the PID file, and exits cleanly.

### Worker Discovery

The daemon polls for new workers every 60 seconds. When you create a new worker with a schedule, the daemon automatically picks it up and registers its schedule.

Workers with status `paused` or `archived` are skipped during scheduled execution.

## Execution During Scheduled Runs

When the scheduler fires a worker:

1. The worker definition is loaded from disk
2. API credentials for the worker's provider are resolved
3. The worker executes via the standard execution engine
4. Results are recorded as a run receipt
5. Notifications are sent (success or failure)

If the provider has no configured API key, a high-urgency notification is sent instead of running.

## Logs and Monitoring

View daemon logs:

```bash
nooterra daemon logs
```

View a specific worker's execution history:

```
> /logs "Price Monitor"
```

View cost tracking across all providers:

```
> /cost
```

Check provider health and circuit breaker status:

```
> /health
```
