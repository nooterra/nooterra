# Approvals

When a worker attempts an action that matches an `askFirst` rule in its charter, execution pauses and an approval request is sent. The worker does not proceed until a human approves or denies the request.

## When Approvals Trigger

An approval is triggered when:

1. A tool call matches an `askFirst` rule in the worker's charter
2. A tool call matches no charter rule at all (the default is askFirst to be safe)
3. The worker explicitly calls the `__ask_first__` tool to request permission for an action

During execution, the worker sees:

```
PAUSED: "send_email" requires approval (rule: "Send emails"). NOT executed.
[Execution paused -- waiting for human approval.]
```

## Approval Channels

Approval requests are sent to all configured channels simultaneously. The first response wins -- all other channels are cancelled (anti-stamping).

### Terminal

The default channel. Prompts directly in the terminal where the worker is running:

```
  Approval required for worker "Inbox Triage"
  Action:  send_email
  Detail:  Send reply to customer about refund status
  Expires: 3:45:00 PM

  Approve? (y/n)
```

### Webhook

POST the approval request to a URL, then listen for a callback:

```json
{
  "approvalId": "apr_m2abc_xyz123",
  "workerId": "worker_123",
  "action": "send_email",
  "description": "Send reply to customer about refund status",
  "expiresAt": "2026-03-25T15:45:00.000Z",
  "callbackUrl": "http://localhost:54321/approval-callback"
}
```

To approve, POST back to the callback URL:

```json
{ "approved": true, "respondedBy": "admin@company.com" }
```

### Slack

Approval requests can be sent to a Slack channel (requires Slack capability to be connected).

### Email and SMS

Approval requests can also be routed through email or SMS channels.

## Configuring Channels

Channels are configured when creating the approval engine. The default is terminal-only. To add webhook or Slack channels, configure them in the worker's notification settings.

If no channels are configured, the engine falls back to terminal.

## Timeouts

Each approval request has a timeout. The default is **5 minutes** (`300000ms`).

If no response is received within the timeout, the request is resolved based on the fail mode:

- **Fail-closed** (default): The action is **denied**. This is the safe default.
- **Fail-open**: The action is **approved**. Only use this for low-risk scenarios.

## Auto-Approve Policies

Certain actions can be automatically approved without human intervention:

### Policy 1: canDo Match

If the action matches a `canDo` rule in the worker's charter, it is auto-approved. This shouldn't normally trigger (canDo actions don't go through the approval flow), but serves as a safety net for edge cases.

### Policy 2: Repeated Approval

If the **same action** has been approved **3 or more times within the last 24 hours**, it is automatically approved. This prevents approval fatigue for routine actions.

The thresholds are:
- `AUTO_APPROVE_THRESHOLD`: 3 approvals
- `AUTO_APPROVE_WINDOW_MS`: 24 hours

Auto-approved actions are recorded with a reason:

```
respondedBy: "auto:auto-approved: 4 approvals in last 24h"
```

### Bulk Approve

For development or trusted workers, you can bulk-approve all pending actions:

```
respondedBy: "bulk:approveAll"
```

## Approval Records

Every approval request is persisted to `~/.nooterra/approvals/` as a JSON file. The record structure:

```json
{
  "id": "apr_m2abc_xyz123",
  "workerId": "worker_123",
  "action": "send_email",
  "description": "Send reply to customer about refund status",
  "channels": ["terminal", "webhook"],
  "status": "approved",
  "requestedAt": "2026-03-25T15:40:00.000Z",
  "respondedAt": "2026-03-25T15:40:32.000Z",
  "respondedBy": "terminal:user",
  "expiresAt": "2026-03-25T15:45:00.000Z"
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `pending` | Waiting for a response |
| `approved` | Human approved the action |
| `denied` | Human denied the action |
| `expired` | Timed out (resolved as denied in fail-closed mode) |

### respondedBy Values

| Value | Source |
|-------|--------|
| `terminal:user` | Approved/denied in the terminal |
| `terminal:timeout` | Terminal channel timed out |
| `webhook:admin@co.com` | Approved via webhook callback |
| `webhook:timeout` | Webhook channel timed out |
| `auto:<reason>` | Auto-approved by policy |
| `bulk:approveAll` | Bulk-approved |
| `system:timeout` | Global timeout (no channel responded) |

## Viewing Approvals

In the Nooterra REPL:

```
> /approvals
```

Shows all pending approval requests:

```
  Pending Approvals (2)

    Inbox Triage: Send reply to customer about refund...
      3m ago -- /approve apr_m2abc_xyz123 or /deny apr_m2abc_xyz123

    Price Monitor: Make purchase on Amazon for tracked it...
      1m ago -- /approve apr_m2def_abc456 or /deny apr_m2def_abc456
```

## Approval History

Approval history can be retrieved programmatically via `getHistory(workerId)`. Pass no arguments to get history for all workers. Records are sorted newest-first.

## External Response

Pending approvals can be resolved externally by calling `respond(approvalId, decision, respondedBy)`. This is how webhook callbacks and UI integrations work -- they look up the pending approval by ID and resolve it.
