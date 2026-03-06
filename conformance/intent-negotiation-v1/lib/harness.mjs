import fs from "node:fs/promises";
import { spawn } from "node:child_process";

export async function readJsonFile(fp) {
  const raw = await fs.readFile(fp, "utf8");
  return JSON.parse(raw);
}

export async function writeJsonFile(fp, json) {
  const text = JSON.stringify(json, null, 0) + "\n";
  await fs.writeFile(fp, text, "utf8");
}

export async function spawnCapture({
  cmd,
  args = [],
  cwd,
  env,
  stdinText = null,
  timeoutMs = 60_000,
  maxStdoutBytes = 2 * 1024 * 1024,
  maxStderrBytes = 2 * 1024 * 1024
} = {}) {
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
