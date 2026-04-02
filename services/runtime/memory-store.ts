/**
 * Worker Memory Store — Postgres-backed persistent memory per worker.
 * Extracted from server.js.
 */

import type pg from 'pg';

export interface MemoryEntry {
  key: string;
  value: string;
  scope: string;
  updated_at: string;
}

export interface ParsedMemoryEntry {
  content: string;
  scope: 'worker' | 'team';
}

/** Load worker-specific AND team-wide shared memory */
export async function loadWorkerMemory(pool: pg.Pool, workerId: string, tenantId: string): Promise<MemoryEntry[]> {
  try {
    const result = await pool.query(
      `SELECT key, value, scope, updated_at FROM worker_memory
       WHERE (worker_id = $1 OR (tenant_id = $2 AND scope = 'team'))
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY updated_at DESC LIMIT 50`,
      [workerId, tenantId]
    );
    return result.rows;
  } catch {
    return [];
  }
}

/** Save a memory entry (worker-scoped or team-scoped) */
export async function saveWorkerMemory(
  pool: pg.Pool,
  workerId: string,
  tenantId: string,
  key: string,
  value: string,
  scope: string = 'worker',
  generateId: (prefix?: string) => string,
  log: (level: string, msg: string) => void,
): Promise<void> {
  try {
    if (scope === 'team') {
      await pool.query(`
        INSERT INTO worker_memory (id, worker_id, tenant_id, key, value, scope, memory_type, source, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'semantic', 'agent', now())
        ON CONFLICT (tenant_id, key) DO UPDATE SET value = $5, updated_at = now()
      `, [generateId('mem'), workerId, tenantId, key, value, scope]);
    } else {
      await pool.query(`
        INSERT INTO worker_memory (id, worker_id, tenant_id, key, value, scope, memory_type, source, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'semantic', 'agent', now())
        ON CONFLICT (worker_id, key) DO UPDATE SET value = $5, updated_at = now()
      `, [generateId('mem'), workerId, tenantId, key, value, scope]);
    }
  } catch (err: any) {
    log('warn', `Failed to save worker memory for ${workerId}: ${err.message}`);
  }
}

/**
 * Parse REMEMBER: and TEAM_NOTE: entries from LLM output.
 * Supports single-line and multiline (END_REMEMBER/END_TEAM_NOTE) formats.
 */
export function parseMemoryEntries(text: string): ParsedMemoryEntry[] {
  const entries: ParsedMemoryEntry[] = [];
  const lines = text.split('\n');
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    let tag: string | null = null;
    let scope: 'worker' | 'team' | null = null;
    let endMarker: string | null = null;

    if (trimmed.startsWith('REMEMBER:')) {
      tag = 'REMEMBER:';
      scope = 'worker';
      endMarker = 'END_REMEMBER';
    } else if (trimmed.startsWith('TEAM_NOTE:')) {
      tag = 'TEAM_NOTE:';
      scope = 'team';
      endMarker = 'END_TEAM_NOTE';
    }

    if (!tag || !scope || !endMarker) continue;

    const firstLine = trimmed.replace(new RegExp('^' + tag.replace(':', '\\:') + '\\s*', 'i'), '').trim();

    let multilineContent: string | null = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === endMarker) {
        const extraLines = lines.slice(i + 1, j).map(l => l.trimEnd());
        multilineContent = [firstLine, ...extraLines].join('\n').trim();
        i = j;
        break;
      }
      if (lines[j].trim().startsWith('REMEMBER:') || lines[j].trim().startsWith('TEAM_NOTE:')) break;
    }

    const content = multilineContent || firstLine;
    if (!content) continue;

    const key = content.slice(0, 80).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);

    entries.push({ content, scope });
  }

  return entries;
}

/** Ensure the worker_memory table exists (bootstrap, migrations preferred) */
export async function ensureWorkerMemoryTable(
  pool: pg.Pool,
  log: (level: string, msg: string) => void,
): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS worker_memory (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        tenant_id TEXT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'worker',
        expires_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (worker_id, key),
        UNIQUE (tenant_id, key)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_worker_memory_worker ON worker_memory (worker_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_worker_memory_tenant ON worker_memory (tenant_id, scope)`);
  } catch (err: any) {
    log('warn', `Could not create worker_memory table: ${err.message}`);
  }
}
