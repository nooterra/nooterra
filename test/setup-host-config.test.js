import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyNooterraServerConfig,
  buildNooterraMcpServerConfig,
  resolveHostConfigPathCandidatesDetailed,
  runHostConfigSetup
} from "../scripts/setup/host-config.mjs";

function baseEnv(overrides = {}) {
  return {
    NOOTERRA_BASE_URL: "http://127.0.0.1:3000",
    NOOTERRA_TENANT_ID: "tenant_default",
    NOOTERRA_API_KEY: "sk_test_id.secret",
    ...overrides
  };
}

test("path resolution prefers host-specific env override", () => {
  const rows = resolveHostConfigPathCandidatesDetailed({
    host: "nooterra",
    platform: "linux",
    homeDir: "/home/alice",
    cwd: "/workspace",
    env: {
      NOOTERRA_NOOTERRA_MCP_CONFIG_PATH: "configs/nooterra-mcp.json",
      NOOTERRA_HOME: "/tmp/custom-nooterra-home"
    }
  });

  assert.ok(rows.length > 0);
  assert.equal(rows[0].path, path.resolve("/workspace", "configs/nooterra-mcp.json"));
  assert.equal(rows[0].source, "env:NOOTERRA_NOOTERRA_MCP_CONFIG_PATH");
  assert.ok(rows.some((row) => row.path === path.join("/tmp/custom-nooterra-home", "config.json")));
});

test("path resolution includes platform defaults", () => {
  const rows = resolveHostConfigPathCandidatesDetailed({
    host: "cursor",
    platform: "darwin",
    homeDir: "/Users/alice",
    env: {}
  });

  assert.ok(
    rows.some(
      (row) => row.path === path.join("/Users/alice", "Library", "Application Support", "Cursor", "User", "mcp.json")
    )
  );
  assert.ok(rows.some((row) => row.path === path.join("/Users/alice", ".cursor", "mcp.json")));
});

test("merge updates mcpServers.nooterra and remains idempotent", () => {
  const nooterraServer = buildNooterraMcpServerConfig({ env: baseEnv() });
  const existing = {
    mcpServers: {
      weather: {
        command: "node",
        args: ["weather.js"],
        env: { API_KEY: "abc" }
      },
      nooterra: {
        command: "node",
        args: ["old.js"],
        env: { NOOTERRA_BASE_URL: "http://old" }
      }
    },
    metadata: { owner: "team-mcp" }
  };

  const first = applyNooterraServerConfig({
    host: "claude",
    existingConfig: existing,
    nooterraServer
  });
  assert.equal(first.keyPath, "mcpServers.nooterra");
  assert.equal(first.changed, true);
  assert.deepEqual(first.config.mcpServers.weather, existing.mcpServers.weather);
  assert.equal(first.config.metadata.owner, "team-mcp");
  assert.deepEqual(first.config.mcpServers.nooterra, nooterraServer);

  const second = applyNooterraServerConfig({
    host: "claude",
    existingConfig: first.config,
    nooterraServer
  });
  assert.equal(second.changed, false);
  assert.deepEqual(second.config, first.config);
});

test("openclaw falls back to root host-equivalent shape when no server map exists", () => {
  const nooterraServer = buildNooterraMcpServerConfig({ env: baseEnv({ NOOTERRA_PAID_TOOLS_BASE_URL: "http://127.0.0.1:8402" }) });
  const existing = {
    description: "OpenClaw skill MCP server",
    name: "placeholder",
    command: "node",
    args: ["legacy.js"],
    env: { LEGACY: "1" }
  };

  const merged = applyNooterraServerConfig({
    host: "openclaw",
    existingConfig: existing,
    nooterraServer
  });

  assert.equal(merged.keyPath, "root");
  assert.equal(merged.config.description, existing.description);
  assert.equal(merged.config.name, "nooterra");
  assert.equal(merged.config.command, "npx");
  assert.deepEqual(merged.config.args, ["-y", "--package", "nooterra", "nooterra-mcp"]);
  assert.equal(merged.config.env.NOOTERRA_BASE_URL, "http://127.0.0.1:3000");
  assert.equal(merged.config.env.NOOTERRA_PAID_TOOLS_BASE_URL, "http://127.0.0.1:8402");
});

