# Charters

A charter is the governance document for a worker. It defines exactly what a worker can do, what requires human approval, and what is forbidden. Every worker has one.

## The Three Rule Types

### canDo

Actions the worker can take autonomously, without asking for permission.

```
canDo:
  - Read emails matching search criteria
  - Browse specified websites
  - Send messages to allowed channels
  - Extract content from pages
```

### askFirst

Actions that require human approval before execution. When the worker wants to take an askFirst action, execution pauses and an approval request is sent to your configured channels.

```
askFirst:
  - Send emails
  - Create pull requests
  - Fill forms or submit data on websites
  - Make purchases above threshold
```

### neverDo

Hard restrictions. The worker will refuse these actions outright. They are enforced at runtime -- if the AI attempts a neverDo action, it is blocked and the worker is told why.

```
neverDo:
  - Delete emails permanently
  - Share email content externally
  - Post to channels not in the allowed list
  - Execute destructive commands (rm -rf, drop, etc.)
```

## Charter Schema

The full charter structure (schema version 1.0):

```json
{
  "schemaVersion": "1.0",
  "name": "Inbox Triage",
  "purpose": "Read incoming emails, categorize by urgency, and forward urgent messages to Slack",
  "canDo": [
    "Read emails matching search criteria",
    "Read messages from allowed channels",
    "Send messages to allowed channels"
  ],
  "askFirst": [
    "Send emails",
    "Send direct messages to individuals"
  ],
  "neverDo": [
    "Delete emails permanently",
    "Share email content externally",
    "Post to channels not in the allowed list"
  ],
  "budget": {
    "amount": 50,
    "currency": "USD",
    "period": "monthly",
    "approvalThreshold": 10
  },
  "schedule": {
    "type": "interval",
    "value": "15m",
    "timezone": "UTC"
  },
  "notifications": {
    "channels": ["slack"],
    "events": ["approval_needed", "task_complete", "error"]
  },
  "capabilities": [
    {
      "id": "email",
      "name": "Email (Gmail/IMAP)",
      "config": {},
      "summary": "Email (Gmail/IMAP)"
    },
    {
      "id": "slack",
      "name": "Slack",
      "config": { "channels": "#alerts" },
      "summary": "Slack (#alerts)"
    }
  ],
  "createdAt": "2026-03-25T10:00:00.000Z",
  "updatedAt": "2026-03-25T10:00:00.000Z"
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | string | yes | Always `"1.0"` |
| `name` | string | yes | Worker name |
| `purpose` | string | yes | One-sentence description of what this worker does |
| `canDo` | string[] | yes | Actions the worker can take autonomously |
| `askFirst` | string[] | yes | Actions requiring human approval |
| `neverDo` | string[] | yes | Forbidden actions (hard block) |
| `budget` | object | no | Spending limits |
| `budget.amount` | number | -- | Maximum spend per period |
| `budget.currency` | string | -- | Currency code (default: `"USD"`) |
| `budget.period` | string | -- | `"monthly"`, `"weekly"`, `"daily"` |
| `budget.approvalThreshold` | number | -- | Single-spend amount that triggers approval |
| `schedule` | object | no | When the worker runs |
| `schedule.type` | string | -- | `"continuous"`, `"interval"`, `"cron"`, `"trigger"` |
| `schedule.value` | string | -- | Cron expression, interval (`"1h"`, `"30m"`), or `null` |
| `schedule.timezone` | string | -- | Timezone (default: `"UTC"`) |
| `notifications` | object | no | Alert configuration |
| `capabilities` | object[] | yes | Connected tools (at least one required) |

## How Rules Are Inferred

When you describe a worker, Nooterra automatically infers charter rules based on two signals:

### 1. Capability-based inference

Each capability has default rules. For example, adding the GitHub capability automatically generates:

- **canDo**: Read repository contents, Create and update issues
- **askFirst**: Create pull requests, Merge pull requests
- **neverDo**: Delete branches or repositories, Modify repository settings

High-risk capabilities (terminal, Stripe) default to askFirst for all actions.

### 2. Task-based inference

Keywords in your description trigger additional rules:

- "monitor", "watch", "track" adds: canDo "Monitor specified data sources continuously"
- "price", "cost", "budget" adds: askFirst "Make purchases above threshold"
- "automate" adds: askFirst "Take actions with irreversible consequences"

The full inference happens in `inferCharterRules()` in `charter-compiler.mjs`.

## Runtime Enforcement

During execution, every tool call is classified against the charter before it runs. The classification logic in `classifyAction()` works as follows:

1. **Safe tools bypass** -- Built-in read-only tools (`web_fetch`, `web_search`, `read_file`, `send_notification`, `__save_memory`) are always allowed.

2. **neverDo check** (strictest) -- If all keywords from any neverDo rule appear in the tool call description, the action is **blocked**. The tool is not executed, and the AI receives a message explaining the violation.

3. **askFirst check** -- If keywords match an askFirst rule, execution **pauses** and an approval request is sent. The tool is not executed until a human approves.

4. **canDo check** -- If keywords match a canDo rule, the action proceeds.

5. **Implicit capability** -- If the tool belongs to a connected capability but matches no explicit rule, it is treated as canDo.

6. **Default** -- If no rules match, the action defaults to **askFirst** to be safe.

### What Blocking Looks Like

When a neverDo rule fires:

```
BLOCKED: Action "delete_file" violates charter neverDo rule:
"Delete files without explicit instruction". NOT executed.
```

The worker sees this message and adjusts its approach.

When an askFirst rule fires:

```
PAUSED: "send_email" requires approval (rule: "Send emails"). NOT executed.
[Execution paused -- waiting for human approval.]
```

## The System Prompt

The charter is compiled into a system prompt that the AI model receives. The prompt includes:

- Worker identity and purpose
- canDo rules as "Actions you CAN take autonomously"
- askFirst rules as "Actions that REQUIRE human approval"
- neverDo rules as "Actions you must NEVER take"
- Budget limits (if set)
- Available capabilities

This means enforcement happens at two levels: the AI is instructed to follow the rules (soft enforcement), and the runtime blocks violations regardless (hard enforcement).

## Editing Charters

Charter rules are set during worker creation. To modify rules after creation, edit the worker's charter JSON file directly in `~/.nooterra/workers/<worker-id>/`.

## Validation

A charter must pass validation before deployment:

- `name` must be non-empty
- `purpose` must be non-empty
- `capabilities` must contain at least one entry
- `budget.amount` cannot be negative
