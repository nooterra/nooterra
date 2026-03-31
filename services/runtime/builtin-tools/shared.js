import crypto from 'node:crypto';

const EMAIL_REGEX = /^[^\s@,;]+@[^\s@]+\.[^\s@]+$/;
const E164_PHONE_REGEX = /^\+[1-9]\d{7,14}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

export function log(level, msg) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, component: 'builtin-tools', msg });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isValidEmailAddress(value) {
  return EMAIL_REGEX.test(normalizeString(value));
}

export function isValidE164PhoneNumber(value) {
  return E164_PHONE_REGEX.test(normalizeString(value));
}

export function isValidIsoDate(value) {
  return ISO_DATE_REGEX.test(normalizeString(value));
}

export function stableJsonStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJsonStringify(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function isAbortLikeError(err) {
  if (!err) return false;
  const name = String(err?.name || '');
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return name === 'AbortError'
    || code === 'ABORT_ERR'
    || /timed?\s*out/i.test(message)
    || /aborted/i.test(message);
}

export function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizedPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}
