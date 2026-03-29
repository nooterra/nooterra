---
title: "Approvals"
description: "Human-in-the-loop approval system: dashboard inbox, Slack, webhooks, auto-approve policies, and timeouts."
---

# Approvals

When a worker attempts an action that matches an `askFirst` rule in its charter, execution pauses and an approval request is sent. The worker does not proceed until a human approves or denies the request.

## When Approvals Trigger

An approval is triggered when:

1. A tool call matches an `askFirst` rule in the worker's charter
2. A tool call matches no charter rule at all (the default is askFirst to be safe)
3. The worker explicitly calls the `__ask_first__` tool to request permission

During execution, the worker shows:

```
PAUSED: "send_email" requires approval (rule: "Send emails"). NOT executed.
[Execution paused — waiting for human approval.]
```

## Approval Channels

Approval requests are sent to all configured channels simultaneously. The first response wins — all other channels are cancelled (anti-stamping).

### Dashboard Inbox

The primary approval channel. All pending approvals appear in your **Inbox** on the Nooterra dashboard at [nooterra.ai](https://nooterra.ai). Each request shows:

- The worker name and action
- A description of what the worker wants to do
- Approve / Deny buttons
- Time remaining before expiry

<Info>
You receive real-time push notifications in the dashboard when a new approval is waiting. Enable browser notifications so you never miss one.
</Info>

### Slack

Approval requests can be sent to a Slack channel. Connect Slack from **Settings > Integrations** in the dashboard. Approve or deny directly from the Slack message using interactive buttons.

### Webhook

POST the approval request to a URL, then listen for a callback:

```json
{
  "approvalId": "apr_m2abc_xyz123",
  "workerId": "worker_123",
  "action": "send_email",
  "description": "Send reply to customer about refund status",
  "expiresAt": "2026-03-25T15:45:00.000Z",
  "callbackUrl": "https://api.nooterra.ai/v1/approvals/apr_m2abc_xyz123/respond"
}
```

To approve, POST back to the callback URL:

```json
{ "approved": true, "respondedBy": "admin@company.com" }
```

## Configuring Channels

Channels are configured per-worker from **Workers > [Worker] > Settings > Approvals** in the dashboard. The default is dashboard inbox only. Add Slack or webhook channels from the same screen.

## Timeouts

Each approval request has a timeout. The default is **5 minutes** (`300000ms`).

If no response is received within the timeout, the request is resolved based on the fail mode:

- **Fail-closed** (default): The action is **denied**. This is the safe default.
- **Fail-open**: The action is **approved**. Only use this for low-risk scenarios.

<Warning>
Fail-open mode means unattended workers can take actions without human review. Only enable this for workers with low-risk charters.
</Warning>

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

For development or trusted workers, you can bulk-approve all pending actions from the dashboard Inbox using the **Approve All** button.

## Approval Records

Every approval request is persisted and accessible via the API. The record structure:

```json
{
  "id": "apr_m2abc_xyz123",
  "workerId": "worker_123",
  "action": "send_email",
  "description": "Send reply to customer about refund status",
  "channels": ["dashboard", "webhook"],
  "status": "approved",
  "requestedAt": "2026-03-25T15:40:00.000Z",
  "respondedAt": "2026-03-25T15:40:32.000Z",
  "respondedBy": "dashboard:user@company.com",
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
| `dashboard:user@co.com` | Approved/denied in the dashboard |
| `dashboard:timeout` | Dashboard channel timed out |
| `slack:user@co.com` | Approved via Slack |
| `webhook:admin@co.com` | Approved via webhook callback |
| `webhook:timeout` | Webhook channel timed out |
| `auto:<reason>` | Auto-approved by policy |
| `bulk:approveAll` | Bulk-approved from dashboard |
| `system:timeout` | Global timeout (no channel responded) |

## Viewing Approvals

All pending and historical approvals are available in the dashboard under **Inbox**. Filter by worker, status, or date range.

Approval history is also available via the API:

```bash
curl https://api.nooterra.ai/v1/approvals?worker_id={worker_id} \
  -H "Authorization: Bearer $NOOTERRA_API_KEY"
```

## External Response

Pending approvals can be resolved externally via the API by POSTing to the approval's respond endpoint. This is how webhook callbacks and custom integrations work — they look up the pending approval by ID and resolve it.

```bash
curl -X POST https://api.nooterra.ai/v1/approvals/{approval_id}/respond \
  -H "Authorization: Bearer $NOOTERRA_API_KEY" \
  -d '{"approved": true, "respondedBy": "api:automation"}'
```
