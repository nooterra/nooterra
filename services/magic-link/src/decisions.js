import fs from "node:fs/promises";
import path from "node:path";

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function decisionPath({ dataDir, token }) {
  return path.join(dataDir, "decisions", `${token}.json`);
}

export async function loadDecisionRecord({ dataDir, token }) {
  try {
    const raw = await fs.readFile(decisionPath({ dataDir, token }), "utf8");
    const j = JSON.parse(raw);
    if (!isPlainObject(j) || j.schemaVersion !== "DecisionRecord.v0") return null;
    return j;
  } catch {
    return null;
  }
}

function clampText(v, { max }) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

function normalizeDecision(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "approve" || s === "hold") return s;
  return null;
}

export async function appendDecision({
  dataDir,
  token,
  tenantId,
  zipSha256,
  verifyJsonSha256,
  decision,
  actorName,
  actorEmail,
  authMethod,
  actorIp,
  actorUserAgent,
  note
}) {
  const d = normalizeDecision(decision);
  if (!d) return { ok: false, error: "INVALID_DECISION", message: "decision must be approve|hold" };
  const name = clampText(actorName, { max: 200 });
  const email = clampText(actorEmail, { max: 320 });
  if (!email) return { ok: false, error: "INVALID_ACTOR", message: "email is required" };
  const auth = clampText(authMethod, { max: 32 }) ?? "none";
  const ip = clampText(actorIp, { max: 128 });
  const userAgent = clampText(actorUserAgent, { max: 400 });
  const noteValue = clampText(note, { max: 2000 });

  const fp = decisionPath({ dataDir, token });
  await fs.mkdir(path.dirname(fp), { recursive: true });

  let record = null;
  try {
    record = JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    record = null;
  }

  const decidedAt = new Date().toISOString();
  const entry = {
    decision: d,
    decidedAt,
    actor: { name, email },
    auth: { method: auth },
    client: { ip, userAgent },
    note: noteValue
  };

  const next = isPlainObject(record) && record.schemaVersion === "DecisionRecord.v0"
    ? { ...record }
    : { schemaVersion: "DecisionRecord.v0", token, tenantId, zipSha256, verifyJsonSha256, decisions: [] };

  next.tenantId = tenantId;
  next.zipSha256 = zipSha256;
  next.verifyJsonSha256 = verifyJsonSha256;
  next.decisions = Array.isArray(next.decisions) ? next.decisions : [];
  next.decisions.push(entry);
  next.updatedAt = decidedAt;

  await fs.writeFile(fp, JSON.stringify(next, null, 2) + "\n", "utf8");
  return { ok: true, record: next };
}