test("buildNooterraMcpServerConfig includes normalized paid-tools agent passport when provided", () => {
  const server = buildNooterraMcpServerConfig({
    env: baseEnv({
      NOOTERRA_PAID_TOOLS_AGENT_PASSPORT: JSON.stringify({
        schemaVersion: "X402AgentPassport.v1",
        sponsorRef: "sponsor_default",
        sponsorWalletRef: "wallet_engineering-spend",
        agentKeyId: "agent_key_default",
        policyRef: "engineering-spend",
        policyVersion: 1,
        delegationDepth: 0
      })
    })
  });
  assert.equal(typeof server.env.NOOTERRA_PAID_TOOLS_AGENT_PASSPORT, "string");
  const parsed = JSON.parse(server.env.NOOTERRA_PAID_TOOLS_AGENT_PASSPORT);
  assert.equal(parsed.schemaVersion, "X402AgentPassport.v1");
  assert.equal(parsed.sponsorRef, "sponsor_default");
  assert.equal(parsed.sponsorWalletRef, "wallet_engineering-spend");
  assert.equal(parsed.agentKeyId, "agent_key_default");
  assert.equal(parsed.policyRef, "engineering-spend");
  assert.equal(parsed.policyVersion, 1);
  assert.equal(parsed.delegationDepth, 0);
});

test("buildNooterraMcpServerConfig rejects malformed paid-tools passport policy tuple", () => {
  assert.throws(
    () =>
      buildNooterraMcpServerConfig({
        env: baseEnv({
          NOOTERRA_PAID_TOOLS_AGENT_PASSPORT: JSON.stringify({
            schemaVersion: "X402AgentPassport.v1",
            sponsorRef: "sponsor_default",
            agentKeyId: "agent_key_default",
            sponsorWalletRef: "wallet_only_without_policy"
          })
        })
      }),
    /must include sponsorWalletRef \+ policyRef \+ policyVersion together/
  );
});

test("dry-run does not modify config file", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-host-config-test-"));
  try {
    const configPath = path.join(tempDir, "nooterra-config.json");
    const initial = {
      mcpServers: {
        nooterra: {
          command: "node",
          args: ["legacy.js"],
          env: { NOOTERRA_BASE_URL: "http://old" }
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(initial, null, 2) + "\n", "utf8");

    const summary = await runHostConfigSetup({
      host: "nooterra",
      configPath,
      dryRun: true,
      env: baseEnv()
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.dryRun, true);
    assert.equal(summary.wroteFile, false);
    assert.equal(summary.changed, true);
    assert.equal(summary.pathSource, "cli:--config-path");

    const after = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.deepEqual(after, initial);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runHostConfigSetup writes once and then becomes idempotent", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-host-config-test-"));
  try {
    const configPath = path.join(tempDir, "claude-config.json");

    const first = await runHostConfigSetup({
      host: "claude",
      configPath,
      env: baseEnv({
        NOOTERRA_PAID_TOOLS_BASE_URL: "https://paid.tools.nooterra.work",
        NOOTERRA_PAID_TOOLS_AGENT_PASSPORT: JSON.stringify({
          schemaVersion: "X402AgentPassport.v1",
          sponsorRef: "sponsor_default",
          sponsorWalletRef: "wallet_engineering-spend",
          agentKeyId: "agent_key_default",
          policyRef: "engineering-spend",
          policyVersion: 1,
          delegationDepth: 0
        })
      })
    });

    assert.equal(first.ok, true);
    assert.equal(first.changed, true);
    assert.equal(first.wroteFile, true);
    assert.equal(first.existed, false);
    assert.equal(first.keyPath, "mcpServers.nooterra");

    const written = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(written.mcpServers?.nooterra?.command, "npx");
    assert.deepEqual(written.mcpServers?.nooterra?.args, ["-y", "--package", "nooterra", "nooterra-mcp"]);
    assert.equal(written.mcpServers?.nooterra?.env?.NOOTERRA_API_KEY, "sk_test_id.secret");
    assert.equal(typeof written.mcpServers?.nooterra?.env?.NOOTERRA_PAID_TOOLS_AGENT_PASSPORT, "string");

    const second = await runHostConfigSetup({
      host: "claude",
      configPath,
      env: baseEnv({
        NOOTERRA_PAID_TOOLS_BASE_URL: "https://paid.tools.nooterra.work",
        NOOTERRA_PAID_TOOLS_AGENT_PASSPORT: JSON.stringify({
          schemaVersion: "X402AgentPassport.v1",
          sponsorRef: "sponsor_default",
          sponsorWalletRef: "wallet_engineering-spend",
          agentKeyId: "agent_key_default",
          policyRef: "engineering-spend",
          policyVersion: 1,
          delegationDepth: 0
        })
      })
    });

    assert.equal(second.ok, true);
    assert.equal(second.changed, false);
    assert.equal(second.wroteFile, false);
    assert.equal(second.existed, true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
