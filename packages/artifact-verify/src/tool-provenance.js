import fs from "node:fs/promises";
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

async function readPackageVersionBestEffort() {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const raw = await fs.readFile(pkgUrl, "utf8");
    const pkg = JSON.parse(raw);
    return typeof pkg?.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

async function readRepoVersionFileBestEffort({ cwd = process.cwd() } = {}) {
  try {
    const p = path.resolve(cwd, "SETTLD_VERSION");
    const raw = await fs.readFile(p, "utf8");
    const v = String(raw).trim();
    return v || null;
  } catch {
    return null;
  }
}

export async function readToolVersionBestEffort({ env = process.env, cwd = process.cwd() } = {}) {
  const fromEnv = env.SETTLD_VERSION ?? null;
  if (typeof fromEnv === "string" && fromEnv.trim()) return String(fromEnv).trim();
  const fromRepo = await readRepoVersionFileBestEffort({ cwd });
  if (fromRepo) return fromRepo;
  return readPackageVersionBestEffort();
}
