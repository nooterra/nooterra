function assertFetchFunction(fetchImpl) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch must be a function");
  return fetchImpl;
}

function normalizeHeaderName(name, fallback) {
  const raw = typeof name === "string" && name.trim() !== "" ? name.trim() : fallback;
  return raw.toLowerCase();
}

function cloneBodyForRetry(body) {
  if (body === null || body === undefined) return { ok: true, value: undefined };
  if (typeof body === "string") return { ok: true, value: body };
  if (body instanceof URLSearchParams) return { ok: true, value: new URLSearchParams(body) };
  if (body instanceof ArrayBuffer) return { ok: true, value: body.slice(0) };
  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return { ok: true, value: Uint8Array.from(bytes) };
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) return { ok: true, value: Buffer.from(body) };
  return { ok: false, reason: "body_not_replayable" };
}

function normalizeInitHeaders(initHeaders) {
  const out = new Headers();
  if (!initHeaders) return out;
  const input = new Headers(initHeaders);
  for (const [k, v] of input.entries()) out.set(k, v);
  return out;
}

function buildRetryInit(init, { gateHeaderName, gateId }) {
  const safeInit = init && typeof init === "object" ? init : {};
  const bodyResult = cloneBodyForRetry(safeInit.body);
  if (!bodyResult.ok) {
    const err = new Error("x402 autopay cannot replay this request body");
    err.code = "SETTLD_AUTOPAY_BODY_NOT_REPLAYABLE";
    throw err;
  }

  const headers = normalizeInitHeaders(safeInit.headers);
  headers.set(gateHeaderName, gateId);

  return {
    ...safeInit,
    headers,
    body: bodyResult.value
  };
}

export async function fetchWithSettldAutopay(url, init = {}, opts = {}) {
  const fetchImpl = assertFetchFunction(opts?.fetch ?? globalThis.fetch);
  const gateHeaderName = normalizeHeaderName(opts?.gateHeaderName, "x-settld-gate-id");
  const maxAttemptsRaw = Number(opts?.maxAttempts ?? 2);
  const maxAttempts = Number.isSafeInteger(maxAttemptsRaw) && maxAttemptsRaw >= 1 ? maxAttemptsRaw : 2;

  let attempt = 0;
  let currentInit = init;
  let lastResponse = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    const res = await fetchImpl(url, currentInit);
    lastResponse = res;
    if (res.status !== 402) return res;
    if (attempt >= maxAttempts) return res;

    const gateIdRaw = res.headers.get(gateHeaderName);
    const gateId = typeof gateIdRaw === "string" ? gateIdRaw.trim() : "";
    if (!gateId) return res;

    const nextInit = buildRetryInit(currentInit, { gateHeaderName, gateId });
    currentInit = nextInit;
  }

  return lastResponse;
}
