function normalizeBaseUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function errorMessageOrFallback(err, fallback = "resend request failed") {
  const direct = typeof err?.message === "string" ? err.message.trim() : "";
  if (direct) return direct;
  const asText = String(err ?? "").trim();
  if (asText && asText !== "[object Object]") return asText;
  return fallback;
}

export async function sendResendMail({
  apiKey,
  from,
  to,
  subject,
  text,
  baseUrl = "https://api.resend.com",
  timeoutMs = 10_000,
  fetchImpl = fetch
} = {}) {
  const key = String(apiKey ?? "").trim();
  if (!key) throw new Error("resend api key required");
  const sender = String(from ?? "").trim();
  if (!sender) throw new Error("resend from is required");
  const recipient = String(to ?? "").trim();
  if (!recipient) throw new Error("resend to is required");
  const sub = String(subject ?? "").trim();
  if (!sub) throw new Error("resend subject is required");
  const bodyText = String(text ?? "");
  const urlBase = normalizeBaseUrl(baseUrl);
  if (!urlBase) throw new Error("resend base URL must be a valid http(s) URL");
  if (typeof fetchImpl !== "function") throw new Error("resend fetch implementation unavailable");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.max(100, Number(timeoutMs) || 10_000));
  t.unref?.();

  let res;
  try {
    res = await fetchImpl(`${urlBase}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        subject: sub,
        text: bodyText
      }),
      signal: controller.signal
    });
  } catch (err) {
    throw new Error(errorMessageOrFallback(err, "resend transport failed"));
  } finally {
    clearTimeout(t);
  }

  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message =
      (json && typeof json === "object" && (json?.message || json?.error?.message || json?.error)) ||
      raw ||
      `HTTP ${res.status}`;
    throw new Error(`resend send failed (${res.status}): ${String(message)}`);
  }
  return {
    ok: true,
    id: json && typeof json === "object" && typeof json.id === "string" ? json.id : null
  };
}

