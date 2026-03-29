---
title: "AI Providers"
description: "How the Nooterra web platform handles AI providers, models, and fallback routing."
---

# AI Providers

Nooterra supports multiple AI providers. Each worker uses one provider to power its reasoning and tool use. You can swap providers at any time without losing your workers, charters, knowledge, or execution history.

## Web Platform (Default)

On the web platform at [nooterra.ai](https://nooterra.ai), AI providers are handled automatically. You don't need to configure API keys or manage credentials.

<Tabs>
  <Tab title="Primary: ChatGPT (Codex API)">
    The default provider for all web platform workers. Uses OpenAI's Codex API via your Nooterra account — **no additional cost**.

    | Setting | Value |
    |---------|-------|
    | Provider | ChatGPT (Codex API) |
    | Cost | $0 (included) |
    | Default model | `gpt-5.4-mini` |
    | Models | `gpt-5.4-mini`, `gpt-5.4-codex` |
  </Tab>
  <Tab title="Fallback: OpenRouter (Paid)">
    When the primary provider is unavailable or rate-limited, workers automatically fall back to OpenRouter. This uses paid API credits.

    | Setting | Value |
    |---------|-------|
    | Provider | OpenRouter |
    | Cost | Per-token (billed to your account) |
    | Default model | `claude-haiku-4.5` |
    | Models | `claude-haiku-4.5`, `gemini-2.5-flash`, `gpt-5.4-mini` |
  </Tab>
</Tabs>

<Note>
The web platform automatically selects the best available model for each worker. You can override the model from **Workers > [Worker] > Settings > Model** in the dashboard.
</Note>

## Per-Worker Model Override

Each worker stores its provider and model at creation time. To change a worker's model:

1. Open the worker in the dashboard
2. Go to **Settings > Model**
3. Select from available models

The worker keeps its charter, knowledge, and execution history when you switch models.

## CLI Configuration

For developers using the Nooterra CLI, providers can be configured manually via environment variables:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GOOGLE_AI_API_KEY="AI..."
export OPENROUTER_API_KEY="sk-or-..."
```

The CLI supports these providers:

| Provider | Default Model | Auth |
|----------|--------------|------|
| ChatGPT (Codex) | `gpt-5.4-mini` | OAuth |
| OpenAI | `gpt-5.4-mini` | API key (`sk-`) |
| Anthropic | `claude-haiku-4.5` | API key (`sk-ant-`) |
| Google AI | `gemini-2.5-flash` | API key (`AI`) |
| OpenRouter | `claude-haiku-4.5` | API key (`sk-or-`) |
| Local (Ollama) | `llama3.1` | None |

## Streaming and Reliability

For providers that support it, Nooterra uses streaming responses with built-in reliability:

- **Stall detection**: If no tokens arrive for 15 seconds, a warning is emitted. After 30 seconds, a retry is triggered.
- **Circuit breaker**: After 3 consecutive failures to a provider, it enters a degraded state. Requests are blocked for 60 seconds, then a single probe is allowed to test recovery.
- **Automatic fallback**: On the web platform, if the primary provider fails, the worker automatically retries on the fallback provider.

## Cost Tracking

All execution costs are tracked in the dashboard under **Settings > Usage**. The web platform's ChatGPT (Codex API) provider is free. OpenRouter fallback usage is billed per-token to your account.
