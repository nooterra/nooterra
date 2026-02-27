function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeResponseSnapshot(snapshot) {
  const headersIn = snapshot?.headers && typeof snapshot.headers === "object" ? snapshot.headers : {};
  const headerRows = Object.entries(headersIn)
    .map(([nameRaw, valueRaw]) => {
      const name = normalizeOptionalString(String(nameRaw ?? "").toLowerCase());
      if (!name) return null;
      const value = normalizeOptionalString(String(valueRaw ?? ""));
      if (!value) return null;
      return [name, value];
    })
    .filter(Boolean)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const headers = {};
  for (const [name, value] of headerRows) headers[name] = value;

  return {
    statusCode: Number.isInteger(snapshot?.statusCode) ? snapshot.statusCode : 200,
    headers,
    bodyBytes: Buffer.isBuffer(snapshot?.bodyBytes) ? Buffer.from(snapshot.bodyBytes) : Buffer.from([])
  };
}

export function createFederationReplayLedger() {
  const ledger = new Map();

  function claim({ key, requestHash }) {
    const normalizedKey = String(key ?? "");
    const normalizedHash = normalizeOptionalString(requestHash) ?? "";
    const existing = ledger.get(normalizedKey) ?? null;

    if (!existing) {
      ledger.set(normalizedKey, { requestHash: normalizedHash, status: "pending", response: null });
      return { type: "new" };
    }

    if (existing.requestHash !== normalizedHash) {
      return {
        type: "conflict",
        expectedHash: existing.requestHash,
        actualHash: normalizedHash
      };
    }

    if (existing.status === "completed" && existing.response) {
      return {
        type: "replay",
        response: normalizeResponseSnapshot(existing.response)
      };
    }

    return { type: "in_flight" };
  }

  function complete({ key, requestHash, response }) {
    const normalizedKey = String(key ?? "");
    const normalizedHash = normalizeOptionalString(requestHash) ?? "";
    const existing = ledger.get(normalizedKey) ?? null;
    if (!existing || existing.requestHash !== normalizedHash) return;
    ledger.set(normalizedKey, {
      requestHash: normalizedHash,
      status: "completed",
      response: normalizeResponseSnapshot(response)
    });
  }

  function release({ key, requestHash }) {
    const normalizedKey = String(key ?? "");
    const normalizedHash = normalizeOptionalString(requestHash) ?? "";
    const existing = ledger.get(normalizedKey) ?? null;
    if (!existing || existing.requestHash !== normalizedHash) return;
    if (existing.status === "pending") ledger.delete(normalizedKey);
  }

  return {
    claim,
    complete,
    release
  };
}
