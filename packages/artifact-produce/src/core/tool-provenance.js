import fs from "node:fs";
import path from "node:path";

export function normalizeCommitSha(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (!/^[0-9a-f]{7,64}$/.test(v)) return null;
  return v;
}

export function readToolCommitBestEffort({ env = process.env } = {}) {
  const candidates = [env.SETTLD_COMMIT_SHA, env.PROXY_BUILD, env.GIT_SHA, env.GITHUB_SHA];
  for (const c of candidates) {
    const v = normalizeCommitSha(c);
    if (v) return v;
  }
  return null;
}

export function readRepoVersionFileBestEffort({ cwd = process.cwd() } = {}) {
  try {
    const p = path.resolve(cwd, "SETTLD_VERSION");
    const raw = fs.readFileSync(p, "utf8");
    const v = String(raw).trim();
    return v || null;
  } catch {
    return null;
  }
}

export function readToolVersionBestEffort({ env = process.env, cwd = process.cwd() } = {}) {
  const fromEnv = env.SETTLD_VERSION ?? null;
  if (typeof fromEnv === "string" && fromEnv.trim()) return String(fromEnv).trim();
  return readRepoVersionFileBestEffort({ cwd });
}
