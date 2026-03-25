---
title: "AI Providers"
description: "Set up ChatGPT, OpenAI, Anthropic, Gemini, OpenRouter, Groq, or Ollama."
---

# AI Providers

Nooterra supports multiple AI providers. Each worker uses one provider to power its reasoning and tool use. You can swap providers at any time without losing your workers, charters, knowledge, or execution history.

## Supported Providers

### ChatGPT (Subscription)

Use your existing ChatGPT subscription. Connects via OAuth -- no API key needed.

| Setting | Value |
|---------|-------|
| ID | `chatgpt` |
| Auth | OAuth (opens browser) |
| Default model | `gpt-5.3-codex` |
| Models | `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2-codex` |
| API base | `https://chatgpt.com/backend-api` |

**Setup:**

```
> /auth
  1  ChatGPT (use your subscription -- recommended)
```

Opens your browser to authorize Nooterra with your ChatGPT account. Tokens are stored encrypted in `~/.nooterra/credentials/`.

### OpenAI (API Key)

Direct access to OpenAI models via API key.

| Setting | Value |
|---------|-------|
| ID | `openai` |
| Auth | API key (prefix: `sk-`) |
| Default model | `gpt-4o-mini` |
| Models | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo` |
| Env var | `OPENAI_API_KEY` |
| Get a key | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

**Setup:**

```
> /auth
  2  OpenAI API key
  Paste your OpenAI API key: sk-...
```

### Anthropic

Claude models from Anthropic.

| Setting | Value |
|---------|-------|
| ID | `anthropic` |
| Auth | API key (prefix: `sk-ant-`) |
| Default model | `claude-3-5-sonnet-20241022` |
| Models | `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229` |
| Env var | `ANTHROPIC_API_KEY` |
| Get a key | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |

**Setup:**

```
> /auth
  3  Anthropic API key
  Paste your Anthropic API key: sk-ant-...
```

Uses the Anthropic Messages API with native tool_use support and streaming.

### Google AI (Gemini)

Google's Gemini models.

| Setting | Value |
|---------|-------|
| ID | `google` |
| Auth | API key (prefix: `AI`) |
| Default model | `gemini-1.5-flash` |
| Models | `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-pro` |
| Env var | `GOOGLE_AI_API_KEY` |
| Get a key | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |

### OpenRouter

Access 200+ models through a single API. Useful for switching between providers without reconfiguring.

| Setting | Value |
|---------|-------|
| ID | `openrouter` |
| Auth | API key (prefix: `sk-or-`) |
| Default model | `anthropic/claude-3.5-sonnet` |
| Models | `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, `meta-llama/llama-3.1-405b` |
| Env var | `OPENROUTER_API_KEY` |
| Get a key | [openrouter.ai/keys](https://openrouter.ai/keys) |

OpenRouter uses the OpenAI-compatible chat completions API.

### Groq

Fast inference with a free tier. Good for development and testing.

| Setting | Value |
|---------|-------|
| ID | `groq` |
| Auth | API key (prefix: `gsk_`) |
| Default model | `llama-3.1-70b-versatile` |
| Models | `llama-3.1-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768` |
| Env var | `GROQ_API_KEY` |
| Get a key | [console.groq.com/keys](https://console.groq.com/keys) |

Groq uses the OpenAI-compatible chat completions API.

### Local (Ollama)

Run models locally with zero cost and full privacy. No API key required.

| Setting | Value |
|---------|-------|
| ID | `local` |
| Auth | None |
| Default model | `llama3.1` |
| Models | `llama3.1`, `mistral`, `codellama` |
| API base | `http://localhost:11434` |
| Get Ollama | [ollama.ai](https://ollama.ai) |

**Setup:**

```
> /auth
  6  Local (Ollama -- free, runs on your machine)
```

Make sure Ollama is running: `ollama serve`.

## Switching Providers

Run `/auth` at any time to change the default provider:

```
> /auth
```

This launches the same provider selection flow as first-run onboarding. Workers keep their charter, knowledge, and execution history when you switch.

## Environment Variables

You can also configure providers via environment variables instead of (or in addition to) the `/auth` flow:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GOOGLE_AI_API_KEY="AI..."
export OPENROUTER_API_KEY="sk-or-..."
export GROQ_API_KEY="gsk_..."
```

## Credential Storage

All credentials are encrypted at rest using AES-256-CBC with a machine-specific key derived from hostname, username, platform, and architecture. Credentials are stored in `~/.nooterra/credentials/` with `0o700` permissions. Keys never leave your machine.

## Per-Worker Providers

Each worker stores its provider and model at creation time. By default, workers use whatever provider is active when they are created. The provider and model are saved in the worker definition.

## Streaming Execution

For providers that support it, Nooterra uses streaming responses. The streaming executor shows tokens as they arrive and includes:

- **Stall detection**: If no tokens arrive for 15 seconds, a warning is emitted. After 30 seconds, a retry is triggered.
- **Circuit breaker**: After 3 consecutive failures to a provider, it enters a degraded state. Requests are blocked for 60 seconds, then a single probe is allowed to test recovery.
- **Heartbeat**: Every 5 seconds during execution, a heartbeat event is emitted with the current phase and timeline.

Two provider-specific streaming paths are implemented:

| Provider Type | Streaming API |
|--------------|-------------|
| Anthropic | Anthropic Messages API with SSE events (`content_block_start`, `content_block_delta`, `content_block_stop`) |
| OpenAI-compatible (OpenAI, OpenRouter, Groq) | OpenAI Chat Completions with `stream: true` |

Both paths support tool calls within the streaming response.

## Provider Health

Check the health of configured providers:

```
> /health
```

```
  Provider Health

    ChatGPT: healthy  p95: 1200ms
    OpenAI: healthy  p95: 800ms
    Anthropic: down
```

Circuit breaker states:
- **CLOSED** (healthy): Normal operation
- **OPEN** (down): Provider blocked after repeated failures, waiting for cooldown
- **HALF-OPEN** (testing): Cooldown expired, allowing a single probe request

## Cost Tracking

View estimated costs across all providers:

```
> /cost
```

```
  Cost Summary

    ChatGPT: $0.0000 (0 calls)
    OpenAI: $0.1234 (45 calls)
```

Cost estimates use rough per-token pricing: $0.01/1K input tokens, $0.03/1K output tokens for GPT-4 class models.
