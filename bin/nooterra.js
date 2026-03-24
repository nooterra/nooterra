#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

function usage() {
  const v = readVersion() ?? "unknown";
  console.log(`nooterra v${v} — AI workers you can actually trust

Usage: nooterra [command]

Getting started:
  nooterra                  Create your first worker (or open shell if you have workers)
  nooterra new              Create a new worker interactively
  nooterra workers          List all workers

Workers:
  nooterra run <name>       Run a worker now (with live progress)
  nooterra test <name>      Dry-run a worker
  nooterra logs <name>      View execution logs
  nooterra schedule         Manage recurring runs

Tools:
  nooterra add <tool>       Add a tool (slack, github, email, etc)
  nooterra tools            List available tools and status

Monitoring:
  nooterra dashboard        Real-time system dashboard
  nooterra approvals        Pending approval queue
  nooterra cost             Provider cost tracking
  nooterra health           Provider health & circuit breakers

Daemon:
  nooterra runtime daemon start    Start the worker daemon
  nooterra runtime daemon status   Check daemon status
  nooterra runtime daemon stop     Stop the daemon

Auth & providers:
  nooterra runtime auth set <provider>    Save an API key
  nooterra runtime auth status            Check auth status
  nooterra runtime provider list          List available providers

Workspace:
  nooterra login             Sign in to a workspace
  nooterra setup             Guided workspace setup
  nooterra onboard           Full onboarding flow
  nooterra wallet status     Check wallet balance

Advanced:
  nooterra runtime <cmd>     Runtime management (init, show, mcp, skill, worker)
  nooterra agent <cmd>       Agent lifecycle (init, run, status, logs, decommission)
  nooterra profile <cmd>     Worker profiles (list, init, wizard, validate, simulate)
  nooterra policy <cmd>      Policy packs (init, simulate, publish)
  nooterra conformance <cmd> Conformance tests
  nooterra doctor            Diagnose common issues
  nooterra dev <cmd>         Local dev stack (up, down, ps, logs)

Options:
  -h, --help       Show this help
  -v, --version    Show version

Run any command with --help for detailed usage.`);
}

function repoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

function readVersion() {
  try {
    const fp = path.join(repoRoot(), "NOOTERRA_VERSION");
    return fs.readFileSync(fp, "utf8").trim();
  } catch {
    return null;
  }
}

function hasSession() {
  try {
    const sessionPath = path.join(os.homedir(), ".nooterra", "session.json");
    const data = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    return !!(data && data.tenantId);
  } catch {
    return false;
  }
}

function hasWorkers() {
  try {
    const workersDir = path.join(os.homedir(), ".nooterra", "workers");
    const files = fs.readdirSync(workersDir);
    return files.some((f) => f.startsWith("wrk_") && f.endsWith(".json"));
  } catch {
    return false;
  }
}

function runNodeScript(scriptRelPath, args) {
  const script = path.join(repoRoot(), scriptRelPath);
  const res = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  process.exit(typeof res.status === "number" ? res.status : 1);
}

