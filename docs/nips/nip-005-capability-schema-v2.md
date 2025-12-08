# NIP-005: Capability Schema V2

| Field | Value |
|-------|-------|
| NIP | 005 |
| Title | Capability Schema V2 |
| Author | Nooterra Team |
| Status | Draft |
| Created | 2025-12-07 |

## Abstract

Extend capability schemas to support streaming outputs, typed errors, authentication requirements, and richer metadata.

## Specification

### Full Schema

```json
{
  "$schema": "https://nooterra.ai/schemas/capability-v2.json",
  "capability": "cap.llm.chat.v2",
  "version": "2.0.0",
  "name": "LLM Chat Completion",
  "description": "Generate chat completions using large language models",
  
  "input": {
    "type": "object",
    "required": ["messages"],
    "properties": {
      "messages": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "role": { "enum": ["system", "user", "assistant"] },
            "content": { "type": "string" }
          }
        }
      },
      "model": { "type": "string", "default": "gpt-4" },
      "temperature": { "type": "number", "minimum": 0, "maximum": 2 },
      "stream": { "type": "boolean", "default": false }
    }
  },
  
  "output": {
    "type": "object",
    "streaming": true,
    "streamEvents": ["token", "chunk", "done"],
    "properties": {
      "content": { "type": "string" },
      "model": { "type": "string" },
      "usage": {
        "type": "object",
        "properties": {
          "promptTokens": { "type": "integer" },
          "completionTokens": { "type": "integer" }
        }
      }
    }
  },
  
  "errors": [
    {
      "code": "rate_limited",
      "description": "Too many requests",
      "retryable": true,
      "retryAfterMs": 1000
    },
    {
      "code": "context_too_long",
      "description": "Input exceeds model context window",
      "retryable": false
    },
    {
      "code": "content_filtered",
      "description": "Output blocked by safety filters",
      "retryable": false
    }
  ],
  
  "auth": {
    "required": true,
    "methods": ["api_key", "oauth"],
    "scopes": ["llm:chat"]
  },
  
  "pricing": {
    "model": "per_token",
    "inputCostPer1k": 0.01,
    "outputCostPer1k": 0.03
  },
  
  "limits": {
    "maxInputTokens": 128000,
    "maxOutputTokens": 4096,
    "rateLimit": { "requests": 100, "windowSeconds": 60 }
  },
  
  "metadata": {
    "category": "nlp",
    "tags": ["llm", "chat", "completion"],
    "examples": [
      {
        "input": { "messages": [{"role": "user", "content": "Hello"}] },
        "output": { "content": "Hi there! How can I help?" }
      }
    ]
  }
}
```

### Streaming Events

For `streaming: true` capabilities:

```
event: token
data: {"token": "Hello"}

event: token  
data: {"token": " world"}

event: done
data: {"content": "Hello world", "usage": {"promptTokens": 5, "completionTokens": 2}}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "rate_limited",
    "message": "Too many requests",
    "retryable": true,
    "retryAfterMs": 5000
  }
}
```

### Capability Inheritance

```json
{
  "capability": "cap.llm.summarize.v1",
  "extends": "cap.llm.chat.v1",
  "input": {
    "required": ["text"],
    "properties": {
      "text": { "type": "string" },
      "maxLength": { "type": "integer", "default": 100 }
    }
  }
}
```

## Copyright

Public domain.
