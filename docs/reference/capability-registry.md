---
title: "Capability Registry"
description: "Every available capability and tool in the Nooterra platform, organized by category."
---

# Capability Registry

The capability registry is the universal catalog of everything workers can connect to. Each capability maps to an MCP server, API, or built-in tool.

---

## Categories

| ID | Name | Description |
|----|------|-------------|
| `browsing` | Browsing | Web browsing and scraping |
| `communication` | Communication | Email, chat, messaging |
| `development` | Development | Code, files, terminals |
| `database` | Databases | Data storage and queries |
| `productivity` | Productivity | Docs, sheets, calendars |
| `payments` | Payments | Money and transactions |
| `ecommerce` | E-Commerce | Stores and inventory |
| `integration` | Integration | APIs and webhooks |
| `search` | Search | Web and data search |
| `core` | Core | Built-in capabilities |

---

## Browsing

### `browser` -- Web Browser

Browse websites, extract content, fill forms, click buttons.

| Property | Value |
|----------|-------|
| MCP Server | `@anthropic/mcp-server-puppeteer` |
| Auth Required | None |
| Requires Approval | No |
| Actions | `browse`, `screenshot`, `extract`, `click`, `fill`, `submit` |
| Setup | Runs locally via Puppeteer. No auth required. |

---

## Communication

### `slack` -- Slack

Send messages, read channels, manage threads.

| Property | Value |
|----------|-------|
| MCP Server | `@anthropic/mcp-server-slack` |
| Auth Required | OAuth |
| OAuth URL | `https://slack.com/oauth/v2/authorize` |
| Scopes | `chat:write`, `channels:read`, `channels:history` |
| Requires Approval | No |
| Actions | `send_message`, `read_channel`, `reply_thread`, `list_channels`, `search` |
| Setup | Connect your Slack workspace via OAuth. |

**Setup questions:**
- Connect your Slack account? (OAuth)
- Which Slack channels should this worker use? (e.g., `#general`, `#alerts`)

### `email` -- Email (Gmail/IMAP)

Read, send, and organize emails.

| Property | Value |
|----------|-------|
| MCP Server | `nooterra-mcp-email` |
| Auth Required | OAuth or credentials |
| Requires Approval | No |
| Actions | `read`, `send`, `search`, `label`, `archive`, `draft` |
| Setup | Connect Gmail via OAuth or provide IMAP credentials. |

**Setup questions:**
- How do you want to connect Email? (OAuth recommended / Manual credentials)

### `discord` -- Discord

Send messages, manage channels, respond to commands.

| Property | Value |
|----------|-------|
| MCP Server | `nooterra-mcp-discord` |
| Auth Required | Bot token |
| Requires Approval | No |
| Actions | `send_message`, `read_channel`, `manage_roles`, `create_thread` |
| Setup | Create a Discord bot and provide the token. |

**Setup questions:**
- Enter your Discord bot token

### `sms` -- SMS (Twilio)

Send and receive text messages.

| Property | Value |
|----------|-------|
| MCP Server | `nooterra-mcp-twilio` |
| Auth Required | API key |
| Requires Approval | No |
| Actions | `send_sms`, `receive_sms`, `send_mms` |
| Setup | Provide Twilio Account SID and Auth Token. |

**Setup questions:**
- Enter your SMS (Twilio) API key

---

## Development

### `github` -- GitHub

Manage repos, issues, PRs, actions.

| Property | Value |
|----------|-------|
| MCP Server | `@anthropic/mcp-server-github` |
| Auth Required | OAuth or personal access token |
| Scopes | `repo`, `issues`, `pull_requests` |
| Requires Approval | No |
| Actions | `create_issue`, `create_pr`, `merge`, `comment`, `list_repos`, `read_file`, `commit` |
| Setup | Connect via GitHub OAuth or provide a personal access token. |

**Setup questions:**
- How do you want to connect GitHub? (OAuth recommended / Personal access token)

### `filesystem` -- File System

Read, write, and manage local files.

| Property | Value |
|----------|-------|
| MCP Server | `@anthropic/mcp-server-filesystem` |
| Auth Required | None |
| Requires Approval | No |
| Actions | `read`, `write`, `list`, `delete`, `move`, `search` |
| Setup | Specify allowed directories for the worker. |

**Setup questions:**
- Which directories should this worker have access to? (e.g., `~/Documents`, `~/Projects`)

### `terminal` -- Terminal/Shell

Execute shell commands.

| Property | Value |
|----------|-------|
| MCP Server | `nooterra-mcp-shell` |
| Auth Required | None |
| **Requires Approval** | **Yes** |
| Actions | `execute`, `background`, `kill` |
| Setup | Runs locally. Commands require approval by default. |

---

## Databases

### `postgres` -- PostgreSQL

Query and modify PostgreSQL databases.

| Property | Value |
|----------|-------|
| MCP Server | `@anthropic/mcp-server-postgres` |
| Auth Required | Connection string |
| Requires Approval | No |
| Actions | `query`, `insert`, `update`, `delete`, `schema` |
| Setup | Provide PostgreSQL connection string. |

**Setup questions:**
- Enter your PostgreSQL connection string
- What database permissions should this worker have? (Read only / Read and write / Full access)

### `sqlite` -- SQLite

Local SQLite database operations.

| Property | Value |
|----------|-------|
| MCP Server | `@anthropic/mcp-server-sqlite` |
| Auth Required | None |
| Requires Approval | No |
| Actions | `query`, `insert`, `update`, `delete`, `schema` |
| Setup | Specify the SQLite database file path. |

