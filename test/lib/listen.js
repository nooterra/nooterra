import fs from "node:fs/promises";
import { unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const LOCK_PATH = path.join(os.tmpdir(), "nooterra-test-listen.lock");

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function removeStaleLock() {
  try {
    const content = await fs.readFile(LOCK_PATH, "utf8");
    const pid = Number(content.trim());
    if (Number.isFinite(pid) && pid > 0 && !isProcessRunning(pid)) {
      await fs.unlink(LOCK_PATH).catch(() => {});
    }
  } catch {
    // lock file doesn't exist or can't be read — nothing to do
  }
}

function cleanupLockSync() {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // ignore
  }
}

async function acquireListenLock({ timeoutMs = 15_000, pollMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  // Remove stale lock from a previously crashed process before entering the poll loop
  await removeStaleLock();
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(LOCK_PATH, "wx");
      // Write our PID so other processes can detect staleness
      await handle.write(String(process.pid));
      await handle.datasync();

      // Register cleanup handlers so the lock is removed even on crash/signal
      const onExit = () => cleanupLockSync();
      const onSignal = () => { cleanupLockSync(); process.exit(1); };
      process.on("exit", onExit);
      process.on("SIGTERM", onSignal);
      process.on("SIGINT", onSignal);

      return {
        async release() {
          process.removeListener("exit", onExit);
          process.removeListener("SIGTERM", onSignal);
          process.removeListener("SIGINT", onSignal);
          try {
            await handle.close();
          } catch {
            // ignore
          }
          try {
            await fs.unlink(LOCK_PATH);
          } catch {
            // ignore
          }
        }
      };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      // Check if the holder is still alive before waiting
      await removeStaleLock();
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  throw new Error("timeout acquiring listen lock");
}

export async function listenOnEphemeralLoopback(server, { hosts = ["127.0.0.1", "localhost", "::1", null] } = {}) {
  if (!server || typeof server.listen !== "function") throw new TypeError("server is required");
  let lastErr = null;

  for (const host of hosts) {
    try {
      const lock = await acquireListenLock();
      try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          server.off("error", onError);
        };
        server.on("error", onError);
        const onListening = () => {
          cleanup();
          resolve();
        };
        if (host === null) {
          server.listen(0, onListening);
        } else {
          server.listen(0, host, onListening);
        }
      });
      } finally {
        await lock.release();
      }

      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : null;
      if (!Number.isInteger(port) || port <= 0) throw new TypeError("server did not bind to an ephemeral port");
      return { host, port };
    } catch (err) {
      lastErr = err;
      try {
        await new Promise((resolve) => server.close(resolve));
      } catch {
        // ignore
      }
      const code = err?.code ?? null;
      if (code === "EPERM" || code === "EACCES" || code === "EADDRNOTAVAIL") continue;
      throw err;
    }
  }

  const fail = new Error("unable to bind test server on loopback");
  fail.cause = lastErr;
  throw fail;
}
