import fs from "node:fs/promises";

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

export async function readPackageVersionBestEffort() {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const raw = await fs.readFile(pkgUrl, "utf8");
    const pkg = JSON.parse(raw);
    return typeof pkg?.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

