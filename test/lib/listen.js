import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function acquireListenLock({ timeoutMs = 15_000, pollMs = 25 } = {}) {
  const lockPath = path.join(os.tmpdir(), "nooterra-test-listen.lock");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(lockPath, "wx");
      return {
        async release() {
          try {
            await handle.close();
          } catch {
            // ignore
          }
          try {
            await fs.unlink(lockPath);
          } catch {
            // ignore
          }
        }
      };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
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