function dockerCompose(args) {
  const primary = spawnSync("docker", ["compose", ...args], { stdio: "inherit", cwd: repoRoot() });
  if (!primary.error && typeof primary.status === "number") return primary.status;
  if (primary.error && primary.error.code === "ENOENT") {
    const fallback = spawnSync("docker-compose", args, { stdio: "inherit", cwd: repoRoot() });
    if (fallback.error && fallback.error.code === "ENOENT") {
      console.error("missing executable: docker (or docker-compose)");
      return 127;
    }
    return typeof fallback.status === "number" ? fallback.status : 1;
  }
  const fallback = spawnSync("docker-compose", args, { stdio: "inherit", cwd: repoRoot() });
  if (fallback.error && fallback.error.code === "ENOENT") {
    console.error("missing executable: docker-compose");
    return 127;
  }
  return typeof fallback.status === "number" ? fallback.status : 1;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ? String(argv[0]) : "";

  // No args: launch the TUI
  if (!cmd) {
    return runNodeScript("scripts/worker-builder/tui.mjs", []);
  }

  if (cmd === "-h" || cmd === "--help") {
    usage();
    process.exit(0);
  }

  if (cmd === "--version" || cmd === "-v") {
    console.log(readVersion() ?? "unknown");
    process.exit(0);
  }

  // --- Worker commands ---

  if (cmd === "new") {
    return runNodeScript("scripts/worker-builder/cli.mjs", ["--new"]);
  }

  if (cmd === "workers") {
    return runNodeScript("scripts/worker-builder/cli.mjs", ["--workers"]);
  }

  if (cmd === "run") {
    const workerName = argv.slice(1).join(' ');
    return runNodeScript("scripts/worker-builder/cli.mjs", ["--run", workerName]);
  }

  if (cmd === "test") {
    const workerName = argv.slice(1).join(' ');
    return runNodeScript("scripts/worker-builder/test-worker.mjs", [workerName]);
  }

  if (cmd === "logs") {
    const workerName = argv.slice(1).join(' ');
    return runNodeScript("scripts/worker-builder/cli.mjs", ["--logs", workerName]);
  }

  if (cmd === "dashboard" || cmd === "dash") {
    return runNodeScript("scripts/worker-builder/cli.mjs", ["--dashboard"]);
  }

  if (cmd === "schedule") {
    const sub = argv.slice(1).join(' ');
    return runNodeScript("scripts/worker-builder/cli.mjs", ["--schedule", sub]);
  }

  if (cmd === "approvals") {
    return runNodeScript("scripts/worker-builder/cli.mjs", ["--approvals"]);
  }

  if (cmd === "cost") {
    return runNodeScript("scripts/worker-builder/cli.mjs", ["--cost"]);
  }

  if (cmd === "health") {
    return runNodeScript("scripts/worker-builder/cli.mjs", ["--health"]);
  }

  if (cmd === "add") {
    const tool = argv.slice(1).join(' ');
    return runNodeScript("scripts/worker-builder/tool-installer.mjs", tool ? [tool] : ["--list"]);
  }

  if (cmd === "tools") {
    return runNodeScript("scripts/worker-builder/tool-installer.mjs", ["--list"]);
  }

  if (cmd === "teach") {
    // nooterra teach "Worker Name" "knowledge..."
    const teachArgs = argv.slice(1).join(' ');
    return runNodeScript("scripts/worker-builder/cli.mjs", ["--teach", teachArgs]);
  }

  // --- Setup & auth ---

  if (cmd === "setup") {
    const sub = String(argv[1] ?? "").trim();
    if (sub === "openclaw") return runNodeScript("scripts/setup/openclaw-onboard.mjs", argv.slice(2));
    if (sub === "circle") return runNodeScript("scripts/setup/circle-bootstrap.mjs", argv.slice(2));
    if (sub === "legacy") return runNodeScript("scripts/setup/wizard.mjs", argv.slice(2));
    return runNodeScript("scripts/setup/onboard.mjs", argv.slice(1));
  }

  if (cmd === "onboard") {
    return runNodeScript("scripts/setup/onboard.mjs", argv.slice(1));
  }

  if (cmd === "login") {
    return runNodeScript("scripts/setup/login.mjs", argv.slice(1));
  }

  // --- Runtime ---

  if (cmd === "daemon") {
    const sub = argv[1] ? String(argv[1]) : "status";
    return runNodeScript("scripts/worker-builder/daemon-service.mjs", [sub, ...argv.slice(2)]);
  }

  if (cmd === "runtime") {
    if (String(argv[1] ?? "").trim() === "first-run") {
      return runNodeScript("scripts/runtime/first-run.mjs", argv.slice(2));
    }
    return runNodeScript("scripts/runtime/cli.mjs", argv.slice(1));
  }

  if (cmd === "tui") {
    const sub = argv[1] ? String(argv[1]) : "";
    if (sub === "runtime") return runNodeScript("scripts/tui/runtime-shell.mjs", argv.slice(2));
    console.error("usage: nooterra tui runtime [flags]");
    process.exit(1);
  }

  // --- Wallet ---

  if (cmd === "wallet") {
    return runNodeScript("scripts/wallet/cli.mjs", argv.slice(1));
  }

  // --- Agent ---

  if (cmd === "agent") {
    const sub = argv[1] ? String(argv[1]) : "";
    if (["init", "run", "status", "logs", "upgrade", "decommission"].includes(sub)) {
      return runNodeScript("bin/agentverse-cli.js", ["agent", ...argv.slice(1)]);
    }
    return runNodeScript("scripts/agent/cli.mjs", argv.slice(1));
  }

  if (cmd === "observe") {
    return runNodeScript("bin/agentverse-cli.js", ["observe", ...argv.slice(1)]);
  }

  // --- Profile & policy ---

  if (cmd === "profile") {
    return runNodeScript("scripts/profile/cli.mjs", argv.slice(1));
  }

  if (cmd === "policy") {
    return runNodeScript("scripts/policy/cli.mjs", argv.slice(1));
  }

  // --- Doctor ---

  if (cmd === "doctor") {
    return runNodeScript("scripts/doctor/mcp-host.mjs", argv.slice(1));
  }

  // --- Conformance ---

  if (cmd === "conformance") {
    const sub = argv[1] ? String(argv[1]) : "test";
    if (sub === "test") return runNodeScript("conformance/v1/run.mjs", argv.slice(2));
    if (sub === "list") return runNodeScript("conformance/v1/run.mjs", ["--list", ...argv.slice(2)]);
    if (sub === "kernel") return runNodeScript("conformance/kernel-v0/run.mjs", argv.slice(2));
    if (sub === "kernel:list") return runNodeScript("conformance/kernel-v0/run.mjs", ["--list", ...argv.slice(2)]);
    console.error(`unknown conformance subcommand: ${sub}`);
    process.exit(1);
  }

  // --- Dev stack ---

  if (cmd === "dev") {
    const sub = argv[1] ? String(argv[1]) : "";
    const rest = argv.slice(2);
    if (!sub) { console.error("usage: nooterra dev <up|down|ps|logs|info>"); process.exit(1); }

    if (sub === "up") {
      const build = !rest.includes("--no-build");
      const foreground = rest.includes("--foreground");
      const upStatus = dockerCompose(["--profile", "app", "up", ...(foreground ? [] : ["-d"]), ...(build ? ["--build"] : [])]);
      if (upStatus !== 0) process.exit(upStatus);
      const initStatus = dockerCompose(["--profile", "init", "run", "--rm", "minio-init"]);
      if (initStatus !== 0) process.exit(initStatus);
      console.log("\ndev stack is up:");
      console.log("  baseUrl:   http://127.0.0.1:3000");
      console.log("  tenantId:  tenant_default");
      console.log("  opsToken:  tok_ops");
      console.log("  explorer:  http://127.0.0.1:3000/ops/kernel/workspace?opsToken=tok_ops");
      process.exit(0);
    }
    if (sub === "down") {
      process.exit(dockerCompose(["--profile", "app", "down", ...(rest.includes("--wipe") ? ["-v"] : [])]));
    }
    if (sub === "ps") process.exit(dockerCompose(["--profile", "app", "ps"]));
    if (sub === "logs") {
      const follow = rest.includes("--follow") || rest.includes("-f");
      const sIdx = rest.findIndex((v) => v === "--service");
      const svc = sIdx >= 0 ? String(rest[sIdx + 1] ?? "").trim() : "";
      process.exit(dockerCompose(["--profile", "app", "logs", ...(follow ? ["-f"] : []), ...(svc ? [svc] : [])]));
    }
    if (sub === "info") {
      console.log(JSON.stringify({ baseUrl: "http://127.0.0.1:3000", tenantId: "tenant_default", opsToken: "tok_ops" }, null, 2));
      process.exit(0);
    }
    console.error(`unknown dev subcommand: ${sub}`);
    process.exit(1);
  }

  // --- Misc ---

  if (cmd === "closepack") {
    const sub = argv[1] ? String(argv[1]) : "";
    if (sub === "export") return runNodeScript("scripts/closepack/export.mjs", argv.slice(2));
    if (sub === "verify") return runNodeScript("scripts/closepack/verify.mjs", argv.slice(2));
    console.error("usage: nooterra closepack <export|verify>");
    process.exit(1);
  }

  if (cmd === "x402") {
    const sub = argv[1] ? String(argv[1]) : "";
    const sub2 = argv[2] ? String(argv[2]) : "";
    if (sub === "receipt" && sub2 === "verify") {
      return runNodeScript("scripts/x402/receipt-verify.mjs", argv.slice(3));
    }
    console.error("usage: nooterra x402 receipt verify <receipt.json>");
    process.exit(1);
  }

  if (cmd === "init") {
    const sub = argv[1] ? String(argv[1]) : "";
    if (sub === "capability") return runNodeScript("scripts/init/capability.mjs", argv.slice(2));
    console.error("usage: nooterra init capability <name>");
    process.exit(1);
  }

  console.error(`unknown command: ${cmd}\nRun 'nooterra --help' for usage.`);
  process.exit(1);
}

main();
