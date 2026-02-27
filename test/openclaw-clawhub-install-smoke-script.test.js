import assert from "node:assert/strict";
import test from "node:test";

import {
  parseClawhubInstalledRoots,
  parseArgs,
  parseMcpServerExample
} from "../scripts/ci/run-openclaw-clawhub-install-smoke.mjs";

test("openclaw clawhub install smoke parser: supports defaults and overrides", () => {
  const args = parseArgs(
    [
      "--slug",
      "nooterra-mcp-payments",
      "--out",
      "artifacts/custom/openclaw-clawhub-smoke.json",
      "--bootstrap-local",
      "--bootstrap-base-url",
      "http://127.0.0.1:3010",
      "--bootstrap-tenant-id",
      "tenant_override",
      "--bootstrap-ops-token",
      "ops_override"
    ],
    {
      NOOTERRA_CLAWHUB_SKILL_SLUG: "env_slug",
      NOOTERRA_BASE_URL: "http://127.0.0.1:3000",
      NOOTERRA_TENANT_ID: "tenant_env",
      PROXY_OPS_TOKEN: "ops_env"
    },
    "/tmp/nooterra"
  );

  assert.equal(args.slug, "nooterra-mcp-payments");
  assert.equal(args.out, "/tmp/nooterra/artifacts/custom/openclaw-clawhub-smoke.json");
  assert.equal(args.force, false);
  assert.equal(args.bootstrapLocal, true);
  assert.equal(args.bootstrapBaseUrl, "http://127.0.0.1:3010");
  assert.equal(args.bootstrapTenantId, "tenant_override");
  assert.equal(args.bootstrapOpsToken, "ops_override");
});

test("openclaw clawhub install smoke parser: rejects unknown args", () => {
  assert.throws(() => parseArgs(["--unknown"]), /unknown argument/i);
});

test("openclaw clawhub install smoke parser: supports --force", () => {
  const args = parseArgs(["--force"]);
  assert.equal(args.force, true);
});

test("openclaw clawhub install smoke parser: fails closed when slug is empty", () => {
  assert.throws(() => parseArgs(["--slug", "   "], process.env, process.cwd()), /--slug is required/i);
});

test("openclaw clawhub install smoke parser: mcp server example parser validates command/args", () => {
  const parsed = parseMcpServerExample(
    JSON.stringify({
      name: "nooterra",
      command: "npx",
      args: ["-y", "--package", "nooterra@latest", "nooterra-mcp"]
    })
  );
  assert.equal(parsed.command, "npx");
  assert.deepEqual(parsed.args, ["-y", "--package", "nooterra@latest", "nooterra-mcp"]);
  assert.throws(() => parseMcpServerExample("{}"), /missing non-empty command/i);
});

test("openclaw clawhub install smoke parser: extracts install root from clawhub output", () => {
  const roots = parseClawhubInstalledRoots(
    [
      "- Resolving nooterra-mcp-payments",
      "✔ OK. Installed nooterra-mcp-payments -> /Users/aidenlippert/.openclaw/workspace/skills/nooterra-mcp-payments"
    ].join("\n"),
    { cwd: "/tmp/work", homeDir: "/Users/aidenlippert" }
  );
  assert.deepEqual(roots, ["/Users/aidenlippert/.openclaw/workspace/skills/nooterra-mcp-payments"]);
});

test("openclaw clawhub install smoke parser: resolves relative and tilde paths", () => {
  const roots = parseClawhubInstalledRoots(
    [
      "✔ OK. Installed nooterra-mcp-payments -> ./skills/nooterra-mcp-payments",
      "✔ OK. Installed nooterra-mcp-payments -> ~/.openclaw/skills/nooterra-mcp-payments"
    ].join("\n"),
    { cwd: "/tmp/work", homeDir: "/Users/aidenlippert" }
  );
  assert.deepEqual(roots, [
    "/tmp/work/skills/nooterra-mcp-payments",
    "/Users/aidenlippert/.openclaw/skills/nooterra-mcp-payments"
  ]);
});

test("openclaw clawhub install smoke parser: extracts install root from already installed output", () => {
  const roots = parseClawhubInstalledRoots(
    [
      "Error: Already installed: /Users/aidenlippert/.openclaw/workspace/skills/nooterra-mcp-payments (use --force)"
    ].join("\n"),
    { cwd: "/tmp/work", homeDir: "/Users/aidenlippert" }
  );
  assert.deepEqual(roots, ["/Users/aidenlippert/.openclaw/workspace/skills/nooterra-mcp-payments"]);
});
