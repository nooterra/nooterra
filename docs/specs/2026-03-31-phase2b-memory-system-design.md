# Phase 2B: Agent Memory System

**Date**: 2026-03-31
**Status**: Approved
**Goal**: Replace flat key-value memory with a structured, auto-extracting memory system that gives agents recall without relying on explicit REMEMBER markers.

---

## Problems with current memory

1. **Agent must explicitly remember** — only REMEMBER: markers create memories. If the LLM forgets to say REMEMBER, the fact is lost.
2. **All memories loaded every time** — `LIMIT 50 ORDER BY updated_at DESC` dumps the 50 most recent memories into the prompt regardless of relevance. Wastes tokens.
3. **No structure** — everything is a flat string. Can't search by entity, tool, or category.
4. **No auto-extraction** — the system doesn't learn from what happened, only from what the agent says to remember.

## Design

### New migration: `055_structured_memory.sql`

Add columns to `worker_memory` (additive, backward compatible):

```sql
ALTER TABLE worker_memory ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'semantic';
ALTER TABLE worker_memory ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE worker_memory ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE worker_memory ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE worker_memory ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_worker_memory_type ON worker_memory (worker_id, memory_type);
```

Memory types:
- `semantic` — facts the agent learned (from REMEMBER markers, or auto-extracted entities/preferences)
- `episodic` — what happened in a specific execution (auto-extracted: tool calls, outcomes, entities)
- `procedural` — learned strategies (Phase 3, not implemented here)

Sources:
- `agent` — explicitly created via REMEMBER/TEAM_NOTE
- `system` — auto-extracted by the runtime after execution

### New file: `services/runtime/memory.ts`

Responsibilities:
1. **Auto-extract memories** from execution results — parse tool calls, extract entities (email addresses, names, amounts), record outcomes
2. **Relevance-scored loading** — instead of loading all memories, score by recency + access frequency + keyword overlap with current task
3. **Memory retrieval** — load top-K relevant memories for the current execution context
4. Backward-compatible with existing REMEMBER/TEAM_NOTE flow

### Changes to `server.js`

- Replace `loadWorkerMemory()` call with new `loadRelevantMemories()` from memory.ts
- After execution, call `extractAndStoreMemories()` to auto-create episodic memories
- Keep existing `parseMemoryEntries()` + `saveWorkerMemory()` for REMEMBER/TEAM_NOTE (these create semantic memories)

---

## PR Breakdown

### PR 1: Migration + memory module + tests
- New: `055_structured_memory.sql`
- New: `services/runtime/memory.ts`
- New: `test/runtime-memory.test.js`
- Types: add MemoryEntry interface to types.ts

### PR 2: Wire into execution loop
- Modify: `server.js` — use relevance-scored loading, auto-extract after execution