**Setup questions:**
- What database permissions should this worker have? (Read only / Read and write / Full access)

---

## Productivity

### `notion` -- Notion

Read and write Notion pages, databases, blocks.

| Property | Value |
|----------|-------|
| MCP Server | `nooterra-mcp-notion` |
| Auth Required | OAuth |
| Requires Approval | No |
| Actions | `read_page`, `create_page`, `update_page`, `query_database`, `create_database` |
| Setup | Connect via Notion OAuth. |

### `googleSheets` -- Google Sheets

Read and write spreadsheets.

| Property | Value |
|----------|-------|
| MCP Server | `nooterra-mcp-google-sheets` |
| Auth Required | OAuth |
| Requires Approval | No |
| Actions | `read`, `write`, `append`, `create`, `format` |
| Setup | Connect via Google OAuth. |

### `calendar` -- Google Calendar

Manage calendar events and schedules.

| Property | Value |
|----------|-------|
| MCP Server | `nooterra-mcp-google-calendar` |
| Auth Required | OAuth |
| Requires Approval | No |
| Actions | `list_events`, `create_event`, `update_event`, `delete_event`, `find_free_time` |
| Setup | Connect via Google OAuth. |

---

## Payments

### `stripe` -- Stripe

Process payments, manage subscriptions, issue refunds.

| Property | Value |
|----------|-------|
| MCP Server | `nooterra-mcp-stripe` |
| Auth Required | API key |
| **Requires Approval** | **Yes** |
| Actions | `charge`, `refund`, `create_subscription`, `cancel_subscription`, `list_invoices` |
| Setup | Provide Stripe API key. Payment actions require approval. |

---

## E-Commerce

### `shopify` -- Shopify

Manage products, orders, inventory.

| Property | Value |
|----------|-------|
| MCP Server | `nooterra-mcp-shopify` |
| Auth Required | OAuth |
| Requires Approval | No |
| Actions | `list_products`, `update_inventory`, `list_orders`, `fulfill_order`, `create_discount` |
| Setup | Connect via Shopify OAuth. |

---

## Integration

### `webhook` -- Webhooks

Send and receive HTTP webhooks.

| Property | Value |
|----------|-------|
| MCP Server | `nooterra-mcp-webhook` |
| Auth Required | None |
| Requires Approval | No |
| Actions | `send`, `receive`, `transform` |
| Setup | Configure webhook URLs. |

---

## Search

### `webSearch` -- Web Search

Search the web using various engines.

| Property | Value |
|----------|-------|
| MCP Server | `@anthropic/mcp-server-brave-search` |
| Auth Required | API key |
| Requires Approval | No |
| Actions | `search`, `news`, `images` |
| Setup | Provide Brave Search API key. |

---

## Core

### `memory` -- Worker Memory

Persistent memory across worker runs.

| Property | Value |
|----------|-------|
| MCP Server | `@anthropic/mcp-server-memory` |
| Auth Required | None |
| Requires Approval | No |
| Actions | `store`, `retrieve`, `search`, `forget` |
| Setup | Built-in. Workers automatically have memory. |

---

## Auth Types

Capabilities require different authentication methods:

| Auth Type | Description | Setup |
|-----------|-------------|-------|
| `null` | No authentication needed | Runs locally |
| `oauth` | OAuth 2.0 flow | Browser-based authorization |
| `api_key` | API key | Paste key into CLI |
| `connection_string` | Database connection string | Provide connection URL |
| `bot_token` | Bot/app token | Paste token into CLI |
| `oauth_or_credentials` | OAuth or manual credentials | Choose method |
| `oauth_or_token` | OAuth or personal access token | Choose method |

---

## Capability Inference

Nooterra automatically infers which capabilities a worker needs from the task description. The `inferCapabilities(taskDescription)` function matches keywords:

| Keywords | Inferred Capability |
|----------|-------------------|
| `browse`, `website`, `web page`, `scrape`, `url`, `http`, `price`, `competitor`, `amazon`, `linkedin`, `twitter`, `reddit`, `news`, `blog` | `browser` |
| `slack`, `channel`, `message`, `dm`, `thread` | `slack` |
| `email`, `inbox`, `gmail`, `outlook`, `mail` | `email` |
| `discord`, `server`, `role` | `discord` |
| `sms`, `text message`, `twilio`, `phone` | `sms` |
| `github`, `repo`, `issue`, `pull request`, `pr`, `commit`, `branch`, `merge` | `github` |
| `file`, `folder`, `directory`, `local` | `filesystem` |
| `command`, `terminal`, `shell`, `bash`, `script`, `execute` | `terminal` |
| `postgres`, `postgresql`, `database`, `sql query` | `postgres` |
| `sqlite`, `local database` | `sqlite` |
| `notion`, `page`, `block`, `workspace` | `notion` |
| `spreadsheet`, `google sheet`, `excel`, `csv` | `googleSheets` |
| `calendar`, `event`, `meeting`, `schedule`, `appointment` | `calendar` |
| `stripe`, `payment`, `charge`, `refund`, `subscription`, `invoice` | `stripe` |
| `shopify`, `inventory`, `fulfillment`, `e-commerce` | `shopify` |
| `search`, `google`, `find`, `lookup`, `research` | `webSearch` |
| `webhook`, `api`, `http`, `endpoint`, `callback` | `webhook` |
| `remember`, `track`, `history`, `previous`, `last time`, `context` | `memory` |
