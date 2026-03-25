---
title: "Creating Workers"
description: "Three ways to create workers: conversational flow, instant mode, and templates."
---

# Creating Workers

There are three ways to create a worker: conversational flow, instant mode, and templates.

## Conversational Flow

Start with `/new` or just describe what you want:

```
> /new Monitor my inbox and forward urgent emails to Slack
```

Nooterra walks you through a multi-step conversation. Each step gathers one piece of information.

### Step 1: Task Description

Describe the worker's job. The more detail, the better the inference:

```
Nooterra: Here's what I'm thinking for this worker:

This worker will use:
  Email (Gmail/IMAP)
  Slack

Other tools available: Web Browser, GitHub, File System, Terminal

I also need to know:
  - Can this worker spend money? If so, what's the budget?
  - Should it need approval before taking action?
  - Any services it should NEVER access?

Let's start -- are these tools right? (yes / add more / change)
```

### Step 2: Confirm Capabilities

Say "yes" to accept, "add more" to include additional tools, or "change" to swap tools out.

### Step 3: Configure Each Capability

For tools that need authentication (Slack, GitHub, Stripe, etc.), you'll be prompted to connect:

```
How do you want to connect Email (Gmail/IMAP)?
  1. OAuth (recommended)
  2. Manual credentials
```

Tools like Web Browser and File System work out of the box with no auth.

### Step 4: Define Rules

Nooterra infers canDo/askFirst/neverDo rules from your description and capabilities, then asks you to confirm or adjust:

```
Based on what you've told me, here's what this worker can do:

CAN DO:
  - Read emails matching search criteria
  - Read messages from allowed channels
  - Send messages to allowed channels

ASK FIRST:
  - Send emails
  - Send direct messages to individuals

NEVER DO:
  - Delete emails permanently
  - Share email content externally
  - Post to channels not in the allowed list

Look good? (yes / add rules / change)
```

### Step 5: Schedule

A schedule is inferred from your description. "Every morning" becomes `0 8 * * *`. "Hourly" becomes `0 */1 * * *`. You can accept or change it.

### Step 6: Name and Deploy

Pick a name (or accept the auto-generated one), review the full charter, and deploy.

### Cancelling

Type `/cancel` at any point to abort the creation flow.

## Instant Mode

Describe a worker in natural language and Nooterra infers everything without asking questions:

```
> I need a worker that reviews PRs on GitHub every 30 minutes
```

Nooterra detects this as a worker request and runs `instantCreate()`, which infers:
- **Name** from the task description
- **Capabilities** from keywords (GitHub, browser, email, etc.)
- **Charter rules** from the capabilities and task
- **Schedule** from time expressions ("every 30 minutes", "daily", "24/7")

You get a charter preview and a single confirmation prompt:

```
Instant worker:

  PR Reviewer
  Review new pull requests on GitHub, check for code quality issues

  Can Do:
    - Read repository contents
    - Create and update issues
  Ask First:
    - Create pull requests
    - Merge pull requests
  Never Do:
    - Delete branches or repositories
    - Modify repository settings

  Provider: ChatGPT  Schedule: every 30m  Tools: GitHub

Deploy this worker? (yes / edit / cancel)
```

Say "yes" to deploy, or "edit" to switch to the full conversational flow.

## Templates

Pre-built workers for common use cases:

```
> /templates
```

| # | Template | Description | Schedule |
|---|----------|-------------|----------|
| 1 | Price Monitor | Track prices on websites | Every 1h |
| 2 | Inbox Triage | Categorize and forward emails | Every 15m |
| 3 | Standup Summarizer | Summarize team standups | Weekdays 10 AM |
| 4 | Competitor Watcher | Monitor competitor websites | Daily 8 AM |
| 5 | PR Reviewer | Review GitHub pull requests | Every 30m |
| 6 | Social Monitor | Track brand mentions | Every 2h |

Select a template number, review the charter, and deploy.

## Guided Setup (Profiles)

For recognized worker types, Nooterra runs a guided setup that knows exactly which tools and knowledge the worker needs. Detected profiles:

| Profile | Triggers On | Required Tools | Knowledge Collected |
|---------|------------|----------------|-------------------|
| Customer Support | "customer support", "help desk", "FAQ" | Email | Company overview, refund policy, business hours, tone |
| Sales Assistant | "sales", "leads", "outreach" | Browser | Product overview, ideal customer, competitors, value prop |
| Content Writer | "write blog", "content marketing" | Browser | Topics, writing style, audience, style guide |
| Data Monitor | "monitor", "watch", "track prices" | Browser | Sources, what to watch for, frequency, notification targets |
| HR Onboarding | "onboard", "new employee" | -- | Company info, first-week tasks, benefits, IT contact |
| Meeting Assistant | "meeting summary", "action items" | Slack | Channels, summary format, participants |

When a profile is detected, the guided setup walks through required tools, optional tools, and knowledge collection specific to that worker type.

## Editing Workers

After creation, you can teach workers additional knowledge:

```
> /teach "Price Monitor" "Competitor list: Acme Corp, Globex, Initech"
> /teach "Support Bot" https://company.com/faq
> /teach "Support Bot" ~/documents/refund-policy.txt
```

Manage knowledge:

```
> /teach "Support Bot" --list     # See what the worker knows
> /teach "Support Bot" --clear    # Remove all knowledge
```

## Listing and Monitoring Workers

```
> /workers
```

Shows all workers with their status, provider, and run count:

```
  Workers

    running  Inbox Triage      ChatGPT  12 runs
    ready    Price Monitor     OpenAI   3 runs
    paused   Social Monitor    Groq     0 runs
```

View execution history for a specific worker:

```
> /logs "Inbox Triage"
```

## Worker Delegation

Workers can delegate tasks to other workers during execution:

```
> /delegate "sales lead" to "Price Monitor" "check competitor pricing"
```

Delegations use transitive trust with attenuation (child workers inherit parent constraints), have a max depth of 3, and produce a full audit trail.
