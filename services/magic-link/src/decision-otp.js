import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sendSmtpMail } from "./smtp.js";

function nowIso() {
  return new Date().toISOString();
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function clampText(v, { max }) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

function normalizeEmail(value) {
  const raw = clampText(value, { max: 320 });
  if (!raw) return null;
  const email = raw.toLowerCase();
  if (!email.includes("@")) return null;
  const [local, domain, ...rest] = email.split("@");
  if (!local || !domain || rest.length) return null;
  if (/\s/.test(email)) return null;
  return email;
}

function otpRecordPath({ dataDir, token, email }) {
  const key = sha256Hex(`${token}\n${email}`);
  return path.join(dataDir, "decision-otp", token, `${key}.json`);
}

function otpOutboxPath({ dataDir, token, email }) {
  const key = sha256Hex(`${token}\n${email}`);
  return path.join(dataDir, "decision-otp-outbox", `${token}_${key}.json`);
}

function issueCode6() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

export async function issueDecisionOtp({ dataDir, token, email, ttlSeconds, deliveryMode, smtp } = {}) {
  const emailNorm = normalizeEmail(email);
  if (!emailNorm) return { ok: false, error: "INVALID_EMAIL", message: "invalid email" };

  const ttl = Number.parseInt(String(ttlSeconds ?? ""), 10);
  if (!Number.isInteger(ttl) || ttl <= 0) throw new TypeError("ttlSeconds must be a positive integer");

  const code = issueCode6();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const codeSha256 = sha256Hex(`${token}\n${emailNorm}\n${code}`);

  const record = {
    schemaVersion: "DecisionOtpRecord.v1",
    token,
    email: emailNorm,
    codeSha256,
    createdAt,
    expiresAt,
    consumedAt: null,
    attempts: 0
  };

  const fp = otpRecordPath({ dataDir, token, email: emailNorm });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(record, null, 2) + "\n", "utf8");

  const mode = String(deliveryMode ?? "record").trim().toLowerCase();
  if (mode === "record") {
    const outFp = otpOutboxPath({ dataDir, token, email: emailNorm });
    await fs.mkdir(path.dirname(outFp), { recursive: true });
    await fs.writeFile(
      outFp,
      JSON.stringify(
        { schemaVersion: "DecisionOtpOutboxRecord.v1", token, email: emailNorm, code, createdAt, expiresAt },
        null,
        2
      ) + "\n",
      "utf8"
    );
  } else if (mode === "log") {
    // eslint-disable-next-line no-console
    console.log(`decision otp token=${token} email=${emailNorm} code=${code} expiresAt=${expiresAt}`);
  } else if (mode === "smtp") {
    const from = typeof smtp?.from === "string" ? smtp.from.trim() : "";
    if (!from) return { ok: false, error: "SMTP_NOT_CONFIGURED", message: "smtp.from is required" };
    try {
      await sendSmtpMail({
        host: smtp?.host,
        port: smtp?.port,
        secure: Boolean(smtp?.secure),
        starttls: smtp?.starttls === undefined ? true : Boolean(smtp?.starttls),
        auth: smtp?.user && smtp?.pass ? { user: smtp.user, pass: smtp.pass } : null,
        from,
        to: emailNorm,
        subject: "Your Settld decision code",
        text: `Your decision code is: ${code}\n\nThis code expires at: ${expiresAt}\n\nIf you did not request this code, you can ignore this email.\n`
      });
    } catch (err) {
      return { ok: false, error: "SMTP_SEND_FAILED", message: err?.message ?? String(err ?? "smtp failed") };
    }
  } else {
    throw new Error("invalid deliveryMode");
  }

  return { ok: true, email: emailNorm, expiresAt };
}

export async function verifyAndConsumeDecisionOtp({ dataDir, token, email, code, maxAttempts }) {
  const emailNorm = normalizeEmail(email);
  const codeNorm = clampText(code, { max: 32 });
  if (!emailNorm || !codeNorm) return { ok: false, error: "OTP_INVALID", message: "email and code are required" };

  const max = Number.parseInt(String(maxAttempts ?? ""), 10);
  if (!Number.isInteger(max) || max < 1) throw new TypeError("maxAttempts must be an integer >= 1");

  const fp = otpRecordPath({ dataDir, token, email: emailNorm });
  let rec = null;
  try {
    rec = JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    rec = null;
  }
  if (!rec || typeof rec !== "object" || Array.isArray(rec) || rec.schemaVersion !== "DecisionOtpRecord.v1") {
    return { ok: false, error: "OTP_MISSING", message: "no active otp" };
  }
  if (String(rec.token ?? "") !== token || String(rec.email ?? "") !== emailNorm) {
    return { ok: false, error: "OTP_MISSING", message: "no active otp" };
  }
  if (typeof rec.consumedAt === "string" && rec.consumedAt) return { ok: false, error: "OTP_CONSUMED", message: "otp already used" };

  const expiresMs = Date.parse(String(rec.expiresAt ?? ""));
  if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) return { ok: false, error: "OTP_EXPIRED", message: "otp expired" };

  const attempts = Number.parseInt(String(rec.attempts ?? "0"), 10);
  if (Number.isInteger(attempts) && attempts >= max) return { ok: false, error: "OTP_LOCKED", message: "too many attempts" };

  const expected = String(rec.codeSha256 ?? "");
  const actual = sha256Hex(`${token}\n${emailNorm}\n${codeNorm}`);
  if (expected !== actual) {
    rec.attempts = (Number.isInteger(attempts) ? attempts : 0) + 1;
    await fs.writeFile(fp, JSON.stringify(rec, null, 2) + "\n", "utf8");
    return { ok: false, error: "OTP_INVALID", message: "invalid code" };
  }

  rec.consumedAt = nowIso();
  rec.attempts = Number.isInteger(attempts) ? attempts : 0;
  await fs.writeFile(fp, JSON.stringify(rec, null, 2) + "\n", "utf8");
  return { ok: true };
}
