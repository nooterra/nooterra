import crypto from "node:crypto";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

class InMemoryQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
  }

  size() {
    return this.items.length;
  }

  enqueue(item) {
    if (this.waiters.length) {
      const waiter = this.waiters.shift();
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  async dequeue() {
    if (this.items.length) return this.items.shift();
    return await new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

function jobId() {
  return `vq_${crypto.randomBytes(16).toString("hex")}`;
}

export function createVerifyQueue({
  workerCount = 1,
  maxAttempts = 3,
  retryBackoffMs = 250,
  handler,
  onRetry = null,
  onDeadLetter = null,
  onDepthChange = null
} = {}) {
  if (typeof handler !== "function") throw new TypeError("handler is required");
  const workers = Math.max(1, Number.parseInt(String(workerCount ?? "1"), 10) || 1);
  const queue = new InMemoryQueue();
  const deadLetters = [];
  let closed = false;

  function emitDepth() {
    if (typeof onDepthChange === "function") {
      try {
        onDepthChange(queue.size());
      } catch {
        // ignore
      }
    }
  }

  function enqueue(entry) {
    queue.enqueue(entry);
    emitDepth();
  }

  function requeue(entry) {
    const backoff = Math.max(0, Math.trunc(retryBackoffMs * Math.pow(2, Math.max(0, entry.attempt - 1))));
    setTimeout(() => {
      if (closed) return;
      enqueue(entry);
    }, backoff);
  }

  async function workerLoop() {
    while (!closed) {
      const entry = await queue.dequeue();
      emitDepth();
      if (!entry || closed) continue;
      const startedAtMs = Date.now();
      let out = null;
      try {
        out = await handler(entry.payload);
      } catch (err) {
        out = { ok: false, error: "VERIFY_QUEUE_HANDLER_ERROR", detail: { message: err?.message ?? String(err ?? "") } };
      }

      const ok = Boolean(out?.ok);
      if (ok) {
        entry.resolve({
          ...out,
          queued: {
            id: entry.id,
            attempt: entry.attempt,
            startedAt: new Date(startedAtMs).toISOString(),
            finishedAt: new Date().toISOString(),
            latencyMs: Math.max(0, Date.now() - entry.enqueuedAtMs)
          }
        });
        continue;
      }

      if (entry.attempt < maxAttempts) {
        entry.attempt += 1;
        if (typeof onRetry === "function") {
          try {
            onRetry({ id: entry.id, attempt: entry.attempt, error: out?.error ?? "VERIFY_FAILED" });
          } catch {
            // ignore
          }
        }
        requeue(entry);
        continue;
      }

      const dead = {
        id: entry.id,
        attempt: entry.attempt,
        enqueuedAt: new Date(entry.enqueuedAtMs).toISOString(),
        failedAt: new Date().toISOString(),
        payload: entry.payload,
        result: out
      };
      deadLetters.push(dead);
      if (typeof onDeadLetter === "function") {
        try {
          onDeadLetter(dead);
        } catch {
          // ignore
        }
      }
      entry.resolve({
        ok: false,
        error: out?.error ?? "VERIFY_QUEUE_DEAD_LETTER",
        detail: out?.detail ?? null,
        deadLetter: dead
      });
    }
  }

  for (let i = 0; i < workers; i += 1) {
    workerLoop().catch(() => {
      // ignore worker loop failures; per-job failures are reported through queue outputs.
    });
  }

  return {
    async submit(payload) {
      if (closed) return { ok: false, error: "VERIFY_QUEUE_CLOSED" };
      return await new Promise((resolve) => {
        enqueue({ id: jobId(), payload, attempt: 1, enqueuedAtMs: Date.now(), resolve });
      });
    },
    stats() {
      return { queued: queue.size(), workers, deadLetters: deadLetters.length };
    },
    deadLetters() {
      return [...deadLetters];
    },
    async drain({ timeoutMs = 30_000 } = {}) {
      const started = Date.now();
      while (queue.size() > 0) {
        if (Date.now() - started > timeoutMs) return { ok: false, error: "VERIFY_QUEUE_DRAIN_TIMEOUT" };
        // eslint-disable-next-line no-await-in-loop
        await sleep(10);
      }
      return { ok: true };
    },
    close() {
      closed = true;
      while (queue.waiters.length) {
        const waiter = queue.waiters.shift();
        waiter(null);
      }
    }
  };
}

