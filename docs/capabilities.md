---
title: "Capabilities"
description: "All available tools and integrations: Slack, Email, GitHub, Browser, and more."
---

# Capabilities

Capabilities are the tools and integrations available to workers. Each capability is backed by an MCP (Model Context Protocol) server that provides the actual tool implementations.

## Available Capabilities

### Browsing

| Capability | ID | Auth | MCP Server | Actions |
|------------|----|------|------------|---------|
| Web Browser | `browser` | None | `@anthropic/mcp-server-puppeteer` | browse, screenshot, extract, click, fill, submit |

Runs locally via Puppeteer. No configuration required.

### Communication

| Capability | ID | Auth | MCP Server | Actions |
|------------|----|------|------------|---------|
| Slack | `slack` | OAuth | `@anthropic/mcp-server-slack` | send_message, read_channel, reply_thread, list_channels, search |
| Email (Gmail/IMAP) | `email` | OAuth or credentials | `nooterra-mcp-email` | read, send, search, label, archive, draft |
| Discord | `discord` | Bot token | `nooterra-mcp-discord` | send_message, read_channel, manage_roles, create_thread |
| SMS (Twilio) | `sms` | API key | `nooterra-mcp-twilio` | send_sms, receive_sms, send_mms |

### Development

| Capability | ID | Auth | MCP Server | Actions |
|------------|----|------|------------|---------|
| GitHub | `github` | OAuth or token | `@anthropic/mcp-server-github` | create_issue, create_pr, merge, comment, list_repos, read_file, commit |
| File System | `filesystem` | None | `@anthropic/mcp-server-filesystem` | read, write, list, delete, move, search |
| Terminal/Shell | `terminal` | None | `nooterra-mcp-shell` | execute, background, kill |

Terminal commands require approval by default (`requiresApproval: true`).

### Databases

| Capability | ID | Auth | MCP Server | Actions |
|------------|----|------|------------|---------|
| PostgreSQL | `postgres` | Connection string | `@anthropic/mcp-server-postgres` | query, insert, update, delete, schema |
| SQLite | `sqlite` | None | `@anthropic/mcp-server-sqlite` | query, insert, update, delete, schema |

### Productivity

| Capability | ID | Auth | MCP Server | Actions |
|------------|----|------|------------|---------|
| Notion | `notion` | OAuth | `nooterra-mcp-notion` | read_page, create_page, update_page, query_database, create_database |
| Google Sheets | `googleSheets` | OAuth | `nooterra-mcp-google-sheets` | read, write, append, create, format |
| Google Calendar | `calendar` | OAuth | `nooterra-mcp-google-calendar` | list_events, create_event, update_event, delete_event, find_free_time |

### Payments

| Capability | ID | Auth | MCP Server | Actions |
|------------|----|------|------------|---------|
| Stripe | `stripe` | API key | `nooterra-mcp-stripe` | charge, refund, create_subscription, cancel_subscription, list_invoices |

Stripe has `requiresApproval: true` -- all payment actions require human approval by default.

### E-Commerce

| Capability | ID | Auth | MCP Server | Actions |
|------------|----|------|------------|---------|
| Shopify | `shopify` | OAuth | `nooterra-mcp-shopify` | list_products, update_inventory, list_orders, fulfill_order, create_discount |

### Integration

| Capability | ID | Auth | MCP Server | Actions |
|------------|----|------|------------|---------|
| Webhooks | `webhook` | None | `nooterra-mcp-webhook` | send, receive, transform |

### Search

| Capability | ID | Auth | MCP Server | Actions |
|------------|----|------|------------|---------|
| Web Search | `webSearch` | API key | `@anthropic/mcp-server-brave-search` | search, news, images |

### Core

| Capability | ID | Auth | MCP Server | Actions |
|------------|----|------|------------|---------|
| Worker Memory | `memory` | None | `@anthropic/mcp-server-memory` | store, retrieve, search, forget |

Built-in. Workers automatically have persistent memory across runs.

## Auth Types

| Type | How It Works |
|------|-------------|
| None | Works out of the box, no setup needed |
| OAuth | Opens a browser to authorize the connection |
| API key | Paste a key from the service's dashboard |
| Connection string | Provide a database connection URL |
| Bot token | Create a bot on the platform and paste the token |
| OAuth or credentials | Choose between OAuth flow or manual credentials |
| OAuth or token | Choose between OAuth flow or personal access token |

## Automatic Capability Inference

When you describe a worker, capabilities are inferred from keywords in your description:

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

## Capability-Specific Setup Questions

Some capabilities ask additional configuration questions during worker creation:

**File System**: "Which directories should this worker have access to?" (e.g., `~/Documents`, `~/Projects`)

**Slack**: "Which Slack channels should this worker use?" (e.g., `#general`, `#alerts`)

**PostgreSQL / SQLite**: "What database permissions should this worker have?" (Read only / Read and write / Full access)

## Categories

Capabilities are organized into categories:

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
