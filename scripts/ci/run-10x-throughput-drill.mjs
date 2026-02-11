#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

function parseIntEnv(name, fallback, { min = null, max = null } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  if (min !== null && value < min) throw new Error(`${name} must be >= ${min}`);
  if (max !== null && value > max) throw new Error(`${name} must be <= ${max}`);
  return value;
}

function parseFloatEnv(name, fallback, { min = null, max = null } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  if (min !== null && value < min) throw new Error(`${name} must be >= ${min}`);
  if (max !== null && value > max) throw new Error(`${name} must be <= ${max}`);
  return value;
}

function parseBoolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "y") return true;
  if (value === "0" || value === "false" || value === "no" || value === "n") return false;
  throw new Error(`${name} must be boolean-like (true/false)`);
}

function runCommand(cmd, args, { env = process.env, stdio = "inherit" } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, { env, stdio });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      resolvePromise(code ?? 1);
    });
  });
}

async function ensureK6() {
  try {
    const code = await runCommand("k6", ["version"], { stdio: "ignore" });
    return code === 0;
  } catch {
    return false;
  }
}

async function ensureDocker() {
  try {
    const code = await runCommand("docker", ["--version"], { stdio: "ignore" });
    return code === 0;
  } catch {
    return false;
  }
}

function toWorkspacePath(hostPath, cwd) {
  const target = resolve(hostPath);
  const root = resolve(cwd);
  const rel = relative(root, target);
  if (
    rel === "" ||
    rel.startsWith(`..${sep}`) ||
    rel === ".." ||
    (isAbsolute(rel) && resolve(rel) !== target)
  ) {
    throw new Error(`docker k6 fallback requires paths under working directory: ${hostPath}`);
  }
  const normalized = rel.split(sep).join("/");
  return normalized === "" ? "/workspace" : `/workspace/${normalized}`;
}

async function resolveK6Runner({ cwd, allowDockerFallback = true } = {}) {
  if (await ensureK6()) {
    return {
      kind: "k6_binary",
      cmd: "k6",
      baseArgs: []
    };
  }
  if (!allowDockerFallback) {
    throw new Error("k6 is required on PATH (docker fallback disabled)");
  }
  if (!(await ensureDocker())) {
    throw new Error("k6 is required on PATH or docker must be installed for fallback");
  }
  const networkMode = process.env.K6_DOCKER_NETWORK_MODE && process.env.K6_DOCKER_NETWORK_MODE.trim() !== "" ? process.env.K6_DOCKER_NETWORK_MODE.trim() : "host";
  const image = process.env.K6_DOCKER_IMAGE && process.env.K6_DOCKER_IMAGE.trim() !== "" ? process.env.K6_DOCKER_IMAGE.trim() : "grafana/k6:0.48.0";
  return {
    kind: "docker_k6",
    cmd: "docker",
    baseArgs: ["run", "--rm", "--network", networkMode, "-v", `${cwd}:/workspace`, "-w", "/workspace", image],
    toRunnerPath: (value) => toWorkspacePath(value, cwd)
  };
}

function readMetric(summary, metricName, key) {
  const metric = summary?.metrics?.[metricName];
  if (!metric || typeof metric !== "object") return null;
  const valueFromValues = metric?.values?.[key];
  if (Number.isFinite(Number(valueFromValues))) return Number(valueFromValues);
  const valueDirect = metric?.[key];
  if (Number.isFinite(Number(valueDirect))) return Number(valueDirect);
  return null;
}

