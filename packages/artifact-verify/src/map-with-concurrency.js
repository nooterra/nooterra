function abortError() {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

export async function mapWithConcurrency(items, concurrency, mapper, { signal = null } = {}) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError("concurrency must be a positive integer");
  if (typeof mapper !== "function") throw new TypeError("mapper must be a function");
  if (signal !== null && typeof signal !== "object") throw new TypeError("signal must be null or an AbortSignal-like object");
  if (signal?.aborted) throw abortError();

  const results = new Array(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(concurrency, items.length || 1);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (signal?.aborted) throw abortError();
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      // eslint-disable-next-line no-await-in-loop
      results[i] = await mapper(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

