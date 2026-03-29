---
title: "Getting Started"
description: "Sign up, describe your business, and deploy your AI workforce in under 60 seconds."
---

# Getting Started

Go from zero to a running AI workforce in under 60 seconds. No install required.

<Steps>
  <Step title="Sign up">
    Go to [nooterra.ai/signup](https://nooterra.ai/signup) and create your account. Email, Google, or GitHub SSO -- takes 10 seconds.
  </Step>
  <Step title="Describe your business">
    You'll see one prompt: **"Describe your business in one sentence."**

    Examples:
    - "I run a plumbing company in Denver with 8 technicians."
    - "We're a 4-person e-commerce brand selling skincare on Shopify."
    - "I'm a solo real estate agent in Austin."

    The more specific you are, the better Nooterra tailors your team.
  </Step>
  <Step title="Review your AI team">
    Nooterra designs a full team of workers based on your business. Each worker has a specific role, a set of capabilities, and a **charter** -- explicit rules governing what it can do autonomously, what needs your approval, and what's permanently off-limits.

    For a plumbing company, you might see:

    | Worker | Role | Key capabilities |
    |--------|------|-----------------|
    | **Receptionist** | Answer calls, book appointments | Phone, Calendar, CRM |
    | **Dispatcher** | Assign jobs to technicians | Calendar, SMS, Maps |
    | **Billing Clerk** | Send invoices, follow up on payments | Email, Stripe, QuickBooks |
    | **Review Manager** | Respond to Google/Yelp reviews | Browser, Email |

    You can accept the team as-is, remove workers you don't need, or add new ones.
  </Step>
  <Step title="Activate workers">
    Toggle workers on from the team view. Each worker starts operating on its assigned schedule -- reading emails, handling requests, sending invoices, whatever its charter allows.

    Sensitive actions (refunds, external emails, account changes) route to your **inbox** for approval. Nothing irreversible happens without you.
  </Step>
  <Step title="Monitor from the dashboard">
    Your dashboard is mission control. Everything your AI workforce does is visible in real time.
  </Step>
</Steps>

---

## The dashboard

Once your workers are active, the dashboard gives you three views:

<CardGroup cols={3}>
  <Card title="Inbox" icon="inbox">
    Approval requests from workers that need your sign-off before acting. Approve or reject with one click.
  </Card>
  <Card title="Activity" icon="list-timeline">
    A live feed of every action your workers take -- emails sent, appointments booked, invoices created, searches run. Full audit trail.
  </Card>
  <Card title="Performance" icon="chart-line">
    Metrics for each worker: tasks completed, approval rate, average response time, errors. See which workers are earning trust.
  </Card>
</CardGroup>

---

## Adding more workers

After your initial team is deployed, you can add workers at any time from the dashboard:

- **Team mode** -- Describe a new aspect of your business and get a batch of workers designed for it.
- **Worker mode** -- Describe a single task and get one worker built for it.
- **Templates** -- Browse pre-built workers for common roles and activate them instantly.

See [Creating Workers](/creating-workers) for the full guide.

---

## For developers: the CLI

The web dashboard is the primary experience, but Nooterra also ships a CLI for developers who prefer the terminal.

<Tabs>
  <Tab title="Web dashboard (recommended)">
    Sign up at [nooterra.ai/signup](https://nooterra.ai/signup) and use the dashboard for everything -- team creation, worker management, approvals, monitoring, and analytics. No install needed.
  </Tab>
  <Tab title="CLI">
    ```bash
    npx nooterra
    ```

    The CLI connects to the same account and workers as the dashboard. Use it to:
    - Create and edit workers from the terminal
    - Stream live worker activity logs
    - Manage charters and schedules programmatically
    - Integrate Nooterra into CI/CD pipelines and scripts

    Log in with your nooterra.ai credentials. Everything syncs between CLI and dashboard.
  </Tab>
</Tabs>

---

## What's next

<CardGroup cols={2}>
  <Card title="Creating Workers" icon="user-plus" href="/creating-workers">
    Team mode, worker mode, templates, and editing workers after creation.
  </Card>
  <Card title="Charters" icon="shield-halved" href="/charters">
    How the permission system works -- canDo, askFirst, neverDo.
  </Card>
  <Card title="Capabilities" icon="puzzle-piece" href="/capabilities">
    Available tools and integrations your workers can use.
  </Card>
  <Card title="Scheduling" icon="clock" href="/scheduling">
    Run workers on cron schedules, intervals, or event triggers.
  </Card>
</CardGroup>
