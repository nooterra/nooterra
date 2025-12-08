# NIP-006: Streaming Results via SSE

| Field | Value |
|-------|-------|
| NIP | 006 |
| Title | Streaming Results via SSE |
| Author | Nooterra Team |
| Status | Draft |
| Created | 2025-12-07 |
| Updated | 2025-12-07 |

## Abstract

Long-running workflow executions should stream partial results and progress updates to clients via Server-Sent Events (SSE). This enables real-time UIs and reduces perceived latency.

## Motivation

Current workflow API only returns results when the entire workflow completes. For workflows with multiple nodes or long-running LLM calls:

1. **Poor UX** - Users see a spinner for 30+ seconds with no feedback
2. **Timeout issues** - Long requests may hit HTTP timeouts
3. **No partial results** - Even if 4/5 nodes complete, failure on 5th loses all progress visibility
4. **No progress** - Can't show "50% complete" or "Processing node 3 of 5"

## Specification

### SSE Endpoint

```http
GET /v1/workflows/:workflowRunId/stream
Accept: text/event-stream
Authorization: Bearer <token>
```

### Event Types

| Event | Description | Data |
|-------|-------------|------|
| `connected` | Stream established | `{workflowRunId}` |
| `workflow.started` | Execution began | `{status, startedAt}` |
| `node.queued` | Node waiting for deps | `{nodeName, capability}` |
| `node.started` | Node execution began | `{nodeName, agentDid, startedAt}` |
| `node.progress` | Partial result/progress | `{nodeName, progress, partial?}` |
| `node.completed` | Node execution succeeded | `{nodeName, result, cost_cents, duration_ms}` |
| `node.failed` | Node execution failed | `{nodeName, error, retryCount}` |
| `workflow.completed` | All nodes done | `{status, totalCost, duration_ms}` |
| `workflow.failed` | Unrecoverable failure | `{status, error, failedNode}` |
| `heartbeat` | Keep-alive ping | `{}` |

### Event Format

```
event: node.started
id: evt_abc123
data: {"nodeName":"summarize","agentDid":"did:noot:agent1","startedAt":"2025-12-07T12:00:00Z"}

event: node.progress
id: evt_abc124
data: {"nodeName":"summarize","progress":0.5,"partial":"The article discusses..."}

event: node.completed
id: evt_abc125
data: {"nodeName":"summarize","result":{"text":"..."},"cost_cents":12,"duration_ms":1523}

event: heartbeat
id: evt_abc126
data: {}
```

### Client Implementation

```typescript
const eventSource = new EventSource(
  `${API_URL}/v1/workflows/${runId}/stream`,
  { headers: { Authorization: `Bearer ${token}` } }
);

eventSource.addEventListener('node.progress', (e) => {
  const data = JSON.parse(e.data);
  updateUI(data.nodeName, data.progress, data.partial);
});

eventSource.addEventListener('workflow.completed', (e) => {
  const data = JSON.parse(e.data);
  showResults(data);
  eventSource.close();
});

eventSource.addEventListener('workflow.failed', (e) => {
  const data = JSON.parse(e.data);
  showError(data.error);
  eventSource.close();
});
```

### Server Implementation

```typescript
app.get("/v1/workflows/:runId/stream", async (request, reply) => {
  const { runId } = request.params;
  
  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Subscribe to workflow events
  const subscriber = new WorkflowSubscriber(runId);
  
  subscriber.on('event', (type: string, data: any) => {
    const id = `evt_${Date.now().toString(36)}`;
    reply.raw.write(`event: ${type}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`);
  });

  // Heartbeat every 15 seconds
  const heartbeat = setInterval(() => {
    reply.raw.write(`:heartbeat\n\n`);
  }, 15000);

  // Cleanup on disconnect
  request.raw.on('close', () => {
    clearInterval(heartbeat);
    subscriber.unsubscribe();
  });

  // Initial connection event
  reply.raw.write(`event: connected\ndata: {"workflowRunId":"${runId}"}\n\n`);
  
  // Load current state (replay events if workflow already started)
  await subscriber.replayCurrentState();
});
```

### Progress Reporting from Agents

Agents can report progress via the result endpoint:

```http
POST /v1/workflows/nodeResult
Content-Type: application/json

{
  "taskId": "wf_123",
  "nodeName": "summarize",
  "type": "progress",
  "progress": 0.5,
  "partial": {
    "text": "Partial summary so far..."
  }
}
```

Progress events are forwarded to all SSE subscribers.

### LLM Token Streaming

For LLM capabilities, agents can stream tokens:

```typescript
// Agent implementation
async function handleSummarize(input: { text: string }) {
  const stream = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: `Summarize: ${input.text}` }],
    stream: true,
  });

  let fullText = "";
  let tokenCount = 0;
  
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content || "";
    fullText += token;
    tokenCount++;
    
    // Report progress every 50 tokens
    if (tokenCount % 50 === 0) {
      await reportProgress({
        progress: Math.min(0.99, tokenCount / 500), // Estimate
        partial: { text: fullText },
      });
    }
  }

  return { text: fullText };
}
```

### Reconnection

Clients should implement reconnection with `Last-Event-ID`:

```typescript
eventSource.onerror = () => {
  setTimeout(() => {
    // Reconnect with last event ID
    const newSource = new EventSource(
      `${API_URL}/v1/workflows/${runId}/stream`,
      { 
        headers: { 
          Authorization: `Bearer ${token}`,
          'Last-Event-ID': lastEventId,
        } 
      }
    );
  }, 1000);
};
```

Server respects `Last-Event-ID` and replays missed events.

## Rationale

### Why SSE over WebSocket?

- Simpler implementation
- Native browser support
- Unidirectional (client doesn't send)
- Works through proxies
- Automatic reconnection

### Why not polling?

- Higher latency (seconds vs milliseconds)
- Wasted requests when no updates
- More server load

### Why heartbeat every 15s?

- Cloudflare closes idle connections after 100s
- 15s provides margin with minimal overhead

## Backwards Compatibility

This is an additive feature. Existing `/v1/workflows/:id` endpoint continues to work for non-streaming use cases.

## Security Considerations

1. **Authentication** - Require valid JWT/API key
2. **Authorization** - Verify user owns the workflow
3. **Rate Limiting** - Max 10 concurrent streams per project
4. **Timeout** - Close streams after 1 hour inactive

## Reference Implementation

See PR: `#XXX` (to be created)

Note: Streaming routes already exist in `apps/coordinator/src/routes/streaming.ts`

## Copyright

This document is placed in the public domain.
