import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

function b64(text) {
  return Buffer.from(String(text ?? ""), "utf8").toString("base64");
}

function nowRfc2822() {
  return new Date().toUTCString();
}

function makeMessageId(domain = "localhost") {
  const id = crypto.randomBytes(16).toString("hex");
  return `<${id}@${domain}>`;
}

function clampText(v, { max }) {
  const s = String(v ?? "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

const SIMPLE_EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+$/;

export function extractSmtpEnvelopeAddress(value, { fieldName = "address" } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`smtp ${fieldName} required`);
  const bracketed = /<\s*([^<>\s@]+@[^\s@<>]+)\s*>/.exec(raw);
  const candidate = (bracketed ? bracketed[1] : raw).trim();
  if (!SIMPLE_EMAIL_RE.test(candidate)) {
    throw new Error(`smtp ${fieldName} must be an email address`);
  }
  return candidate;
}

export function formatSmtpMessage({ from, to, subject, text, messageIdDomain }) {
  const subj = clampText(subject, { max: 200 });
  const body = String(text ?? "");
  const msgId = makeMessageId(messageIdDomain ?? "localhost");
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subj}`,
    `Date: ${nowRfc2822()}`,
    `Message-ID: ${msgId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit"
  ];
  // Ensure CRLF line endings for SMTP DATA.
  const normalizedBody = body.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n").join("\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + normalizedBody + "\r\n";
}

export function dotStuffSmtpData(data) {
  return String(data ?? "")
    .split("\r\n")
    .map((l) => (l.startsWith(".") ? "." + l : l))
    .join("\r\n");
}

function createLineReader(socket, { timeoutMs }) {
  let buf = "";
  const queue = [];
  const waiters = [];

  function pushLine(line) {
    if (waiters.length) {
      const w = waiters.shift();
      w.resolve(line);
      return;
    }
    queue.push(line);
  }

  socket.on("data", (d) => {
    buf += d.toString("utf8");
    while (true) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const raw = buf.slice(0, idx + 1);
      buf = buf.slice(idx + 1);
      const line = raw.replace(/\r?\n$/, "");
      pushLine(line);
    }
  });

  function readLine() {
    if (queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("smtp timeout")), timeoutMs);
      waiters.push({
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        }
      });
    });
  }

  return { readLine };
}

async function readReply(reader) {
  const lines = [];
  let code = null;
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const line = await reader.readLine();
    lines.push(line);
    const m = /^(\d{3})([ -])/.exec(line);
    if (!m) continue;
    code = Number.parseInt(m[1], 10);
    const sep = m[2];
    if (sep === " ") break;
  }
  return { code: code ?? 0, lines };
}

async function sendCmd(socket, reader, cmd, expectedCodes) {
  socket.write(String(cmd ?? "") + "\r\n");
  const rep = await readReply(reader);
  const allowed = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
  if (!allowed.includes(rep.code)) {
    const detail = rep.lines.join("\n");
    throw new Error(`smtp unexpected reply for ${String(cmd).split(" ")[0]}: ${rep.code}\n${detail}`);
  }
  return rep;
}

export async function sendSmtpMail({
  host,
  port,
  secure = false,
  starttls = true,
  auth = null,
  from,
  to,
  subject,
  text,
  timeoutMs = 10_000
} = {}) {
  const h = String(host ?? "").trim();
  const p = Number.parseInt(String(port ?? ""), 10);
  if (!h) throw new Error("smtp host required");
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error("smtp port invalid");
  if (!from || !to) throw new Error("smtp from/to required");
  const envelopeFrom = extractSmtpEnvelopeAddress(from, { fieldName: "from" });
  const envelopeTo = extractSmtpEnvelopeAddress(to, { fieldName: "to" });

  const connect = secure
    ? () => tls.connect({ host: h, port: p, servername: h })
    : () => net.connect({ host: h, port: p });

  let socket = connect();
  socket.setTimeout(timeoutMs);
  socket.on("timeout", () => {
    try {
      socket.destroy(new Error("smtp timeout"));
    } catch {
      // ignore
    }
  });

  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("connect", resolve);
  });

  let reader = createLineReader(socket, { timeoutMs });
  const greet = await readReply(reader);
  if (greet.code !== 220) throw new Error(`smtp bad greeting: ${greet.code}`);

  const ehlo = async () => await sendCmd(socket, reader, `EHLO settld`, 250);
  let ehloReply = await ehlo();

  const supportsStarttls = ehloReply.lines.some((l) => /STARTTLS/i.test(l));
  if (!secure && starttls && supportsStarttls) {
    await sendCmd(socket, reader, "STARTTLS", 220);
    socket = tls.connect({ socket, servername: h });
    socket.setTimeout(timeoutMs);
    reader = createLineReader(socket, { timeoutMs });
    ehloReply = await ehlo();
  }

  if (auth && typeof auth === "object") {
    const user = typeof auth.user === "string" ? auth.user : "";
    const pass = typeof auth.pass === "string" ? auth.pass : "";
    if (user && pass) {
      const token = b64(`\u0000${user}\u0000${pass}`);
      await sendCmd(socket, reader, `AUTH PLAIN ${token}`, [235, 250]);
    }
  }

  await sendCmd(socket, reader, `MAIL FROM:<${envelopeFrom}>`, 250);
  await sendCmd(socket, reader, `RCPT TO:<${envelopeTo}>`, [250, 251]);
  await sendCmd(socket, reader, "DATA", 354);

  const domain = (() => {
    const i = envelopeFrom.indexOf("@");
    return i !== -1 ? envelopeFrom.slice(i + 1) : "localhost";
  })();
  const msg = formatSmtpMessage({ from, to, subject, text, messageIdDomain: domain });

  const stuffed = dotStuffSmtpData(msg);

  socket.write(stuffed + "\r\n.\r\n");
  const dataReply = await readReply(reader);
  if (dataReply.code !== 250) throw new Error(`smtp DATA failed: ${dataReply.code}`);

  try {
    await sendCmd(socket, reader, "QUIT", 221);
  } catch {
    // ignore
  }
}
