/**
 * Structured memory module — episodic extraction, relevance scoring, and retrieval.
 */

import type { MemoryEntry } from './types.ts';

// ── Types ───────────────────────────────────────────────

export interface ExtractedMemory {
  key: string;
  value: string;
  metadata: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, '0').slice(0, 8);
}

function extractToolName(detail: string): string {
  // "Called send_email to vendor@acme.com …" → "send_email"
  const match = detail.match(/(?:Called\s+)?(\S+)/i);
  return match ? match[1] : 'unknown';
}

// ── 1. extractEpisodicMemories ─────────────────────────

export function extractEpisodicMemories(
  activity: { type: string; detail: string; ts: string }[],
  result: string | null,
): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];

  // Tool call memories
  for (const entry of activity) {
    if (entry.type === 'tool_call' || entry.type === 'tool_result') {
      const toolName = extractToolName(entry.detail);
      const hash = simpleHash(toolName + entry.ts);
      memories.push({
        key: `ep_${toolName}_${hash}`,
        value: `${entry.detail.slice(0, 200)}`,
        metadata: { tool: toolName, execution_id: null },
      });
    }
  }

  // Entity extraction from result text
  if (result) {
    const seen = new Set<string>();

    // Emails
    const emails = result.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    for (const email of emails) {
      const normalized = email.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        memories.push({
          key: `entity_${normalized.replace(/[^a-z0-9]/g, '_')}`,
          value: `Interacted with ${normalized}`,
          metadata: { entity_type: 'email' },
        });
      }
    }

    // Domain names (standalone, not part of email)
    const domains = result.match(/(?<![@\w])[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?/g) || [];
    for (const domain of domains) {
      const normalized = domain.toLowerCase();
      // Skip if already captured as part of an email
      if (!seen.has(normalized)) {
        seen.add(normalized);
        memories.push({
          key: `entity_${normalized.replace(/[^a-z0-9]/g, '_')}`,
          value: `Interacted with ${normalized}`,
          metadata: { entity_type: 'domain' },
        });
      }
    }

    // Monetary amounts
    const amounts = result.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
    for (const amount of amounts) {
      if (!seen.has(amount)) {
        seen.add(amount);
        memories.push({
          key: `entity_${amount.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
          value: `Interacted with ${amount}`,
          metadata: { entity_type: 'amount' },
        });
      }
    }
  }

  // Cap at 10
  return memories.slice(0, 10);
}

// ── 2. scoreMemory ─────────────────────────────────────

export function scoreMemory(
  memory: { key: string; value: string; memory_type: string; access_count: number; updated_at: string },
  taskContext: string,
): number {
  let score = 0;

  // Recency (0-40)
  const ageMs = Date.now() - new Date(memory.updated_at).getTime();
  const oneDay = 86_400_000;
  if (ageMs < oneDay) score += 40;
  else if (ageMs < 7 * oneDay) score += 25;
  else if (ageMs < 30 * oneDay) score += 10;

  // Frequency (0-20)
  score += Math.min(20, memory.access_count * 4);

  // Keyword overlap (0-40)
  const contextWords = taskContext.toLowerCase().split(/\s+/).filter(Boolean);
  if (contextWords.length > 0) {
    const memoryText = `${memory.key} ${memory.value}`.toLowerCase();
    let matches = 0;
    for (const word of contextWords) {
      if (memoryText.includes(word)) matches++;
    }
    score += Math.min(40, Math.round((matches / contextWords.length) * 40));
  }

  return score;
}

// ── 3. loadRelevantMemories ────────────────────────────

export async function loadRelevantMemories(
  pool: any,
  workerId: string,
  tenantId: string,
  taskContext: string,
  limit: number = 20,
): Promise<MemoryEntry[]> {
  const { rows } = await pool.query(
    `SELECT id, worker_id, tenant_id, key, value, scope, memory_type, source,
            metadata, access_count, last_accessed_at, updated_at, expires_at
     FROM worker_memory
     WHERE (worker_id = $1 OR (tenant_id = $2 AND scope = 'team'))
       AND (expires_at IS NULL OR expires_at > now())`,
    [workerId, tenantId],
  );

  // Score and sort
  const scored = rows.map((m: MemoryEntry) => ({
    memory: m,
    score: scoreMemory(m, taskContext),
  }));
  scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);

  const top = scored.slice(0, limit).map((s: { memory: MemoryEntry }) => s.memory);

  // Batch update access_count and last_accessed_at
  if (top.length > 0) {
    const ids = top.map((m: MemoryEntry) => m.id);
    await pool.query(
      `UPDATE worker_memory
       SET access_count = access_count + 1, last_accessed_at = now()
       WHERE id = ANY($1)`,
      [ids],
    );
  }

  return top;
}

// ── 4. storeEpisodicMemories ───────────────────────────

export async function storeEpisodicMemories(
  pool: any,
  workerId: string,
  tenantId: string,
  executionId: string,
  memories: ExtractedMemory[],
): Promise<void> {
  for (const mem of memories) {
    const metadata = { ...mem.metadata, execution_id: executionId };
    await pool.query(
      `INSERT INTO worker_memory (id, worker_id, tenant_id, key, value, scope, memory_type, source, metadata, updated_at)
       VALUES (
         'mem_' || substr(md5(random()::text), 1, 24),
         $1, $2, $3, $4, 'worker', 'episodic', 'system', $5, now()
       )
       ON CONFLICT (worker_id, key) DO UPDATE
         SET value = EXCLUDED.value,
             metadata = EXCLUDED.metadata,
             memory_type = EXCLUDED.memory_type,
             source = EXCLUDED.source,
             updated_at = now()`,
      [workerId, tenantId, mem.key, mem.value, JSON.stringify(metadata)],
    );
  }
}
