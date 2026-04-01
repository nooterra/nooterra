/**
 * Event router — listens on Postgres NOTIFY channels and dispatches
 * events to handlers.  Uses a dedicated pg.Client (not the pool) so
 * the LISTEN connection stays open.
 */

import pg from "pg";

// ── Payload types ───────────────────────────────────────

export interface ExecutionQueuedPayload {
  executionId: string;
  workerId: string;
  tenantId: string;
  triggerType: string;
}

export interface ApprovalDecidedPayload {
  executionId: string;
  workerId: string;
  decision: string;
}

export interface EventHandlers {
  onExecutionQueued: (payload: ExecutionQueuedPayload) => Promise<void>;
  onApprovalDecided: (payload: ApprovalDecidedPayload) => Promise<void>;
}

// ── Channels we care about ──────────────────────────────

const CHANNELS = ["execution_queued", "approval_decided"] as const;

// ── Payload helpers (exported for unit tests) ───────────

const REQUIRED_EXECUTION_QUEUED_FIELDS = [
  "execution_id",
  "worker_id",
  "tenant_id",
  "trigger_type",
] as const;

const REQUIRED_APPROVAL_DECIDED_FIELDS = [
  "execution_id",
  "worker_id",
  "decision",
] as const;

export function parseNotifyPayload(raw: string): ExecutionQueuedPayload | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  for (const field of REQUIRED_EXECUTION_QUEUED_FIELDS) {
    const val = (parsed as Record<string, unknown>)[field];
    if (typeof val !== "string" || val === "") return null;
  }

  return {
    executionId: parsed.execution_id as string,
    workerId: parsed.worker_id as string,
    tenantId: parsed.tenant_id as string,
    triggerType: parsed.trigger_type as string,
  };
}

export function parseApprovalPayload(raw: string): ApprovalDecidedPayload | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  for (const field of REQUIRED_APPROVAL_DECIDED_FIELDS) {
    const val = (parsed as Record<string, unknown>)[field];
    if (typeof val !== "string" || val === "") return null;
  }

  return {
    executionId: parsed.execution_id as string,
    workerId: parsed.worker_id as string,
    decision: parsed.decision as string,
  };
}

export function validatePayload(
  channel: string,
  payload: Record<string, string>,
): boolean {
  const required =
    channel === "execution_queued"
      ? REQUIRED_EXECUTION_QUEUED_FIELDS
      : channel === "approval_decided"
        ? REQUIRED_APPROVAL_DECIDED_FIELDS
        : [];

  for (const field of required) {
    const val = payload[field];
    if (typeof val !== "string" || val === "") return false;
  }
  return required.length > 0;
}

// ── Router lifecycle ────────────────────────────────────

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function startEventRouter(
  connectionString: string,
  handlers: EventHandlers,
  log: Logger,
): { stop: () => Promise<void>; healthy: () => boolean } {
  let client: pg.Client | null = null;
  let alive = true;
  let connected = false;
  let stopping = false;
  let backoff = 1000;
  const MAX_BACKOFF = 30_000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect() {
    if (stopping) return;
    try {
      client = new pg.Client({ connectionString });
      await client.connect();
      connected = true;
      backoff = 1000; // reset on success

      for (const ch of CHANNELS) {
        await client.query(`LISTEN ${ch}`);
      }
      log.info("[event-router] listening on", CHANNELS.join(", "));

      client.on("notification", (msg) => {
        if (!msg.payload) return;
        try {
          if (msg.channel === "execution_queued") {
            const p = parseNotifyPayload(msg.payload);
            if (p) handlers.onExecutionQueued(p).catch((e) => log.error("[event-router] handler error", e));
          } else if (msg.channel === "approval_decided") {
            const p = parseApprovalPayload(msg.payload);
            if (p) handlers.onApprovalDecided(p).catch((e) => log.error("[event-router] handler error", e));
          }
        } catch (e) {
          log.error("[event-router] dispatch error", e);
        }
      });

      client.on("error", (err) => {
        log.warn("[event-router] connection error, will reconnect", err.message);
        connected = false;
        scheduleReconnect();
      });

      client.on("end", () => {
        if (!stopping) {
          log.warn("[event-router] connection ended, will reconnect");
          connected = false;
          scheduleReconnect();
        }
      });
    } catch (err) {
      log.error("[event-router] connect failed", (err as Error).message);
      connected = false;
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (stopping || reconnectTimer) return;
    log.info(`[event-router] reconnecting in ${backoff}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  }

  // Kick off
  connect();

  return {
    healthy: () => alive && connected,
    stop: async () => {
      stopping = true;
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (client) {
        try { await client.end(); } catch { /* ignore */ }
      }
      connected = false;
    },
  };
}
