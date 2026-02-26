function normalizeIssueList(list) {
  const out = [];
  for (const it of Array.isArray(list) ? list : []) {
    if (!it || typeof it !== "object" || Array.isArray(it)) continue;
    const code = typeof it.code === "string" && it.code.trim() ? it.code.trim() : "UNKNOWN";
    const path = typeof it.path === "string" && it.path.trim() ? it.path : null;
    const message = typeof it.message === "string" && it.message.trim() ? it.message : null;
    const causeKind = typeof it.causeKind === "string" && it.causeKind.trim() ? it.causeKind.trim() : null;
    const causeCode = typeof it.causeCode === "string" && it.causeCode.trim() ? it.causeCode.trim() : null;
    const normalized = { code, path, message, detail: it.detail ?? null };
    if (causeKind) normalized.causeKind = causeKind;
    if (causeCode) normalized.causeCode = causeCode;
    out.push(normalized);
  }
  out.sort((a, b) => {
    const ac = String(a.code ?? "");
    const bc = String(b.code ?? "");
    if (ac < bc) return -1;
    if (ac > bc) return 1;
    const ap = String(a.path ?? "");
    const bp = String(b.path ?? "");
    if (ap < bp) return -1;
    if (ap > bp) return 1;
    return 0;
  });
  return out;
}

export function buildProduceCliOutputV1({ tool, target, mode, ok, produceOk, verifyAfter, result, warnings, errors } = {}) {
  const base = {
    schemaVersion: "ProduceCliOutput.v1",
    tool: tool ?? { name: "nooterra", version: null, commit: null },
    mode: mode ?? { deterministic: false, now: null },
    target: target ?? { kind: null, out: null },
    ok: Boolean(ok),
    produceOk: Boolean(produceOk),
    warnings: normalizeIssueList(warnings),
    errors: normalizeIssueList(errors),
    result: result ?? null
  };

  if (verifyAfter && typeof verifyAfter === "object") {
    return { ...base, verifyAfter };
  }
  return base;
}
