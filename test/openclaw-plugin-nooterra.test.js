import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseNooterraServerConfig, parseNooterraEnvFromServer, resolveNooterraEnv, normalizeToolArguments } from "../openclaw/index.js";

const ENV_KEYS = [
  "NOOTERRA_BASE_URL",
  "NOOTERRA_TENANT_ID",
  "NOOTERRA_API_KEY",
  "NOOTERRA_PAID_TOOLS_BASE_URL",
  "NOOTERRA_PAID_TOOLS_AGENT_PASSPORT",
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

test("parseNooterraServerConfig supports mcpServers and root shapes", () => {
  const fromContainer = parseNooterraServerConfig({
    mcpServers: {
      nooterra: {
        name: "nooterra",
        command: "npx"
      }
    }
  });
  assert.equal(fromContainer?.name, "nooterra");

  const fromRoot = parseNooterraServerConfig({
    name: "nooterra",
    command: "npx",
    args: ["-y", "--package", "nooterra", "nooterra-mcp"]
  });
  assert.equal(fromRoot?.command, "npx");
});

test("parseNooterraEnvFromServer picks required + optional vars", () => {
  const parsed = parseNooterraEnvFromServer({
    env: {
      NOOTERRA_BASE_URL: "https://api.nooterra.work",
      NOOTERRA_TENANT_ID: "tenant_test",
      NOOTERRA_API_KEY: "sk_live_test.secret",
      NOOTERRA_PAID_TOOLS_BASE_URL: "https://paid.example",
      IGNORE_ME: "x"
    }
  });
  assert.equal(parsed.NOOTERRA_BASE_URL, "https://api.nooterra.work");
  assert.equal(parsed.NOOTERRA_TENANT_ID, "tenant_test");
  assert.equal(parsed.NOOTERRA_API_KEY, "sk_live_test.secret");
  assert.equal(parsed.NOOTERRA_PAID_TOOLS_BASE_URL, "https://paid.example");
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "IGNORE_ME"), false);
});

test("resolveNooterraEnv reads from mcp config when env vars are missing", async () => {
  const envSnapshot = snapshotEnv();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-openclaw-plugin-"));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    const mcpPath = path.join(tmpDir, "mcp.json");
    await fs.writeFile(
      mcpPath,
      `${JSON.stringify(
        {
          mcpServers: {
            nooterra: {
              name: "nooterra",
              command: "npx",
              args: ["-y", "--package", "nooterra", "nooterra-mcp"],
              env: {
                NOOTERRA_BASE_URL: "https://api.nooterra.work",
                NOOTERRA_TENANT_ID: "tenant_from_file",
                NOOTERRA_API_KEY: "sk_live_file.secret"
              }
            }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const env = await resolveNooterraEnv({ mcpConfigPath: mcpPath });
    assert.equal(env.NOOTERRA_BASE_URL, "https://api.nooterra.work");
    assert.equal(env.NOOTERRA_TENANT_ID, "tenant_from_file");
    assert.equal(env.NOOTERRA_API_KEY, "sk_live_file.secret");
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
