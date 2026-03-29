---
title: "Scheduling"
description: "Run workers on demand, on cron schedules, via webhooks, or continuously — all managed from the dashboard."
---

# Scheduling

Workers can run on demand, on a schedule, continuously, or via webhook triggers. All scheduling is managed from the **Nooterra dashboard** at [nooterra.ai](https://nooterra.ai).

## Running a Worker

<Tabs>
  <Tab title="Dashboard">
    Click **Run Now** on any worker card to trigger an immediate execution. You'll see a live activity feed as the worker executes, showing each thinking step, tool call, and result in real time.
  </Tab>
  <Tab title="API">
    ```bash
    curl -X POST https://api.nooterra.ai/v1/workers/{worker_id}/run \
      -H "Authorization: Bearer $NOOTERRA_API_KEY"
    ```
  </Tab>
</Tabs>

## Schedule Types

Workers support four schedule types, configured in the charter's `schedule` field:

### Interval

Run at a fixed frequency:

```json
{ "type": "interval", "value": "1h" }
```

Supported intervals: `Nm` (minutes), `Nh` (hours), `Nd` (days). Examples:
- `"15m"` — every 15 minutes
- `"1h"` — every hour
- `"2h"` — every 2 hours
- `"1d"` — daily at midnight

Intervals are converted to cron expressions internally:
- `"15m"` becomes `*/15 * * * *`
- `"1h"` becomes `0 */1 * * *`
- `"1d"` becomes `0 0 * * *`

### Cron

Standard cron expressions for precise scheduling:

```json
{ "type": "cron", "value": "0 9 * * 1-5" }
```

Examples:
- `"0 9 * * *"` — daily at 9 AM
- `"0 9 * * 1"` — every Monday at 9 AM
- `"0 10 * * 1-5"` — weekdays at 10 AM

### Continuous

Runs 24/7, restarting after each execution:

```json
{ "type": "continuous", "value": null }
```

### Trigger (On-Demand)

Only runs when manually triggered, invoked via API, or fired by a webhook:

```json
{ "type": "trigger", "value": "on_demand" }
```

## Schedule Inference

When you describe a worker in the builder, the schedule is inferred from your language:

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

From the dashboard, navigate to **Workers > Schedules** to see all active schedules at a glance. For each worker you can:

- **Edit** the schedule type or cron expression
- **Pause** a schedule temporarily
- **Resume** a paused schedule
- **Delete** a schedule entirely

Workers with status `paused` or `archived` are skipped during scheduled execution.

## Webhook Triggers

Workers with a `trigger` schedule can be invoked via webhook. Each worker has a unique webhook URL available on its detail page in the dashboard:

```
https://api.nooterra.ai/v1/webhooks/{worker_webhook_id}
```

Send a POST request to trigger the worker. You can include a JSON payload that the worker receives as context:

```bash
curl -X POST https://api.nooterra.ai/v1/webhooks/{worker_webhook_id} \
  -H "Content-Type: application/json" \
  -d '{"event": "new_order", "order_id": "12345"}'
```

<Info>
Webhook URLs are unique per worker and can be regenerated from the dashboard if compromised.
</Info>

## Execution During Scheduled Runs

When the scheduler fires a worker:

<Steps>
  <Step title="Load">The worker definition and charter are loaded</Step>
  <Step title="Resolve">API credentials for the worker's provider are resolved</Step>
  <Step title="Execute">The worker executes via the standard execution engine</Step>
  <Step title="Record">Results are recorded as a run receipt</Step>
  <Step title="Notify">Notifications are sent (success or failure)</Step>
</Steps>

If the provider has no valid credentials, a high-urgency notification is sent instead of running.

## Logs and Monitoring

All execution history, logs, and cost tracking are available in the dashboard under **Workers > Runs**. Each run shows the full activity feed, duration, cost, and outcome.
