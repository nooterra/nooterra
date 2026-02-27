import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listenOnEphemeralLoopback } from "./lib/listen.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pythonAvailable() {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

test("api-sdk-python: stream_public_agent_cards parses SSE and sends Last-Event-ID", { skip: !pythonAvailable() }, async (t) => {
  const seen = {
    url: null,
    headers: null,
  };

  const server = http.createServer((req, res) => {
    seen.url = req.url ?? null;
    seen.headers = req.headers ?? {};

    if (
      req.method === "GET" &&
      req.url ===
        "/public/agent-cards/stream?capability=travel.booking&toolRiskClass=action&toolSideEffecting=true&status=active&executionCoordinatorDid=did%3Anooterra%3Acoord_alpha&runtime=openclaw&sinceCursor=cursor_1"
    ) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "x-request-id": "req_py_stream_cards_1",
      });
      res.write('id: cursor_ready\nevent: agent_cards.ready\ndata: {"ok":true,"scope":"public"}\n\n');
      res.write(": keepalive\n\n");
      res.write(
        'id: cursor_2\nevent: agent_card.upsert\ndata: {"schemaVersion":"AgentCardStreamEvent.v1","type":"AGENT_CARD_UPSERT","agentId":"agt_stream_1"}\n\n'
      );
      res.end();
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", code: "NOT_FOUND" }));
  });

  let port = null;
  try {
    ({ port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] }));
  } catch (err) {
    const cause = err?.cause ?? err;
    if (cause?.code === "EPERM" || cause?.code === "EACCES") {
      t.skip(`loopback listen not permitted (${cause.code})`);
      return;
    }
    throw err;
  }

  try {
    const pythonScript = `
import json
import os
import pathlib
import sys

repo_root = pathlib.Path(os.environ["NOOTERRA_REPO_ROOT"])
sys.path.insert(0, str(repo_root / "packages" / "api-sdk-python"))

from nooterra_api_sdk import NooterraClient

client = NooterraClient(
    base_url=os.environ["NOOTERRA_BASE_URL"],
    tenant_id="tenant_py_stream_cards",
    api_key="sk_test_py_stream_cards",
    timeout_seconds=5,
)

events = []
for event in client.stream_public_agent_cards(
    {
        "capability": "travel.booking",
        "executionCoordinatorDid": "did:nooterra:coord_alpha",
        "toolRiskClass": "action",
        "toolSideEffecting": True,
        "status": "active",
        "runtime": "openclaw",
        "sinceCursor": "cursor_1",
    },
    last_event_id="cursor_resume_1",
):
    events.append(event)
    if len(events) >= 2:
        break

print(json.dumps({"events": events}))
`;

    const run = await new Promise((resolve, reject) => {
      const child = spawn("python3", ["-c", pythonScript], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
          NOOTERRA_REPO_ROOT: REPO_ROOT,
          NOOTERRA_BASE_URL: `http://127.0.0.1:${port}`,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
    });

    assert.equal(run.status, 0, `python stream_public_agent_cards failed\nstdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    assert.equal(
      seen.url,
      "/public/agent-cards/stream?capability=travel.booking&toolRiskClass=action&toolSideEffecting=true&status=active&executionCoordinatorDid=did%3Anooterra%3Acoord_alpha&runtime=openclaw&sinceCursor=cursor_1"
    );
    assert.equal(seen.headers?.accept, "text/event-stream");
    assert.equal(seen.headers?.["last-event-id"], "cursor_resume_1");
    assert.equal(seen.headers?.authorization, "Bearer sk_test_py_stream_cards");

    const parsed = JSON.parse(String(run.stdout ?? "{}"));
    assert.equal(Array.isArray(parsed.events), true);
    assert.equal(parsed.events.length, 2);
    assert.equal(parsed.events[0]?.event, "agent_cards.ready");
    assert.equal(parsed.events[0]?.id, "cursor_ready");
    assert.equal(parsed.events[1]?.event, "agent_card.upsert");
    assert.equal(parsed.events[1]?.id, "cursor_2");
    assert.equal(parsed.events[1]?.data?.type, "AGENT_CARD_UPSERT");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("api-sdk-python: public reputation and relationships wrappers call expected endpoints", { skip: !pythonAvailable() }, async (t) => {
  const seen = [];

  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url ?? null });
    res.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": "req_py_relationships_1",
    });
    res.end(JSON.stringify({ ok: true }));
  });

  let port = null;
  try {
    ({ port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] }));
  } catch (err) {
    const cause = err?.cause ?? err;
    if (cause?.code === "EPERM" || cause?.code === "EACCES") {
      t.skip(`loopback listen not permitted (${cause.code})`);
      return;
    }
    throw err;
  }

  try {
    const pythonScript = `
import os
import pathlib
import sys

repo_root = pathlib.Path(os.environ["NOOTERRA_REPO_ROOT"])
sys.path.insert(0, str(repo_root / "packages" / "api-sdk-python"))

from nooterra_api_sdk import NooterraClient

client = NooterraClient(
    base_url=os.environ["NOOTERRA_BASE_URL"],
    tenant_id="tenant_py_relationships",
    api_key="sk_test_py_relationships",
)

client.get_public_agent_reputation_summary(
    "agt_demo",
    {
        "reputationVersion": "v2",
        "reputationWindow": "30d",
        "asOf": "2026-02-25T00:00:00.000Z",
        "includeRelationships": True,
        "relationshipLimit": 5,
    },
)

client.get_agent_interaction_graph_pack(
    "agt_demo",
    {
        "reputationVersion": "v2",
        "reputationWindow": "30d",
        "asOf": "2026-02-25T00:00:00.000Z",
        "counterpartyAgentId": "agt_peer",
        "visibility": "private",
        "sign": True,
        "signerKeyId": "key_demo_graph",
        "limit": 10,
        "offset": 0,
    },
)

client.list_relationships(
    {
        "agentId": "agt_demo",
        "counterpartyAgentId": "agt_peer",
        "reputationWindow": "30d",
        "asOf": "2026-02-25T00:00:00.000Z",
        "visibility": "private",
        "limit": 10,
        "offset": 0,
    },
)
`;
    const run = await new Promise((resolve, reject) => {
      const child = spawn("python3", ["-c", pythonScript], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
          NOOTERRA_REPO_ROOT: REPO_ROOT,
          NOOTERRA_BASE_URL: `http://127.0.0.1:${port}`,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
    });

    assert.equal(run.status, 0, `python relationship wrappers failed\nstdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    assert.deepEqual(
      seen.map((entry) => entry.url),
      [
        "/public/agents/agt_demo/reputation-summary?reputationVersion=v2&reputationWindow=30d&asOf=2026-02-25T00%3A00%3A00.000Z&includeRelationships=true&relationshipLimit=5",
        "/agents/agt_demo/interaction-graph-pack?reputationVersion=v2&reputationWindow=30d&asOf=2026-02-25T00%3A00%3A00.000Z&counterpartyAgentId=agt_peer&visibility=private&sign=true&signerKeyId=key_demo_graph&limit=10&offset=0",
        "/relationships?agentId=agt_demo&counterpartyAgentId=agt_peer&reputationWindow=30d&asOf=2026-02-25T00%3A00%3A00.000Z&visibility=private&limit=10&offset=0",
      ]
    );
    assert.ok(seen.every((entry) => entry.method === "GET"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("api-sdk-python: stream_public_agent_cards fails closed with status/code/requestId on HTTP errors", { skip: !pythonAvailable() }, async (t) => {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/public/agent-cards/stream?capability=travel.booking") {
      res.writeHead(429, {
        "content-type": "application/json",
        "x-request-id": "req_py_public_stream_rate_limited_1",
      });
      res.end(
        JSON.stringify({
          error: "public discovery rate limit exceeded",
          code: "AGENT_CARD_PUBLIC_DISCOVERY_RATE_LIMITED",
          details: { windowSeconds: 60, maxPerKey: 5 },
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", code: "NOT_FOUND" }));
  });

  let port = null;
  try {
    ({ port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] }));
  } catch (err) {
    const cause = err?.cause ?? err;
    if (cause?.code === "EPERM" || cause?.code === "EACCES") {
      t.skip(`loopback listen not permitted (${cause.code})`);
      return;
    }
    throw err;
  }

  try {
    const pythonScript = `
import json
import os
import pathlib
import sys

repo_root = pathlib.Path(os.environ["NOOTERRA_REPO_ROOT"])
sys.path.insert(0, str(repo_root / "packages" / "api-sdk-python"))

from nooterra_api_sdk import NooterraApiError, NooterraClient

client = NooterraClient(
    base_url=os.environ["NOOTERRA_BASE_URL"],
    tenant_id="tenant_py_stream_cards_error",
    api_key="sk_test_py_stream_cards_error",
    timeout_seconds=5,
)

try:
    iterator = client.stream_public_agent_cards({"capability": "travel.booking"})
    next(iterator)
    print(json.dumps({"ok": False, "error": "expected_exception"}))
except NooterraApiError as err:
    print(json.dumps({
        "ok": True,
        "status": err.status,
        "code": err.code,
        "requestId": err.request_id,
        "details": err.details
    }))
`;
    const run = await new Promise((resolve, reject) => {
      const child = spawn("python3", ["-c", pythonScript], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
          NOOTERRA_REPO_ROOT: REPO_ROOT,
          NOOTERRA_BASE_URL: `http://127.0.0.1:${port}`,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
    });

    assert.equal(run.status, 0, `python stream_public_agent_cards error contract failed\nstdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    const parsed = JSON.parse(String(run.stdout ?? "{}"));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, 429);
    assert.equal(parsed.code, "AGENT_CARD_PUBLIC_DISCOVERY_RATE_LIMITED");
    assert.equal(parsed.requestId, "req_py_public_stream_rate_limited_1");
    assert.deepEqual(parsed.details, { windowSeconds: 60, maxPerKey: 5 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
