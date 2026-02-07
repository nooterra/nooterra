import fs from "node:fs";
import crypto from "node:crypto";

function abortError() {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

export async function hashFile(filepath, { algo = "sha256", maxBytes = null, signal = null } = {}) {
  if (typeof filepath !== "string" || !filepath.trim()) throw new TypeError("filepath must be a non-empty string");
  if (typeof algo !== "string" || !algo.trim()) throw new TypeError("algo must be a non-empty string");
  if (maxBytes !== null && (!Number.isInteger(maxBytes) || maxBytes < 0)) throw new TypeError("maxBytes must be null or a non-negative integer");
  if (signal !== null && typeof signal !== "object") throw new TypeError("signal must be null or an AbortSignal-like object");

  if (signal?.aborted) throw abortError();

  const hash = crypto.createHash(algo);
  let total = 0;

  const stream = fs.createReadStream(filepath, { signal: signal ?? undefined });
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw abortError();
      hash.update(chunk);
      if (maxBytes !== null) {
        total += chunk.length;
        if (total > maxBytes) throw new Error("maxBytes exceeded");
      }
    }
  } catch (err) {
    stream.destroy();
    throw err;
  }

  return hash.digest("hex");
}

