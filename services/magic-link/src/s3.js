import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

function sha256Hex(data) {
  const h = crypto.createHash("sha256");
  if (typeof data === "string") h.update(data, "utf8");
  else h.update(data);
  return h.digest("hex");
}

function hmac(key, msg, encoding = null) {
  const h = crypto.createHmac("sha256", key);
  h.update(msg, "utf8");
  return encoding ? h.digest(encoding) : h.digest();
}

function amzDateUtcNow() {
  const d = new Date();
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return { dateStamp: `${y}${m}${day}`, amzDate: `${y}${m}${day}T${hh}${mm}${ss}Z` };
}

function awsEncodeUriPath(pathname) {
  // Encode each segment but preserve `/` separators.
  return String(pathname ?? "")
    .split("/")
    .map((seg) => encodeURIComponent(seg).replaceAll("%2F", "/"))
    .join("/");
}

function canonicalizeHeaders(headers) {
  const entries = [];
  for (const [k, v] of Object.entries(headers ?? {})) {
    const name = String(k ?? "").trim().toLowerCase();
    if (!name) continue;
    const value = Array.isArray(v) ? v.map(String).join(",") : String(v ?? "");
    entries.push([name, value.replace(/\s+/g, " ").trim()]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonical = entries.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = entries.map(([k]) => k).join(";");
  return { canonicalHeaders: canonical, signedHeaders };
}

function buildSigV4Authorization({ method, url, headers, bodySha256, accessKeyId, secretAccessKey, sessionToken, region, service }) {
  const { dateStamp, amzDate } = amzDateUtcNow();
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  const u = new URL(url);
  const canonicalUri = awsEncodeUriPath(u.pathname);
  const canonicalQuery = ""; // no query for our usage

  const baseHeaders = { ...headers, host: u.host, "x-amz-date": amzDate, "x-amz-content-sha256": bodySha256 };
  if (sessionToken) baseHeaders["x-amz-security-token"] = sessionToken;
  const { canonicalHeaders, signedHeaders } = canonicalizeHeaders(baseHeaders);

  const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, bodySha256].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(Buffer.from(`AWS4${secretAccessKey}`, "utf8"), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign, "hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, amzDate, signedHeaders, headers: baseHeaders };
}

export function buildS3ObjectUrl({ endpoint, region, bucket, key, pathStyle = false } = {}) {
  if (!bucket || typeof bucket !== "string") throw new TypeError("bucket is required");
  if (!key || typeof key !== "string") throw new TypeError("key is required");
  const safeKey = key.replace(/^\/+/, "");

  if (endpoint) {
    const base = new URL(endpoint);
    if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("endpoint must be http(s)");
    if (pathStyle) {
      base.pathname = `/${bucket}/${safeKey}`.replaceAll("//", "/");
      return base.toString();
    }
    // virtual-host style: bucket as subdomain (best-effort)
    return `${base.protocol}//${bucket}.${base.host}/${safeKey}`;
  }

  if (!region) throw new TypeError("region is required when endpoint is not set");
  if (pathStyle) return `https://s3.${region}.amazonaws.com/${bucket}/${safeKey}`;
  return `https://${bucket}.s3.${region}.amazonaws.com/${safeKey}`;
}

export async function s3PutObject({
  url,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken = null,
  body,
  contentType = "application/octet-stream",
  sse = "none",
  kmsKeyId = null,
  extraHeaders = null,
  timeoutMs = 30_000
} = {}) {
  if (!url) throw new TypeError("url is required");
  if (!region || typeof region !== "string") throw new TypeError("region is required");
  if (!accessKeyId || typeof accessKeyId !== "string") throw new TypeError("accessKeyId is required");
  if (!secretAccessKey || typeof secretAccessKey !== "string") throw new TypeError("secretAccessKey is required");
  if (!(body instanceof Uint8Array) && !Buffer.isBuffer(body)) throw new TypeError("body must be bytes");

  const payloadHash = sha256Hex(body);
  const headers = {
    "content-type": contentType,
    "content-length": String(body.length),
    ...((extraHeaders && typeof extraHeaders === "object") ? extraHeaders : {})
  };
  if (sse === "aes256") headers["x-amz-server-side-encryption"] = "AES256";
  if (sse === "aws:kms") {
    headers["x-amz-server-side-encryption"] = "aws:kms";
    if (kmsKeyId) headers["x-amz-server-side-encryption-aws-kms-key-id"] = kmsKeyId;
  }

  const auth = buildSigV4Authorization({
    method: "PUT",
    url,
    headers,
    bodySha256: payloadHash,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region,
    service: "s3"
  });

  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const reqHeaders = { ...auth.headers, authorization: auth.authorization };
  const transport = isHttps ? https : http;

  return await new Promise((resolve) => {
    const req = transport.request(
      {
        method: "PUT",
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port ? Number(u.port) : isHttps ? 443 : 80,
        path: u.pathname + u.search,
        headers: reqHeaders,
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const bodyText = Buffer.concat(chunks).toString("utf8");
          const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
          resolve({ ok, statusCode: res.statusCode ?? null, headers: res.headers ?? {}, bodyText: bodyText || "" });
        });
      }
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
    req.on("error", (err) => resolve({ ok: false, statusCode: null, error: err?.code ?? "REQUEST_FAILED", message: err?.message ?? String(err ?? "error") }));
    req.end(Buffer.from(body));
  });
}

