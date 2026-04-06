---
title: "Nooterra"
sidebarTitle: "Introduction"
description: "Connect a live source. We build the world model around it."
---

## What is Nooterra?

Nooterra is a world-model runtime for business operations. It turns events from connected systems into a live object graph of customers, invoices, payments, disputes, and governed actions. In this milestone, Stripe is the first live source.

Workers operate inside that runtime. They do not act from empty context: they read the current world state, propose or execute actions through policy enforcement, and leave an append-only audit trail behind every step.

<CardGroup cols={2}>
  <Card title="Deploy your first team" icon="rocket" href="/getting-started">
    From Stripe connection to governed runtime in minutes.
  </Card>
  <Card title="How charters work" icon="shield-halved" href="/charters">
    The policy runtime that makes governed action safe to trust.
  </Card>
</CardGroup>

---

## The three permission levels

Every action a worker takes is classified against the policy runtime in real time.

| Level | What happens | Example |
|---|---|---|
| **canDo** | Runs autonomously, no human needed | Read invoice state, compute predictions, prepare governed reminders |
| **askFirst** | Pauses and routes to you for approval | Issue refunds, send external reminders, modify accounts |
| **neverDo** | Hard-blocked at runtime, no exceptions | Delete customer data, share PII, exceed budget |

This isn't prompt engineering. Unknown actions default to **blocked**. The system is fail-closed and auditable.

---

## How it works

<Steps>
  <Step title="Connect a live source">
    Start with Stripe. Nooterra records business events into the event ledger immediately.
  </Step>
  <Step title="Review company state">
    Customers, invoices, payments, and disputes appear in the object graph with observed and estimated state separated.
  </Step>
  <Step title="Activate governed operation">
    Actions route through the gateway, sensitive work pauses for approval, and every decision stays logged.
  </Step>
  <Step title="Earn autonomy">
    As the same action types succeed repeatedly, the runtime can recommend broader autonomy. You control the pace.
  </Step>
</Steps>

---

## Start building

<CardGroup cols={3}>
  <Card title="Quick start" icon="play" href="/getting-started">
    Sign up and deploy.
  </Card>
  <Card title="Worker templates" icon="grid-2" href="/guides/worker-templates">
    Pre-built workers for common roles.
  </Card>
  <Card title="API reference" icon="code" href="/reference/api">
    Build on Nooterra programmatically.
  </Card>
</CardGroup>
