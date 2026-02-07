import fs from "node:fs/promises";
import { spawn } from "node:child_process";

export function stableStringSet(list) {
  const s = new Set();
  for (const v of Array.isArray(list) ? list : []) {
    if (typeof v === "string" && v.trim()) s.add(v);
  }
  return [...s].sort();
}

export function codesFromCliOutput(cliJson, key) {
  const list = Array.isArray(cliJson?.[key]) ? cliJson[key] : [];
  const codes = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.code === "string" && item.code.trim()) codes.push(item.code.trim());
  }
  return stableStringSet(codes);
}

export async function readJsonFile(fp) {
  const raw = await fs.readFile(fp, "utf8");
  return JSON.parse(raw);
}

export async function writeJsonFile(fp, json) {
  const text = JSON.stringify(json, null, 0) + "\n";
  await fs.writeFile(fp, text, "utf8");
}

export function diffSets({ expected, actual }) {
  const exp = stableStringSet(expected);
  const act = stableStringSet(actual);
  const expSet = new Set(exp);
  const actSet = new Set(act);
  const missing = exp.filter((c) => !actSet.has(c));
  const extra = act.filter((c) => !expSet.has(c));
  return { expected: exp, actual: act, missing, extra, equal: missing.length === 0 && extra.length === 0 };
}

export async function spawnCapture({ cmd, args = [], cwd, env, stdinText = null, timeoutMs = 60_000, maxStdoutBytes = 2 * 1024 * 1024, maxStderrBytes = 2 * 1024 * 1024 } = {}) {
  const child = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;

  child.stdout.on("data", (d) => {
    stdoutBytes += d.length;
    if (stdoutBytes <= maxStdoutBytes) stdoutChunks.push(d);
  });
  child.stderr.on("data", (d) => {
    stderrBytes += d.length;
    if (stderrBytes <= maxStderrBytes) stderrChunks.push(d);
  });

  const timeout = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, timeoutMs);

  if (typeof stdinText === "string") child.stdin.end(stdinText);
  else child.stdin.end();

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  }).finally(() => clearTimeout(timeout));

  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  return { exitCode, stdout, stderr };
}

