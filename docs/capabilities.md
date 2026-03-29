---
title: "Capabilities"
description: "All available tools and integrations: Slack, Email, GitHub, Browser, and more."
---

# Capabilities

Capabilities are the tools and integrations available to your workers. Each capability connects to an external service via an MCP server. You manage all integrations from the **Connections** page in the Nooterra dashboard at [nooterra.ai](https://nooterra.ai).

For OAuth-based integrations (Slack, GitHub, Google, etc.), the dashboard handles the authorization flow automatically -- click Connect and follow the prompts.

## Available Capabilities

### Browsing

| Capability | ID | Auth | Actions |
|------------|----|------|---------|
| Web Browser | `browser` | None | browse, screenshot, extract, click, fill, submit |

Runs via Puppeteer. No configuration required.

### Communication

| Capability | ID | Auth | Actions |
|------------|----|------|---------|
| Slack | `slack` | OAuth | send_message, read_channel, reply_thread, list_channels, search |
| Email (Gmail/IMAP) | `email` | OAuth or credentials | read, send, search, label, archive, draft |
| Discord | `discord` | Bot token | send_message, read_channel, manage_roles, create_thread |
| SMS (Twilio) | `sms` | API key | send_sms, receive_sms, send_mms |

### Development

| Capability | ID | Auth | Actions |
|------------|----|------|---------|
| GitHub | `github` | OAuth or token | create_issue, create_pr, merge, comment, list_repos, read_file, commit |
| File System | `filesystem` | None | read, write, list, delete, move, search |
| Terminal/Shell | `terminal` | None | execute, background, kill |

Terminal commands require approval by default.

### Databases

| Capability | ID | Auth | Actions |
|------------|----|------|---------|
| PostgreSQL | `postgres` | Connection string | query, insert, update, delete, schema |
| SQLite | `sqlite` | None | query, insert, update, delete, schema |

### Productivity

| Capability | ID | Auth | Actions |
|------------|----|------|---------|
| Notion | `notion` | OAuth | read_page, create_page, update_page, query_database, create_database |
| Google Sheets | `googleSheets` | OAuth | read, write, append, create, format |
| Google Calendar | `calendar` | OAuth | list_events, create_event, update_event, delete_event, find_free_time |

### Payments

| Capability | ID | Auth | Actions |
|------------|----|------|---------|
| Stripe | `stripe` | API key | charge, refund, create_subscription, cancel_subscription, list_invoices |

All payment actions require human approval by default.

### E-Commerce

| Capability | ID | Auth | Actions |
|------------|----|------|---------|
| Shopify | `shopify` | OAuth | list_products, update_inventory, list_orders, fulfill_order, create_discount |

### Integration

| Capability | ID | Auth | Actions |
|------------|----|------|---------|
| Webhooks | `webhook` | None | send, receive, transform |

### Search

| Capability | ID | Auth | Actions |
|------------|----|------|---------|
| Web Search | `webSearch` | API key | search, news, images |

### Core

| Capability | ID | Auth | Actions |
|------------|----|------|---------|
| Worker Memory | `memory` | None | store, retrieve, search, forget |

Built-in. Workers automatically have persistent memory across runs.

## Auth Types

| Type | How It Works |
|------|-------------|
| None | Works out of the box |
| OAuth | Dashboard handles the authorization flow -- click Connect and approve |
| API key | Paste a key from the service's dashboard |
| Connection string | Provide a database connection URL |
| Bot token | Create a bot on the platform and paste the token |
| OAuth or credentials | Choose between OAuth flow or manual credentials |
| OAuth or token | Choose between OAuth flow or personal access token |

## Automatic Capability Inference

When you describe a worker, capabilities are inferred from your description:

| Keywords | Inferred Capability |
|----------|-------------------|
| browse, website, url, scrape, price, competitor, amazon | Web Browser |
| slack, channel, message, thread | Slack |
| email, inbox, gmail, send mail | Email |
| github, repo, issue, pull request, PR, commit | GitHub |
| file, folder, directory | File System |
| command, terminal, shell, bash | Terminal |
| postgres, postgresql, database | PostgreSQL |
| notion, page, workspace | Notion |
| spreadsheet, google sheet, csv | Google Sheets |
| calendar, event, meeting, schedule | Google Calendar |
| stripe, payment, refund, subscription | Stripe |
| shopify, inventory, fulfillment | Shopify |
| search, google, find, research | Web Search |
| webhook, api, endpoint | Webhooks |
| remember, track, history, previous | Worker Memory |

## Categories

| Category | Capabilities |
|----------|-------------|
| Browsing | Web Browser |
| Communication | Slack, Email, Discord, SMS |
| Development | GitHub, File System, Terminal |
| Databases | PostgreSQL, SQLite |
| Productivity | Notion, Google Sheets, Google Calendar |
| Payments | Stripe |
| E-Commerce | Shopify |
| Integration | Webhooks |
| Search | Web Search |
| Core | Worker Memory |