async function main() {
  const baseJobsPerMinPerTenant = parseIntEnv("BASELINE_JOBS_PER_MIN_PER_TENANT", 10, { min: 1 });
  const multiplier = parseIntEnv("THROUGHPUT_MULTIPLIER", 10, { min: 1 });
  const jobsPerMinPerTenant = parseIntEnv(
    "JOBS_PER_MIN_PER_TENANT",
    baseJobsPerMinPerTenant * multiplier,
    { min: 1 }
  );
  const tenants = parseIntEnv("TENANTS", 3, { min: 1 });
  const robotsPerTenant = parseIntEnv("ROBOTS_PER_TENANT", 3, { min: 1 });
  const duration = process.env.DURATION && process.env.DURATION.trim() !== "" ? process.env.DURATION.trim() : "120s";
  const targetP95Ms = parseFloatEnv("TARGET_P95_MS", 5000, { min: 1 });
  const maxFailureRate = parseFloatEnv("MAX_FAILURE_RATE", 0.05, { min: 0, max: 1 });
  const allowRejectedRate = parseFloatEnv("MAX_INGEST_REJECTED_PER_MIN", 50, { min: 0 });
  const dryRun = parseBoolEnv("DRY_RUN", false);
  const allowDockerFallback = parseBoolEnv("ALLOW_DOCKER_K6_FALLBACK", true);

  const reportPath = resolve(process.cwd(), process.env.THROUGHPUT_REPORT_PATH || "artifacts/throughput/10x-drill-summary.json");
  const summaryPath = resolve(process.cwd(), process.env.THROUGHPUT_K6_SUMMARY_PATH || "artifacts/throughput/10x-drill-k6-summary.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await mkdir(dirname(summaryPath), { recursive: true });

  const runConfig = {
    baseUrl: process.env.BASE_URL || "http://127.0.0.1:3000",
    opsTokenPresent: Boolean(process.env.OPS_TOKEN && process.env.OPS_TOKEN.trim() !== ""),
    tenants,
    robotsPerTenant,
    baseJobsPerMinPerTenant,
    throughputMultiplier: multiplier,
    jobsPerMinPerTenant,
    expectedJobsPerMinTotal: tenants * jobsPerMinPerTenant,
    duration,
    targetP95Ms,
    maxFailureRate,
    maxIngestRejectedPerMin: allowRejectedRate,
    script: "scripts/load/ingest-burst.k6.js",
    runner: "unresolved"
  };

  if (dryRun) {
    const dryReport = {
      schemaVersion: "ThroughputDrill10xReport.v1",
      generatedAt: new Date().toISOString(),
      mode: "dry_run",
      runConfig,
      verdict: {
        ok: false,
        reason: "dry_run"
      }
    };
    await writeFile(reportPath, JSON.stringify(dryReport, null, 2) + "\n", "utf8");
    process.stdout.write(`wrote dry-run report: ${reportPath}\n`);
    return;
  }

  const k6Runner = await resolveK6Runner({
    cwd: process.cwd(),
    allowDockerFallback
  });
  runConfig.runner = k6Runner.kind;

  const k6Env = {
    ...process.env,
    BASE_URL: runConfig.baseUrl,
    OPS_TOKEN: process.env.OPS_TOKEN || "",
    TENANTS: String(tenants),
    ROBOTS_PER_TENANT: String(robotsPerTenant),
    JOBS_PER_MIN_PER_TENANT: String(jobsPerMinPerTenant),
    DURATION: duration,
    TARGET_P95_MS: String(targetP95Ms),
    MAX_FAILURE_RATE: String(maxFailureRate)
  };

  const resolvedScriptPath = resolve(process.cwd(), runConfig.script);
  const scriptPathForRunner = k6Runner.kind === "docker_k6" ? k6Runner.toRunnerPath(resolvedScriptPath) : runConfig.script;
  const summaryPathForRunner = k6Runner.kind === "docker_k6" ? k6Runner.toRunnerPath(summaryPath) : summaryPath;
  const runnerEnvArgs =
    k6Runner.kind === "docker_k6"
      ? Object.entries(k6Env).flatMap(([name, value]) => ["-e", `${name}=${String(value)}`])
      : [];

  const startedAt = Date.now();
  const exitCode = await runCommand(
    k6Runner.cmd,
    [...k6Runner.baseArgs, ...runnerEnvArgs, "run", "--summary-export", summaryPathForRunner, scriptPathForRunner],
    { env: k6Env }
  );
  const completedAt = Date.now();

  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const p95 = readMetric(summary, "http_req_duration", "p(95)");
  const failureRate = readMetric(summary, "http_req_failed", "rate") ?? readMetric(summary, "http_req_failed", "value");
  const rejectedCount = readMetric(summary, "ingest_rejected_requests_total", "count") ?? 0;
  const durationSeconds = Math.max(1, Math.round((completedAt - startedAt) / 1000));
  const rejectedPerMin = (rejectedCount / durationSeconds) * 60;

  const checks = {
    k6ExitCodeZero: exitCode === 0,
    p95WithinTarget: p95 !== null ? p95 <= targetP95Ms : false,
    failureRateWithinTarget: failureRate !== null ? failureRate <= maxFailureRate : false,
    ingestRejectedWithinTarget: rejectedPerMin <= allowRejectedRate
  };
  const ok = Object.values(checks).every((value) => value === true);

  const report = {
    schemaVersion: "ThroughputDrill10xReport.v1",
    generatedAt: new Date().toISOString(),
    runConfig,
    metrics: {
      httpReqDurationP95Ms: p95,
      httpReqFailedRate: failureRate,
      ingestRejectedCount: rejectedCount,
      ingestRejectedPerMin: rejectedPerMin,
      runDurationSeconds: durationSeconds
    },
    checks,
    verdict: {
      ok,
      k6ExitCode: exitCode,
      summaryPath
    }
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(`wrote throughput report: ${reportPath}\n`);
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});
