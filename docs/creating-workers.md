---
title: "Creating Workers"
description: "Build your AI workforce using team mode, worker mode, or pre-built templates."
---

# Creating Workers

There are three ways to create workers in Nooterra: **team mode**, **worker mode**, and **templates**. All three are available from the dashboard.

---

## Team mode

Team mode is the primary way to build your workforce. Describe your business (or a part of it) and Nooterra designs a full team of workers tailored to your operations.

<Steps>
  <Step title="Open the builder">
    From your dashboard, click **New team** to open the team builder. Select **Team mode** if not already selected.
  </Step>
  <Step title="Describe your business">
    Enter a one-sentence description of your business or the area you need help with:

    - "I run a property management company with 40 rental units."
    - "We sell handmade candles on Etsy and our own Shopify store."
    - "I'm a freelance accountant with 25 clients."

    The more specific you are, the better the team Nooterra designs for you.
  </Step>
  <Step title="Review the proposed team">
    Nooterra generates a team of workers, each with a defined role, capabilities, and charter. For a property management company, you might see:

    | Worker | Role | Capabilities |
    |--------|------|-------------|
    | **Tenant Coordinator** | Handle tenant inquiries and maintenance requests | Email, Calendar, CRM |
    | **Rent Collector** | Send rent reminders and track payments | Email, Stripe, QuickBooks |
    | **Maintenance Dispatcher** | Route repair requests to contractors | Email, SMS, Calendar |
    | **Listing Manager** | Post and update vacancy listings | Browser, Email |

    Each worker comes with a **charter** -- explicit rules defining what it can do autonomously (canDo), what requires your approval (askFirst), and what's permanently blocked (neverDo).
  </Step>
  <Step title="Customize and activate">
    Before activating, you can:

    - **Remove** workers you don't need
    - **Add** workers to fill gaps
    - **Edit** any worker's charter, capabilities, or schedule
    - **Rename** workers to match your terminology

    When you're satisfied, activate the team. Workers begin operating on their assigned schedules immediately.
  </Step>
</Steps>

---

## Worker mode

Worker mode creates a single worker for a specific task. Use this when you need one worker, not a whole team.

<Steps>
  <Step title="Open the builder">
    From your dashboard, click **New team** and switch to **Worker mode**.
  </Step>
  <Step title="Describe the task">
    Enter what you need in plain language:

    - "Monitor competitor websites for pricing changes and alert me on Slack."
    - "Review every new GitHub pull request and leave comments on code quality."
    - "Check my inbox every 15 minutes and forward urgent emails to my phone."

    Nooterra infers everything from your description: name, capabilities, charter rules, and schedule.
  </Step>
  <Step title="Review and deploy">
    You'll see a full preview of the worker:

    - **Name** and role description
    - **Capabilities** -- which tools and integrations it will use
    - **Charter** -- canDo, askFirst, and neverDo rules
    - **Schedule** -- when and how often it runs

    Edit anything that needs adjusting, then activate. The worker starts immediately.
  </Step>
</Steps>

---

## Templates

Templates are pre-built workers for common roles. Browse, activate, and customize -- no description needed.

From your dashboard, click **New team** and select the **Templates** tab.

<CardGroup cols={2}>
  <Card title="Price Monitor" icon="tag">
    Track prices on competitor websites and alert you when they change. Runs hourly.
  </Card>
  <Card title="Inbox Triage" icon="envelope">
    Read incoming email, categorize messages by urgency, and forward critical ones. Runs every 15 minutes.
  </Card>
  <Card title="Standup Summarizer" icon="clipboard-list">
    Read team standup messages from Slack and create a daily summary. Runs weekdays at 10 AM.
  </Card>
  <Card title="Competitor Watcher" icon="binoculars">
    Monitor competitor websites for changes, new features, and content updates. Runs daily.
  </Card>
  <Card title="PR Reviewer" icon="code-pull-request">
    Review new GitHub pull requests and leave comments on code quality and potential issues. Runs every 30 minutes.
  </Card>
  <Card title="Social Monitor" icon="hashtag">
    Track mentions of your brand across the web and social platforms. Runs every 2 hours.
  </Card>
</CardGroup>

Select a template, review its charter, adjust anything you want, and activate.

---

## Editing workers after creation

Every worker can be edited at any time from the dashboard. Click on any worker to open its detail view.

### Charter editing

The charter is the core of every worker -- it defines what the worker is allowed to do. From the worker detail view, you can edit all three permission levels:

| Level | What it controls | Example rules |
|---|---|---|
| **canDo** | Actions the worker takes autonomously | Read emails, search databases, draft documents |
| **askFirst** | Actions that pause and route to you for approval | Send external emails, issue refunds, modify records |
| **neverDo** | Hard-blocked actions, no exceptions | Delete customer data, share PII, exceed spending limits |

Changes take effect immediately. If you remove a capability from canDo, the worker stops performing that action on its next run.

### Other editable settings

<CardGroup cols={2}>
  <Card title="Capabilities" icon="puzzle-piece">
    Add or remove tools and integrations. Connect new services (Slack, GitHub, Stripe, etc.) or disconnect ones the worker no longer needs.
  </Card>
  <Card title="Schedule" icon="clock">
    Change when and how often the worker runs -- cron expressions, intervals, or event-based triggers.
  </Card>
  <Card title="Knowledge" icon="book">
    Teach the worker about your business. Add company info, policies, procedures, FAQs, or any context it needs to do its job well. Paste text, upload files, or provide URLs.
  </Card>
  <Card title="Name and role" icon="pen">
    Rename the worker or update its role description at any time.
  </Card>
</CardGroup>

### Pausing and deleting

- **Pause** a worker to stop it from running without losing its configuration. Resume anytime.
- **Delete** a worker to remove it permanently. All execution history and audit logs are retained for 90 days.

---

## What's next

<CardGroup cols={2}>
  <Card title="Charters" icon="shield-halved" href="/charters">
    Deep dive into the permission system that makes workers safe to trust.
  </Card>
  <Card title="Capabilities" icon="puzzle-piece" href="/capabilities">
    Full list of tools and integrations available to workers.
  </Card>
  <Card title="Scheduling" icon="clock" href="/scheduling">
    Configure cron schedules, intervals, and event triggers.
  </Card>
  <Card title="Approvals" icon="circle-check" href="/approvals">
    How the human-in-the-loop approval system works.
  </Card>
</CardGroup>
