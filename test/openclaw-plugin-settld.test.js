import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseSettldServerConfig, parseSettldEnvFromServer, resolveSettldEnv, normalizeToolArguments } from "../openclaw/index.js";

const ENV_KEYS = [
  "SETTLD_BASE_URL",
  "SETTLD_TENANT_ID",
  "SETTLD_API_KEY",
  "SETTLD_PAID_TOOLS_BASE_URL",
  "SETTLD_PAID_TOOLS_AGENT_PASSPORT",
  "OPENCLAW_MCP_CONFIG_PATH"
];

function snapshotEnv() {
  const out = {};
  for (const key of ENV_KEYS) out[key] = process.env[key];
  return out;
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

test("parseSettldServerConfig supports mcpServers and root shapes", () => {
  const fromContainer = parseSettldServerConfig({
    mcpServers: {
      settld: {
        name: "settld",
        command: "npx"
      }
    }
  });
  assert.equal(fromContainer?.name, "settld");

  const fromRoot = parseSettldServerConfig({
    name: "settld",
    command: "npx",
    args: ["-y", "--package", "settld", "settld-mcp"]
  });
  assert.equal(fromRoot?.command, "npx");
});

test("parseSettldEnvFromServer picks required + optional vars", () => {
  const parsed = parseSettldEnvFromServer({
    env: {
      SETTLD_BASE_URL: "https://api.settld.work",
      SETTLD_TENANT_ID: "tenant_test",
      SETTLD_API_KEY: "sk_live_test.secret",
      SETTLD_PAID_TOOLS_BASE_URL: "https://paid.example",
      IGNORE_ME: "x"
    }
  });
  assert.equal(parsed.SETTLD_BASE_URL, "https://api.settld.work");
  assert.equal(parsed.SETTLD_TENANT_ID, "tenant_test");
  assert.equal(parsed.SETTLD_API_KEY, "sk_live_test.secret");
  assert.equal(parsed.SETTLD_PAID_TOOLS_BASE_URL, "https://paid.example");
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "IGNORE_ME"), false);
});

test("resolveSettldEnv reads from mcp config when env vars are missing", async () => {
  const envSnapshot = snapshotEnv();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-openclaw-plugin-"));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    const mcpPath = path.join(tmpDir, "mcp.json");
    await fs.writeFile(
      mcpPath,
      `${JSON.stringify(
        {
          mcpServers: {
            settld: {
              name: "settld",
              command: "npx",
              args: ["-y", "--package", "settld", "settld-mcp"],
              env: {
                SETTLD_BASE_URL: "https://api.settld.work",
                SETTLD_TENANT_ID: "tenant_from_file",
                SETTLD_API_KEY: "sk_live_file.secret"
              }
            }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const env = await resolveSettldEnv({ mcpConfigPath: mcpPath });
    assert.equal(env.SETTLD_BASE_URL, "https://api.settld.work");
    assert.equal(env.SETTLD_TENANT_ID, "tenant_from_file");
    assert.equal(env.SETTLD_API_KEY, "sk_live_file.secret");
  } finally {
    restoreEnv(envSnapshot);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("normalizeToolArguments supports object and JSON string inputs", () => {
  assert.deepEqual(normalizeToolArguments({ arguments: { city: "Chicago" } }), { city: "Chicago" });
  assert.deepEqual(normalizeToolArguments({ argumentsJson: "{\"city\":\"Chicago\"}" }), { city: "Chicago" });
  assert.throws(() => normalizeToolArguments({ argumentsJson: "[]" }), /must decode to a JSON object/);
});
