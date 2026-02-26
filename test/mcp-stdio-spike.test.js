import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("unexpected server address"));
      resolve(addr);
    });
  });
}

function onceEvent(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

test("mcp spike: initialize -> tools/list -> tools/call (submit_evidence)", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodyText
      });

      // Minimal endpoints used by submit_evidence.
      if (req.method === "GET" && req.url === "/agents/agt_1/runs/run_1/events") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ events: [{ chainHash: "ch_1" }] }));
        return;
      }
      if (req.method === "POST" && req.url === "/agents/agt_1/runs/run_1/events") {
        assert.equal(req.headers["x-proxy-expected-prev-chain-hash"], "ch_1");
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, event: { id: "evt_1" } }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin.write(payload + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5_000).unref?.();
    });
  };

  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });
  assert.equal(init.result?.serverInfo?.name, "settld-mcp-spike");

  const list = await rpc("tools/list", {});
  const names = (list.result?.tools || []).map((t) => t.name);
  assert.ok(names.includes("settld.create_agreement"));
  assert.ok(names.includes("settld.submit_evidence"));
  assert.ok(names.includes("settld.settle_run"));
  assert.ok(names.includes("settld.open_dispute"));
  assert.ok(names.includes("settld.dispute_add_evidence"));
  assert.ok(names.includes("settld.dispute_escalate"));
  assert.ok(names.includes("settld.dispute_close"));
  assert.ok(names.includes("settld.arbitration_open"));
  assert.ok(names.includes("settld.arbitration_issue_verdict"));
  assert.ok(names.includes("settld.delegation_grant_issue"));
  assert.ok(names.includes("settld.delegation_grant_get"));
  assert.ok(names.includes("settld.delegation_grant_list"));
  assert.ok(names.includes("settld.delegation_grant_revoke"));
  assert.ok(names.includes("settld.authority_grant_issue"));
  assert.ok(names.includes("settld.authority_grant_get"));
  assert.ok(names.includes("settld.authority_grant_list"));
  assert.ok(names.includes("settld.authority_grant_revoke"));
  assert.ok(names.includes("settld.agent_card_upsert"));
  assert.ok(names.includes("settld.agent_discover"));
  assert.ok(names.includes("settld.agent_discover_stream"));
  assert.ok(names.includes("settld.capability_attest"));
  assert.ok(names.includes("settld.capability_attestation_list"));
  assert.ok(names.includes("settld.capability_attestation_revoke"));
  assert.ok(names.includes("settld.work_order_create"));
  assert.ok(names.includes("settld.work_order_accept"));
  assert.ok(names.includes("settld.work_order_progress"));
  assert.ok(names.includes("settld.work_order_complete"));
  assert.ok(names.includes("settld.work_order_settle"));
  assert.ok(names.includes("settld.session_create"));
  assert.ok(names.includes("settld.session_list"));
  assert.ok(names.includes("settld.session_get"));
  assert.ok(names.includes("settld.session_events_list"));
  assert.ok(names.includes("settld.session_events_stream"));
  assert.ok(names.includes("settld.session_event_append"));
  assert.ok(names.includes("settld.session_replay_pack_get"));
  assert.ok(names.includes("settld.session_transcript_get"));
  assert.ok(names.includes("settld.audit_lineage_list"));
  assert.ok(names.includes("settld.relationships_list"));
  assert.ok(names.includes("settld.public_reputation_summary_get"));
  assert.ok(names.includes("settld.interaction_graph_pack_get"));
  assert.ok(names.includes("settld.x402_gate_create"));
  assert.ok(names.includes("settld.x402_gate_verify"));
  assert.ok(names.includes("settld.x402_gate_get"));
  assert.ok(names.includes("settld.x402_agent_lifecycle_get"));
  assert.ok(names.includes("settld.x402_agent_lifecycle_set"));

  const called = await rpc("tools/call", {
    name: "settld.submit_evidence",
    arguments: { agentId: "agt_1", runId: "run_1", evidenceRef: "evidence://demo/1" }
  });
  assert.equal(called.result?.isError, false);
  const text = called.result?.content?.[0]?.text || "";
  const parsed = JSON.parse(text);
  assert.equal(parsed.tool, "settld.submit_evidence");
  assert.equal(parsed.result?.ok, true);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  // Sanity: we hit both endpoints.
  const urls = requests.map((r) => r.url);
  assert.deepEqual(urls, ["/agents/agt_1/runs/run_1/events", "/agents/agt_1/runs/run_1/events"]);
});

test("mcp spike: dispute and arbitration tools map to dispute APIs", async () => {
  const requests = [];
  const runId = "run_dispute_1";
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.method === "POST" && req.url === `/runs/${runId}/dispute/evidence`) {
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        assert.ok(typeof req.headers["x-idempotency-key"] === "string" && req.headers["x-idempotency-key"].length > 0);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ settlement: { runId, disputeStatus: "open" }, disputeEvidence: { evidenceRef: parsedBody?.evidenceRef } }));
        return;
      }
      if (req.method === "POST" && req.url === `/runs/${runId}/dispute/escalate`) {
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        assert.ok(typeof req.headers["x-idempotency-key"] === "string" && req.headers["x-idempotency-key"].length > 0);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ settlement: { runId, disputeStatus: "open" }, disputeEscalation: { escalationLevel: parsedBody?.escalationLevel } }));
        return;
      }
      if (req.method === "POST" && req.url === `/runs/${runId}/dispute/close`) {
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        assert.ok(typeof req.headers["x-idempotency-key"] === "string" && req.headers["x-idempotency-key"].length > 0);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ settlement: { runId, disputeStatus: "closed" } }));
        return;
      }
      if (req.method === "POST" && req.url === `/runs/${runId}/arbitration/open`) {
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        assert.ok(typeof req.headers["x-idempotency-key"] === "string" && req.headers["x-idempotency-key"].length > 0);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ arbitrationCase: { caseId: "arb_case_1", runId, status: "under_review" } }));
        return;
      }
      if (req.method === "POST" && req.url === `/runs/${runId}/arbitration/verdict`) {
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        assert.ok(typeof req.headers["x-idempotency-key"] === "string" && req.headers["x-idempotency-key"].length > 0);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ arbitrationCase: { caseId: parsedBody?.caseId, runId, status: "verdict_issued" } }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref?.();
    });
  };

  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });
  assert.equal(init.result?.serverInfo?.name, "settld-mcp-spike");

  const evidence = await rpc("tools/call", {
    name: "settld.dispute_add_evidence",
    arguments: { runId, disputeId: "dsp_1", evidenceRef: "evidence://dispute/1.json", reason: "counterparty proof" }
  });
  assert.equal(evidence.result?.isError, false);
  assert.equal(JSON.parse(evidence.result?.content?.[0]?.text ?? "{}")?.result?.disputeEvidence?.evidenceRef, "evidence://dispute/1.json");

  const escalate = await rpc("tools/call", {
    name: "settld.dispute_escalate",
    arguments: { runId, disputeId: "dsp_1", escalationLevel: "l2_arbiter", reason: "needs review" }
  });
  assert.equal(escalate.result?.isError, false);
  assert.equal(JSON.parse(escalate.result?.content?.[0]?.text ?? "{}")?.result?.disputeEscalation?.escalationLevel, "l2_arbiter");

  const close = await rpc("tools/call", {
    name: "settld.dispute_close",
    arguments: { runId, disputeId: "dsp_1", resolution: { outcome: "rejected", summary: "closed by ops" } }
  });
  assert.equal(close.result?.isError, false);
  assert.equal(JSON.parse(close.result?.content?.[0]?.text ?? "{}")?.result?.settlement?.disputeStatus, "closed");

  const arbOpen = await rpc("tools/call", {
    name: "settld.arbitration_open",
    arguments: { runId, caseId: "arb_case_1", disputeId: "dsp_1", arbiterAgentId: "agt_arbiter_1", evidenceRefs: [] }
  });
  assert.equal(arbOpen.result?.isError, false);
  assert.equal(JSON.parse(arbOpen.result?.content?.[0]?.text ?? "{}")?.result?.arbitrationCase?.status, "under_review");

  const arbVerdict = await rpc("tools/call", {
    name: "settld.arbitration_issue_verdict",
    arguments: {
      runId,
      caseId: "arb_case_1",
      arbitrationVerdict: {
        schemaVersion: "ArbitrationVerdict.v1",
        verdictId: "arb_vrd_1",
        caseId: "arb_case_1",
        runId,
        disputeId: "dsp_1",
        arbiterAgentId: "agt_arbiter_1",
        outcome: "accepted",
        releaseRatePct: 100,
        rationale: "payee win",
        evidenceRefs: [],
        issuedAt: "2026-02-21T00:00:00.000Z",
        signerKeyId: "agent_key_arbiter_1",
        signature: "sig_base64",
        verdictHash: "f".repeat(64)
      }
    }
  });
  assert.equal(arbVerdict.result?.isError, false);
  assert.equal(JSON.parse(arbVerdict.result?.content?.[0]?.text ?? "{}")?.result?.arbitrationCase?.status, "verdict_issued");

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const endpoints = requests.map((row) => `${row.method} ${row.url}`);
  assert.deepEqual(endpoints, [
    `POST /runs/${runId}/dispute/evidence`,
    `POST /runs/${runId}/dispute/escalate`,
    `POST /runs/${runId}/dispute/close`,
    `POST /runs/${runId}/arbitration/open`,
    `POST /runs/${runId}/arbitration/verdict`
  ]);
});

test("mcp spike: session tools map to Session.v1 + SessionEvent.v1 APIs", async () => {
  const requests = [];
  const sessionId = "sess_mcp_1";
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body
      });

      if (req.method === "POST" && req.url === "/sessions") {
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        assert.ok(typeof req.headers["x-idempotency-key"] === "string" && req.headers["x-idempotency-key"].length > 0);
        assert.equal(body?.sessionId, sessionId);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, session: { sessionId, schemaVersion: "Session.v1" } }));
        return;
      }

      if (req.method === "GET" && req.url === `/sessions?participantAgentId=agt_worker_1&limit=25&offset=0`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessions: [{ sessionId, schemaVersion: "Session.v1" }], limit: 25, offset: 0 }));
        return;
      }

      if (req.method === "GET" && req.url === `/sessions/${sessionId}`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, session: { sessionId, schemaVersion: "Session.v1" } }));
        return;
      }

      if (req.method === "GET" && req.url === `/sessions/${sessionId}/events?eventType=TASK_REQUESTED&limit=10&offset=0`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessionId, events: [], limit: 10, offset: 0, currentPrevChainHash: "null" }));
        return;
      }

      if (req.method === "GET" && req.url === `/sessions/${sessionId}/events?limit=1&offset=0`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessionId, events: [], limit: 1, offset: 0, currentPrevChainHash: "null" }));
        return;
      }

      if (req.method === "GET" && req.url === `/sessions/${sessionId}/events/stream?eventType=TASK_REQUESTED&sinceEventId=evt_prev_1`) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          [
            "id: evt_ready",
            "event: session.ready",
            `data: ${JSON.stringify({ ok: true, sessionId })}`,
            "",
            "id: evt_session_2",
            "event: session.event",
            `data: ${JSON.stringify({ id: "evt_session_2", type: "TASK_REQUESTED", streamId: sessionId })}`,
            "",
            ""
          ].join("\n")
        );
        return;
      }

      if (req.method === "POST" && req.url === `/sessions/${sessionId}/events`) {
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        assert.equal(req.headers["x-proxy-expected-prev-chain-hash"], "null");
        assert.ok(typeof req.headers["x-idempotency-key"] === "string" && req.headers["x-idempotency-key"].length > 0);
        assert.equal(body?.eventType, "TASK_REQUESTED");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, session: { sessionId, revision: 1 }, event: { id: "evt_session_1", type: "TASK_REQUESTED" } }));
        return;
      }

      if (
        req.method === "GET" &&
        req.url === `/sessions/${sessionId}/replay-pack?sign=true&signerKeyId=key_session_signer_1`
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            replayPack: {
              schemaVersion: "SessionReplayPack.v1",
              sessionId,
              packHash: "a".repeat(64),
              signature: {
                schemaVersion: "SessionReplayPackSignature.v1",
                algorithm: "ed25519",
                keyId: "key_session_signer_1",
                signedAt: "2026-02-25T00:00:00.000Z",
                payloadHash: "a".repeat(64),
                signatureBase64: "sig"
              }
            }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === `/sessions/${sessionId}/transcript?sign=true`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            transcript: {
              schemaVersion: "SessionTranscript.v1",
              sessionId,
              transcriptHash: "b".repeat(64),
              signature: {
                schemaVersion: "SessionTranscriptSignature.v1",
                algorithm: "ed25519",
                keyId: "key_session_signer_1",
                signedAt: "2026-02-25T00:00:00.000Z",
                payloadHash: "b".repeat(64),
                signatureBase64: "sig"
              }
            }
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");
  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const created = await rpc("tools/call", {
    name: "settld.session_create",
    arguments: {
      sessionId,
      visibility: "tenant",
      participants: ["agt_principal_1", "agt_worker_1"]
    }
  });
  assert.equal(created.result?.isError, false);
  assert.equal(JSON.parse(created.result?.content?.[0]?.text ?? "{}")?.result?.session?.sessionId, sessionId);

  const listed = await rpc("tools/call", {
    name: "settld.session_list",
    arguments: {
      participantAgentId: "agt_worker_1",
      limit: 25,
      offset: 0
    }
  });
  assert.equal(listed.result?.isError, false);
  assert.equal(JSON.parse(listed.result?.content?.[0]?.text ?? "{}")?.result?.sessions?.[0]?.sessionId, sessionId);

  const got = await rpc("tools/call", {
    name: "settld.session_get",
    arguments: { sessionId }
  });
  assert.equal(got.result?.isError, false);
  assert.equal(JSON.parse(got.result?.content?.[0]?.text ?? "{}")?.result?.session?.sessionId, sessionId);

  const events = await rpc("tools/call", {
    name: "settld.session_events_list",
    arguments: { sessionId, eventType: "TASK_REQUESTED", limit: 10, offset: 0 }
  });
  assert.equal(events.result?.isError, false);
  assert.equal(JSON.parse(events.result?.content?.[0]?.text ?? "{}")?.result?.sessionId, sessionId);

  const streamEvents = await rpc("tools/call", {
    name: "settld.session_events_stream",
    arguments: {
      sessionId,
      eventType: "TASK_REQUESTED",
      sinceEventId: "evt_prev_1",
      maxEvents: 5,
      timeoutMs: 2000
    }
  });
  assert.equal(streamEvents.result?.isError, false);
  const streamEventsParsed = JSON.parse(streamEvents.result?.content?.[0]?.text ?? "{}");
  assert.equal(streamEventsParsed?.result?.sessionId, sessionId);
  assert.equal(streamEventsParsed?.result?.eventCount, 2);
  assert.equal(streamEventsParsed?.result?.lastEventId, "evt_session_2");

  const appended = await rpc("tools/call", {
    name: "settld.session_event_append",
    arguments: {
      sessionId,
      eventType: "TASK_REQUESTED",
      payload: { taskId: "task_mcp_1" }
    }
  });
  assert.equal(appended.result?.isError, false);
  const appendedParsed = JSON.parse(appended.result?.content?.[0]?.text ?? "{}");
  assert.equal(appendedParsed?.result?.expectedPrevChainHash, "null");
  assert.equal(appendedParsed?.result?.event?.id, "evt_session_1");

  const replayPack = await rpc("tools/call", {
    name: "settld.session_replay_pack_get",
    arguments: { sessionId, sign: true, signerKeyId: "key_session_signer_1" }
  });
  assert.equal(replayPack.result?.isError, false);
  const replayPackParsed = JSON.parse(replayPack.result?.content?.[0]?.text ?? "{}");
  assert.equal(replayPackParsed?.result?.replayPack?.schemaVersion, "SessionReplayPack.v1");
  assert.equal(replayPackParsed?.result?.replayPack?.sessionId, sessionId);
  assert.equal(replayPackParsed?.result?.replayPack?.signature?.schemaVersion, "SessionReplayPackSignature.v1");

  const transcript = await rpc("tools/call", {
    name: "settld.session_transcript_get",
    arguments: { sessionId, sign: true }
  });
  assert.equal(transcript.result?.isError, false);
  const transcriptParsed = JSON.parse(transcript.result?.content?.[0]?.text ?? "{}");
  assert.equal(transcriptParsed?.result?.transcript?.schemaVersion, "SessionTranscript.v1");
  assert.equal(transcriptParsed?.result?.transcript?.sessionId, sessionId);
  assert.equal(transcriptParsed?.result?.transcript?.signature?.schemaVersion, "SessionTranscriptSignature.v1");

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const endpoints = requests.map((row) => `${row.method} ${row.url}`);
  assert.deepEqual(endpoints, [
    "POST /sessions",
    "GET /sessions?participantAgentId=agt_worker_1&limit=25&offset=0",
    `GET /sessions/${sessionId}`,
    `GET /sessions/${sessionId}/events?eventType=TASK_REQUESTED&limit=10&offset=0`,
    `GET /sessions/${sessionId}/events/stream?eventType=TASK_REQUESTED&sinceEventId=evt_prev_1`,
    `GET /sessions/${sessionId}/events?limit=1&offset=0`,
    `POST /sessions/${sessionId}/events`,
    `GET /sessions/${sessionId}/replay-pack?sign=true&signerKeyId=key_session_signer_1`,
    `GET /sessions/${sessionId}/transcript?sign=true`
  ]);
});

test("mcp spike: audit lineage tool mapping", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    if (
      req.method === "GET" &&
      req.url ===
        "/ops/audit/lineage?agentId=agt_audit_1&traceId=trace_audit_1&includeSessionEvents=true&limit=50&offset=0&scanLimit=500"
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          lineage: {
            schemaVersion: "AuditLineage.v1",
            tenantId: "tenant_default",
            generatedAt: "2026-02-25T00:00:00.000Z",
            filters: {
              agentId: "agt_audit_1",
              traceId: "trace_audit_1",
              includeSessionEvents: true
            },
            records: [],
            totalMatched: 0,
            totalRecords: 0,
            limit: 50,
            offset: 0,
            lineageHash: "a".repeat(64)
          }
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const listed = await rpc("tools/call", {
    name: "settld.audit_lineage_list",
    arguments: {
      agentId: "agt_audit_1",
      traceId: "trace_audit_1",
      includeSessionEvents: true,
      limit: 50,
      offset: 0,
      scanLimit: 500
    }
  });
  assert.equal(listed.result?.isError, false);
  const listedParsed = JSON.parse(listed.result?.content?.[0]?.text ?? "{}");
  assert.equal(listedParsed?.tool, "settld.audit_lineage_list");
  assert.equal(listedParsed?.result?.lineage?.schemaVersion, "AuditLineage.v1");
  assert.equal(listedParsed?.result?.lineage?.lineageHash, "a".repeat(64));

  const invalid = await rpc("tools/call", {
    name: "settld.audit_lineage_list",
    arguments: {
      limit: 1001
    }
  });
  assert.equal(invalid.result?.isError, true);
  const invalidParsed = JSON.parse(invalid.result?.content?.[0]?.text ?? "{}");
  assert.equal(invalidParsed?.tool, "settld.audit_lineage_list");
  assert.match(String(invalidParsed?.error ?? ""), /limit must be <= 1000/i);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const endpoints = requests.map((row) => `${row.method} ${row.url}`);
  assert.deepEqual(endpoints, [
    "GET /ops/audit/lineage?agentId=agt_audit_1&traceId=trace_audit_1&includeSessionEvents=true&limit=50&offset=0&scanLimit=500"
  ]);
});

test("mcp spike: x402 gate create -> verify -> get with idempotency", async () => {
  const requests = [];
  const gateId = "x402gate_mcp_1";
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.method === "POST" && req.url === "/x402/gate/create") {
        assert.equal(req.headers["x-idempotency-key"], "idem_create_1");
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        assert.equal(parsedBody?.gateId, gateId);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            gate: { gateId, runId: `x402_${gateId}`, status: "held" },
            settlement: { runId: `x402_${gateId}`, status: "locked" }
          })
        );
        return;
      }

      if (req.method === "POST" && req.url === "/x402/gate/authorize-payment") {
        assert.equal(req.headers["x-idempotency-key"], "idem_authorize_1");
        assert.equal(parsedBody?.gateId, gateId);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            gateId,
            authorizationRef: `auth_${gateId}`,
            token: "token_1",
            tokenKid: "kid_1",
            reserve: { status: "reserved", reserveId: "reserve_1" }
          })
        );
        return;
      }

      if (req.method === "POST" && req.url === "/x402/gate/verify") {
        assert.equal(req.headers["x-idempotency-key"], "idem_verify_1");
        assert.equal(parsedBody?.gateId, gateId);
        assert.equal(parsedBody?.verificationStatus, "green");
        assert.equal(parsedBody?.runStatus, "completed");
        assert.deepEqual(parsedBody?.evidenceRefs, [
          "http:request_sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "http:response_sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        ]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            gate: { gateId, status: "resolved" },
            settlement: { runId: `x402_${gateId}`, status: "released" }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === `/x402/gate/${gateId}`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            gate: { gateId, status: "resolved" },
            settlement: { runId: `x402_${gateId}`, status: "released" }
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin.write(payload + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5_000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const create = await rpc("tools/call", {
    name: "settld.x402_gate_create",
    arguments: {
      gateId,
      payerAgentId: "agt_payer_1",
      payeeAgentId: "agt_payee_1",
      amountCents: 500,
      autoFundPayerCents: 500,
      idempotencyKey: "idem_create_1"
    }
  });
  assert.equal(create.result?.isError, false);
  const createParsed = JSON.parse(create.result?.content?.[0]?.text || "{}");
  assert.equal(createParsed?.tool, "settld.x402_gate_create");
  assert.equal(createParsed?.result?.ok, true);
  assert.equal(createParsed?.result?.gateId, gateId);

  const verify = await rpc("tools/call", {
    name: "settld.x402_gate_verify",
    arguments: {
      gateId,
      ensureAuthorized: true,
      authorizeIdempotencyKey: "idem_authorize_1",
      idempotencyKey: "idem_verify_1",
      requestSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      responseSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  });
  assert.equal(verify.result?.isError, false);
  const verifyParsed = JSON.parse(verify.result?.content?.[0]?.text || "{}");
  assert.equal(verifyParsed?.tool, "settld.x402_gate_verify");
  assert.equal(verifyParsed?.result?.ok, true);
  assert.equal(verifyParsed?.result?.ensureAuthorized, true);
  assert.equal(verifyParsed?.result?.verify?.ok, true);

  const get = await rpc("tools/call", {
    name: "settld.x402_gate_get",
    arguments: { gateId }
  });
  assert.equal(get.result?.isError, false);
  const getParsed = JSON.parse(get.result?.content?.[0]?.text || "{}");
  assert.equal(getParsed?.tool, "settld.x402_gate_get");
  assert.equal(getParsed?.result?.ok, true);
  assert.equal(getParsed?.result?.gate?.status, "resolved");

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    "POST /x402/gate/create",
    "POST /x402/gate/authorize-payment",
    "POST /x402/gate/verify",
    `GET /x402/gate/${gateId}`
  ]);
});

test("mcp spike: x402 agent lifecycle get/set tool mappings", async () => {
  const requests = [];
  const agentId = "agt_lifecycle_1";
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.method === "POST" && req.url === `/x402/gate/agents/${agentId}/lifecycle`) {
        assert.equal(req.headers["x-settld-protocol"], "1.0");
        assert.equal(req.headers["x-idempotency-key"], "idem_lifecycle_set_1");
        assert.equal(parsedBody?.status, "throttled");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            agentId,
            lifecycle: {
              schemaVersion: "X402AgentLifecycle.v1",
              agentId,
              status: "throttled",
              reasonCode: "AGENT_RATE_LIMITED"
            }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === `/x402/gate/agents/${agentId}/lifecycle`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            agentId,
            lifecycle: {
              schemaVersion: "X402AgentLifecycle.v1",
              agentId,
              status: "throttled",
              reasonCode: "AGENT_RATE_LIMITED"
            }
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin.write(payload + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5_000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const setLifecycle = await rpc("tools/call", {
    name: "settld.x402_agent_lifecycle_set",
    arguments: {
      agentId,
      status: "throttled",
      reasonCode: "AGENT_RATE_LIMITED",
      idempotencyKey: "idem_lifecycle_set_1"
    }
  });
  assert.equal(setLifecycle.result?.isError, false);
  const setParsed = JSON.parse(setLifecycle.result?.content?.[0]?.text || "{}");
  assert.equal(setParsed?.tool, "settld.x402_agent_lifecycle_set");
  assert.equal(setParsed?.result?.ok, true);
  assert.equal(setParsed?.result?.lifecycle?.status, "throttled");

  const getLifecycle = await rpc("tools/call", {
    name: "settld.x402_agent_lifecycle_get",
    arguments: { agentId }
  });
  assert.equal(getLifecycle.result?.isError, false);
  const getParsed = JSON.parse(getLifecycle.result?.content?.[0]?.text || "{}");
  assert.equal(getParsed?.tool, "settld.x402_agent_lifecycle_get");
  assert.equal(getParsed?.result?.ok, true);
  assert.equal(getParsed?.result?.lifecycle?.status, "throttled");

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((row) => `${row.method} ${row.url}`);
  assert.deepEqual(methodsAndUrls, [
    `POST /x402/gate/agents/${agentId}/lifecycle`,
    `GET /x402/gate/agents/${agentId}/lifecycle`
  ]);
});

test("mcp spike: agreement delegation create/list includes delegationHash", async () => {
  const requests = [];
  const parentAgreementHash = "1111111111111111111111111111111111111111111111111111111111111111";
  const childAgreementHash = "2222222222222222222222222222222222222222222222222222222222222222";
  const delegationHash = "3333333333333333333333333333333333333333333333333333333333333333";
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.method === "POST" && req.url === `/agreements/${parentAgreementHash}/delegations`) {
        assert.equal(req.headers["x-idempotency-key"], "idem_delegation_create_1");
        assert.equal(parsedBody?.childAgreementHash, childAgreementHash);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            delegation: {
              schemaVersion: "AgreementDelegation.v1",
              delegationId: "dlg_1",
              parentAgreementHash,
              childAgreementHash,
              delegatorAgentId: "agt_a",
              delegateeAgentId: "agt_b",
              budgetCapCents: 500,
              currency: "USD",
              delegationDepth: 1,
              maxDelegationDepth: 2,
              ancestorChain: [parentAgreementHash],
              delegationHash,
              status: "active",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === `/agreements/${parentAgreementHash}/delegations?status=active&limit=20&offset=0`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            agreementHash: parentAgreementHash,
            delegations: [{ delegationId: "dlg_1", delegationHash }],
            limit: 20,
            offset: 0,
            total: 1
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin.write(payload + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5_000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const create = await rpc("tools/call", {
    name: "settld.agreement_delegation_create",
    arguments: {
      parentAgreementHash,
      childAgreementHash,
      delegatorAgentId: "agt_a",
      delegateeAgentId: "agt_b",
      budgetCapCents: 500,
      idempotencyKey: "idem_delegation_create_1"
    }
  });
  assert.equal(create.result?.isError, false);
  const createParsed = JSON.parse(create.result?.content?.[0]?.text || "{}");
  assert.equal(createParsed?.tool, "settld.agreement_delegation_create");
  assert.equal(createParsed?.result?.ok, true);
  assert.equal(createParsed?.result?.delegation?.delegationHash, delegationHash);

  const list = await rpc("tools/call", {
    name: "settld.agreement_delegation_list",
    arguments: { agreementHash: parentAgreementHash, status: "active", limit: 20, offset: 0 }
  });
  assert.equal(list.result?.isError, false);
  const listParsed = JSON.parse(list.result?.content?.[0]?.text || "{}");
  assert.equal(listParsed?.tool, "settld.agreement_delegation_list");
  assert.equal(listParsed?.result?.ok, true);
  assert.equal(listParsed?.result?.delegations?.[0]?.delegationHash, delegationHash);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    `POST /agreements/${parentAgreementHash}/delegations`,
    `GET /agreements/${parentAgreementHash}/delegations?status=active&limit=20&offset=0`
  ]);
});

test("mcp spike: delegation grant issue/get/list/revoke tool mappings", async () => {
  const requests = [];
  const grantId = "dgrant_mcp_1";
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.method === "POST" && req.url === "/delegation-grants") {
        assert.equal(req.headers["x-idempotency-key"], "idem_delegation_grant_issue_1");
        assert.equal(parsedBody?.grantId, grantId);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            delegationGrant: {
              schemaVersion: "DelegationGrant.v1",
              grantId,
              tenantId: "tenant_default",
              delegatorAgentId: "agt_manager",
              delegateeAgentId: "agt_worker",
              scope: {
                allowedRiskClasses: ["financial"],
                sideEffectingAllowed: true
              },
              spendLimit: {
                currency: "USD",
                maxPerCallCents: 100,
                maxTotalCents: 500
              },
              chainBinding: {
                rootGrantHash: "1".repeat(64),
                parentGrantHash: null,
                depth: 0,
                maxDelegationDepth: 1
              },
              validity: {
                issuedAt: "2026-01-01T00:00:00.000Z",
                notBefore: "2026-01-01T00:00:00.000Z",
                expiresAt: "2027-01-01T00:00:00.000Z"
              },
              revocation: {
                revocable: true,
                revokedAt: null,
                revocationReasonCode: null
              },
              createdAt: "2026-01-01T00:00:00.000Z",
              grantHash: "2".repeat(64)
            }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === `/delegation-grants/${grantId}`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            delegationGrant: { grantId, grantHash: "2".repeat(64) }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === "/delegation-grants?delegateeAgentId=agt_worker&includeRevoked=false&limit=20&offset=0") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, grants: [{ grantId }], limit: 20, offset: 0 }));
        return;
      }

      if (req.method === "POST" && req.url === `/delegation-grants/${grantId}/revoke`) {
        assert.equal(req.headers["x-idempotency-key"], "idem_delegation_grant_revoke_1");
        assert.equal(parsedBody?.revocationReasonCode, "MANUAL_REVOKE");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            delegationGrant: {
              grantId,
              revocation: {
                revokedAt: "2026-02-01T00:00:00.000Z",
                revocationReasonCode: "MANUAL_REVOKE"
              }
            }
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const issued = await rpc("tools/call", {
    name: "settld.delegation_grant_issue",
    arguments: {
      grantId,
      delegatorAgentId: "agt_manager",
      delegateeAgentId: "agt_worker",
      maxPerCallCents: 100,
      maxTotalCents: 500,
      idempotencyKey: "idem_delegation_grant_issue_1"
    }
  });
  assert.equal(issued.result?.isError, false);
  const issueParsed = JSON.parse(issued.result?.content?.[0]?.text || "{}");
  assert.equal(issueParsed?.tool, "settld.delegation_grant_issue");
  assert.equal(issueParsed?.result?.delegationGrant?.grantId, grantId);

  const fetched = await rpc("tools/call", {
    name: "settld.delegation_grant_get",
    arguments: { grantId }
  });
  assert.equal(fetched.result?.isError, false);
  const fetchedParsed = JSON.parse(fetched.result?.content?.[0]?.text || "{}");
  assert.equal(fetchedParsed?.tool, "settld.delegation_grant_get");
  assert.equal(fetchedParsed?.result?.delegationGrant?.grantId, grantId);

  const listed = await rpc("tools/call", {
    name: "settld.delegation_grant_list",
    arguments: { delegateeAgentId: "agt_worker", includeRevoked: false, limit: 20, offset: 0 }
  });
  assert.equal(listed.result?.isError, false);
  const listedParsed = JSON.parse(listed.result?.content?.[0]?.text || "{}");
  assert.equal(listedParsed?.tool, "settld.delegation_grant_list");
  assert.equal(listedParsed?.result?.grants?.[0]?.grantId, grantId);

  const revoked = await rpc("tools/call", {
    name: "settld.delegation_grant_revoke",
    arguments: { grantId, revocationReasonCode: "MANUAL_REVOKE", idempotencyKey: "idem_delegation_grant_revoke_1" }
  });
  assert.equal(revoked.result?.isError, false);
  const revokedParsed = JSON.parse(revoked.result?.content?.[0]?.text || "{}");
  assert.equal(revokedParsed?.tool, "settld.delegation_grant_revoke");
  assert.equal(revokedParsed?.result?.delegationGrant?.grantId, grantId);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    "POST /delegation-grants",
    `GET /delegation-grants/${grantId}`,
    "GET /delegation-grants?delegateeAgentId=agt_worker&includeRevoked=false&limit=20&offset=0",
    `POST /delegation-grants/${grantId}/revoke`
  ]);
});

test("mcp spike: authority grant issue/get/list/revoke tool mappings", async () => {
  const requests = [];
  const grantId = "agrant_mcp_1";
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.method === "POST" && req.url === "/authority-grants") {
        assert.equal(req.headers["x-idempotency-key"], "idem_authority_grant_issue_1");
        assert.equal(parsedBody?.grantId, grantId);
        assert.equal(parsedBody?.principalRef?.principalType, "org");
        assert.equal(parsedBody?.principalRef?.principalId, "org_acme");
        assert.equal(parsedBody?.granteeAgentId, "agt_worker");
        assert.equal(parsedBody?.spendEnvelope?.maxPerCallCents, 120);
        assert.equal(parsedBody?.spendEnvelope?.maxTotalCents, 600);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            authorityGrant: {
              schemaVersion: "AuthorityGrant.v1",
              grantId,
              tenantId: "tenant_default",
              principalRef: { principalType: "org", principalId: "org_acme" },
              granteeAgentId: "agt_worker",
              scope: {
                allowedRiskClasses: ["financial"],
                sideEffectingAllowed: true
              },
              spendEnvelope: {
                currency: "USD",
                maxPerCallCents: 120,
                maxTotalCents: 600
              },
              chainBinding: {
                rootGrantHash: "1".repeat(64),
                parentGrantHash: null,
                depth: 0,
                maxDelegationDepth: 1
              },
              validity: {
                issuedAt: "2026-01-01T00:00:00.000Z",
                notBefore: "2026-01-01T00:00:00.000Z",
                expiresAt: "2027-01-01T00:00:00.000Z"
              },
              revocation: {
                revocable: true,
                revokedAt: null,
                revocationReasonCode: null
              },
              createdAt: "2026-01-01T00:00:00.000Z",
              grantHash: "2".repeat(64)
            }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === `/authority-grants/${grantId}`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            authorityGrant: { grantId, grantHash: "2".repeat(64) }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === "/authority-grants?granteeAgentId=agt_worker&includeRevoked=false&limit=20&offset=0") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, grants: [{ grantId }], limit: 20, offset: 0 }));
        return;
      }

      if (req.method === "POST" && req.url === `/authority-grants/${grantId}/revoke`) {
        assert.equal(req.headers["x-idempotency-key"], "idem_authority_grant_revoke_1");
        assert.equal(parsedBody?.revocationReasonCode, "MANUAL_REVOKE");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            authorityGrant: {
              grantId,
              revocation: {
                revokedAt: "2026-02-01T00:00:00.000Z",
                revocationReasonCode: "MANUAL_REVOKE"
              }
            }
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const issued = await rpc("tools/call", {
    name: "settld.authority_grant_issue",
    arguments: {
      grantId,
      principalRef: { principalType: "org", principalId: "org_acme" },
      granteeAgentId: "agt_worker",
      maxPerCallCents: 120,
      maxTotalCents: 600,
      idempotencyKey: "idem_authority_grant_issue_1"
    }
  });
  assert.equal(issued.result?.isError, false);
  const issueParsed = JSON.parse(issued.result?.content?.[0]?.text || "{}");
  assert.equal(issueParsed?.tool, "settld.authority_grant_issue");
  assert.equal(issueParsed?.result?.authorityGrant?.grantId, grantId);

  const fetched = await rpc("tools/call", {
    name: "settld.authority_grant_get",
    arguments: { grantId }
  });
  assert.equal(fetched.result?.isError, false);
  const fetchedParsed = JSON.parse(fetched.result?.content?.[0]?.text || "{}");
  assert.equal(fetchedParsed?.tool, "settld.authority_grant_get");
  assert.equal(fetchedParsed?.result?.authorityGrant?.grantId, grantId);

  const listed = await rpc("tools/call", {
    name: "settld.authority_grant_list",
    arguments: { granteeAgentId: "agt_worker", includeRevoked: false, limit: 20, offset: 0 }
  });
  assert.equal(listed.result?.isError, false);
  const listedParsed = JSON.parse(listed.result?.content?.[0]?.text || "{}");
  assert.equal(listedParsed?.tool, "settld.authority_grant_list");
  assert.equal(listedParsed?.result?.grants?.[0]?.grantId, grantId);

  const revoked = await rpc("tools/call", {
    name: "settld.authority_grant_revoke",
    arguments: { grantId, revocationReasonCode: "MANUAL_REVOKE", idempotencyKey: "idem_authority_grant_revoke_1" }
  });
  assert.equal(revoked.result?.isError, false);
  const revokedParsed = JSON.parse(revoked.result?.content?.[0]?.text || "{}");
  assert.equal(revokedParsed?.tool, "settld.authority_grant_revoke");
  assert.equal(revokedParsed?.result?.authorityGrant?.grantId, grantId);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    "POST /authority-grants",
    `GET /authority-grants/${grantId}`,
    "GET /authority-grants?granteeAgentId=agt_worker&includeRevoked=false&limit=20&offset=0",
    `POST /authority-grants/${grantId}/revoke`
  ]);
});

test("mcp spike: agent card upsert/discover tool mappings", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.method === "POST" && req.url === "/agent-cards") {
        assert.equal(req.headers["x-idempotency-key"], "idem_agent_card_upsert_1");
        assert.equal(parsedBody?.agentId, "agt_card_1");
        assert.equal(parsedBody?.visibility, "public");
        assert.equal(parsedBody?.host?.runtime, "openclaw");
        assert.equal(parsedBody?.priceHint?.amountCents, 250);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            agentCard: {
              schemaVersion: "AgentCard.v1",
              agentId: "agt_card_1",
              visibility: "public",
              capabilities: ["travel.booking"],
              displayName: "Travel Agent"
            }
          })
        );
        return;
      }

      if (
        req.method === "GET" &&
        req.url ===
          "/agent-cards/discover?capability=travel.booking&status=active&visibility=public&runtime=openclaw&minTrustScore=60&includeReputation=true&reputationVersion=v2&reputationWindow=30d&scoreStrategy=balanced&limit=10&offset=0"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            total: 1,
            limit: 10,
            offset: 0,
            results: [
              {
                rank: 1,
                rankingScore: 92,
                riskTier: "guarded",
                agentCard: { agentId: "agt_card_1" }
              }
            ]
          })
        );
        return;
      }

      if (
        req.method === "GET" &&
        req.url ===
          "/public/agent-cards/discover?capability=travel.booking&status=active&visibility=public&runtime=openclaw&includeReputation=false&limit=5&offset=0"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            scope: "public",
            total: 1,
            limit: 5,
            offset: 0,
            results: [
              {
                rank: 1,
                rankingScore: 95,
                riskTier: "guarded",
                agentCard: { agentId: "agt_card_1" }
              }
            ]
          })
        );
        return;
      }

      if (
        req.method === "GET" &&
        req.url ===
          "/public/agent-cards/stream?capability=travel.booking&status=active&runtime=openclaw&sinceCursor=cursor_start_1"
      ) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          [
            "id: cursor_ready",
            "event: agent_cards.ready",
            'data: {"ok":true,"scope":"public"}',
            "",
            "id: cursor_1",
            "event: agent_card.upsert",
            'data: {"schemaVersion":"AgentCardStreamEvent.v1","type":"AGENT_CARD_UPSERT","agentId":"agt_card_1"}',
            "",
            ""
          ].join("\n")
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const upserted = await rpc("tools/call", {
    name: "settld.agent_card_upsert",
    arguments: {
      agentId: "agt_card_1",
      displayName: "Travel Agent",
      capabilities: ["travel.booking"],
      visibility: "public",
      hostRuntime: "openclaw",
      priceHint: { amountCents: 250, currency: "USD", unit: "task" },
      idempotencyKey: "idem_agent_card_upsert_1"
    }
  });
  assert.equal(upserted.result?.isError, false);
  const upsertedParsed = JSON.parse(upserted.result?.content?.[0]?.text || "{}");
  assert.equal(upsertedParsed?.tool, "settld.agent_card_upsert");
  assert.equal(upsertedParsed?.result?.agentCard?.agentId, "agt_card_1");

  const discovered = await rpc("tools/call", {
    name: "settld.agent_discover",
    arguments: {
      capability: "travel.booking",
      status: "active",
      visibility: "public",
      runtime: "openclaw",
      minTrustScore: 60,
      includeReputation: true,
      reputationVersion: "v2",
      reputationWindow: "30d",
      scoreStrategy: "balanced",
      limit: 10,
      offset: 0
    }
  });
  assert.equal(discovered.result?.isError, false);
  const discoveredParsed = JSON.parse(discovered.result?.content?.[0]?.text || "{}");
  assert.equal(discoveredParsed?.tool, "settld.agent_discover");
  assert.equal(discoveredParsed?.result?.results?.[0]?.agentCard?.agentId, "agt_card_1");

  const discoveredPublic = await rpc("tools/call", {
    name: "settld.agent_discover",
    arguments: {
      scope: "public",
      capability: "travel.booking",
      status: "active",
      visibility: "public",
      runtime: "openclaw",
      includeReputation: false,
      limit: 5,
      offset: 0
    }
  });
  assert.equal(discoveredPublic.result?.isError, false);
  const discoveredPublicParsed = JSON.parse(discoveredPublic.result?.content?.[0]?.text || "{}");
  assert.equal(discoveredPublicParsed?.tool, "settld.agent_discover");
  assert.equal(discoveredPublicParsed?.result?.results?.[0]?.agentCard?.agentId, "agt_card_1");

  const streamDiscover = await rpc("tools/call", {
    name: "settld.agent_discover_stream",
    arguments: {
      capability: "travel.booking",
      status: "active",
      runtime: "openclaw",
      sinceCursor: "cursor_start_1",
      maxEvents: 5,
      timeoutMs: 2000
    }
  });
  assert.equal(streamDiscover.result?.isError, false);
  const streamDiscoverParsed = JSON.parse(streamDiscover.result?.content?.[0]?.text || "{}");
  assert.equal(streamDiscoverParsed?.tool, "settld.agent_discover_stream");
  assert.equal(streamDiscoverParsed?.result?.scope, "public");
  assert.equal(streamDiscoverParsed?.result?.eventCount, 2);
  assert.equal(streamDiscoverParsed?.result?.lastEventId, "cursor_1");

  const invalidDiscover = await rpc("tools/call", {
    name: "settld.agent_discover",
    arguments: {
      scope: "public",
      visibility: "all"
    }
  });
  assert.equal(invalidDiscover.result?.isError, true);
  const invalidDiscoverParsed = JSON.parse(invalidDiscover.result?.content?.[0]?.text || "{}");
  assert.equal(invalidDiscoverParsed?.tool, "settld.agent_discover");
  assert.match(String(invalidDiscoverParsed?.error ?? ""), /visibility must be public when scope=public/i);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    "POST /agent-cards",
    "GET /agent-cards/discover?capability=travel.booking&status=active&visibility=public&runtime=openclaw&minTrustScore=60&includeReputation=true&reputationVersion=v2&reputationWindow=30d&scoreStrategy=balanced&limit=10&offset=0",
    "GET /public/agent-cards/discover?capability=travel.booking&status=active&visibility=public&runtime=openclaw&includeReputation=false&limit=5&offset=0",
    "GET /public/agent-cards/stream?capability=travel.booking&status=active&runtime=openclaw&sinceCursor=cursor_start_1"
  ]);
});

test("mcp spike: relationship and interaction graph tools map to reputation APIs", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });

    if (
      req.method === "GET" &&
      req.url ===
        "/relationships?agentId=agt_card_1&counterpartyAgentId=agt_card_2&reputationWindow=30d&visibility=public_summary&limit=10&offset=0"
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          agentId: "agt_card_1",
          reputationWindow: "30d",
          total: 1,
          limit: 10,
          offset: 0,
          relationships: [{ schemaVersion: "RelationshipEdge.v1", agentId: "agt_card_1", counterpartyAgentId: "agt_card_2" }]
        })
      );
      return;
    }

    if (
      req.method === "GET" &&
      req.url ===
        "/public/agents/agt_card_1/reputation-summary?reputationVersion=v2&reputationWindow=30d&includeRelationships=true&relationshipLimit=3"
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          summary: {
            schemaVersion: "PublicAgentReputationSummary.v1",
            agentId: "agt_card_1",
            trustScore: 91,
            riskTier: "guarded"
          }
        })
      );
      return;
    }

    if (
      req.method === "GET" &&
      req.url ===
        "/agents/agt_card_1/interaction-graph-pack?reputationVersion=v2&reputationWindow=30d&visibility=public_summary&sign=true&signerKeyId=settld_test_ed25519&limit=5&offset=0"
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          graphPack: {
            schemaVersion: "VerifiedInteractionGraphPack.v1",
            agentId: "agt_card_1",
            relationshipsHash: "a".repeat(64),
            summaryHash: "b".repeat(64),
            signatures: [{ schemaVersion: "VerifiedInteractionGraphPackSignature.v1", keyId: "settld_test_ed25519" }]
          }
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const relationships = await rpc("tools/call", {
    name: "settld.relationships_list",
    arguments: {
      agentId: "agt_card_1",
      counterpartyAgentId: "agt_card_2",
      reputationWindow: "30d",
      visibility: "public_summary",
      limit: 10,
      offset: 0
    }
  });
  assert.equal(relationships.result?.isError, false);
  const relationshipsParsed = JSON.parse(relationships.result?.content?.[0]?.text || "{}");
  assert.equal(relationshipsParsed?.tool, "settld.relationships_list");
  assert.equal(relationshipsParsed?.result?.relationships?.[0]?.counterpartyAgentId, "agt_card_2");

  const summary = await rpc("tools/call", {
    name: "settld.public_reputation_summary_get",
    arguments: {
      agentId: "agt_card_1",
      reputationVersion: "v2",
      reputationWindow: "30d",
      includeRelationships: true,
      relationshipLimit: 3
    }
  });
  assert.equal(summary.result?.isError, false);
  const summaryParsed = JSON.parse(summary.result?.content?.[0]?.text || "{}");
  assert.equal(summaryParsed?.tool, "settld.public_reputation_summary_get");
  assert.equal(summaryParsed?.result?.summary?.agentId, "agt_card_1");

  const graphPack = await rpc("tools/call", {
    name: "settld.interaction_graph_pack_get",
    arguments: {
      agentId: "agt_card_1",
      reputationVersion: "v2",
      reputationWindow: "30d",
      visibility: "public_summary",
      sign: true,
      signerKeyId: "settld_test_ed25519",
      limit: 5,
      offset: 0
    }
  });
  assert.equal(graphPack.result?.isError, false);
  const graphPackParsed = JSON.parse(graphPack.result?.content?.[0]?.text || "{}");
  assert.equal(graphPackParsed?.tool, "settld.interaction_graph_pack_get");
  assert.equal(graphPackParsed?.result?.signed, true);
  assert.equal(graphPackParsed?.result?.graphPack?.signatures?.[0]?.keyId, "settld_test_ed25519");

  const invalidGraphPack = await rpc("tools/call", {
    name: "settld.interaction_graph_pack_get",
    arguments: {
      agentId: "agt_card_1",
      signerKeyId: "settld_test_ed25519"
    }
  });
  assert.equal(invalidGraphPack.result?.isError, true);
  const invalidGraphPackParsed = JSON.parse(invalidGraphPack.result?.content?.[0]?.text || "{}");
  assert.equal(invalidGraphPackParsed?.tool, "settld.interaction_graph_pack_get");
  assert.match(String(invalidGraphPackParsed?.error ?? ""), /signerKeyId requires sign=true/i);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    "GET /relationships?agentId=agt_card_1&counterpartyAgentId=agt_card_2&reputationWindow=30d&visibility=public_summary&limit=10&offset=0",
    "GET /public/agents/agt_card_1/reputation-summary?reputationVersion=v2&reputationWindow=30d&includeRelationships=true&relationshipLimit=3",
    "GET /agents/agt_card_1/interaction-graph-pack?reputationVersion=v2&reputationWindow=30d&visibility=public_summary&sign=true&signerKeyId=settld_test_ed25519&limit=5&offset=0"
  ]);
});

test("mcp spike: capability attestation tool mappings", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.method === "POST" && req.url === "/capability-attestations") {
        assert.equal(req.headers["x-idempotency-key"], "idem_capability_attest_1");
        assert.equal(parsedBody?.subjectAgentId, "agt_card_1");
        assert.equal(parsedBody?.capability, "travel.booking");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            capabilityAttestation: {
              schemaVersion: "CapabilityAttestation.v1",
              attestationId: "catt_1",
              subjectAgentId: "agt_card_1",
              capability: "travel.booking",
              level: "attested"
            },
            runtime: { status: "valid", isValid: true, reasonCodes: [] }
          })
        );
        return;
      }

      if (
        req.method === "GET" &&
        req.url ===
          "/capability-attestations?subjectAgentId=agt_card_1&capability=travel.booking&status=valid&includeInvalid=false&limit=10&offset=0"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            attestations: [{ capabilityAttestation: { attestationId: "catt_1" }, runtime: { status: "valid", isValid: true, reasonCodes: [] } }],
            limit: 10,
            offset: 0,
            total: 1
          })
        );
        return;
      }

      if (req.method === "POST" && req.url === "/capability-attestations/catt_1/revoke") {
        assert.equal(req.headers["x-idempotency-key"], "idem_capability_attestation_revoke_1");
        assert.equal(parsedBody?.reasonCode, "MANUAL_REVOKE");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            capabilityAttestation: { schemaVersion: "CapabilityAttestation.v1", attestationId: "catt_1" },
            runtime: { status: "revoked", isValid: false, reasonCodes: ["CAPABILITY_ATTESTATION_REVOKED"] }
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const attested = await rpc("tools/call", {
    name: "settld.capability_attest",
    arguments: {
      attestationId: "catt_1",
      subjectAgentId: "agt_card_1",
      capability: "travel.booking",
      level: "attested",
      signatureKeyId: "key_agt_card_1",
      signature: "sig_agt_card_1",
      idempotencyKey: "idem_capability_attest_1"
    }
  });
  assert.equal(attested.result?.isError, false);
  const attestedParsed = JSON.parse(attested.result?.content?.[0]?.text || "{}");
  assert.equal(attestedParsed?.tool, "settld.capability_attest");
  assert.equal(attestedParsed?.result?.capabilityAttestation?.attestationId, "catt_1");

  const listed = await rpc("tools/call", {
    name: "settld.capability_attestation_list",
    arguments: {
      subjectAgentId: "agt_card_1",
      capability: "travel.booking",
      status: "valid",
      includeInvalid: false,
      limit: 10,
      offset: 0
    }
  });
  assert.equal(listed.result?.isError, false);
  const listedParsed = JSON.parse(listed.result?.content?.[0]?.text || "{}");
  assert.equal(listedParsed?.tool, "settld.capability_attestation_list");
  assert.equal(listedParsed?.result?.attestations?.[0]?.capabilityAttestation?.attestationId, "catt_1");

  const revoked = await rpc("tools/call", {
    name: "settld.capability_attestation_revoke",
    arguments: {
      attestationId: "catt_1",
      reasonCode: "MANUAL_REVOKE",
      idempotencyKey: "idem_capability_attestation_revoke_1"
    }
  });
  assert.equal(revoked.result?.isError, false);
  const revokedParsed = JSON.parse(revoked.result?.content?.[0]?.text || "{}");
  assert.equal(revokedParsed?.tool, "settld.capability_attestation_revoke");
  assert.equal(revokedParsed?.result?.runtime?.status, "revoked");

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    "POST /capability-attestations",
    "GET /capability-attestations?subjectAgentId=agt_card_1&capability=travel.booking&status=valid&includeInvalid=false&limit=10&offset=0",
    "POST /capability-attestations/catt_1/revoke"
  ]);
});

test("mcp spike: task negotiation tool mappings", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.method === "POST" && req.url === "/task-quotes") {
        assert.equal(req.headers["x-idempotency-key"], "idem_task_quote_issue_1");
        assert.equal(parsedBody?.buyerAgentId, "agt_buyer_1");
        assert.equal(parsedBody?.sellerAgentId, "agt_seller_1");
        assert.equal(parsedBody?.traceId, "trace_mcp_task_1");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            taskQuote: {
              schemaVersion: "TaskQuote.v1",
              quoteId: "tquote_mcp_1",
              status: "open",
              quoteHash: "a".repeat(64)
            }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === "/task-quotes?buyerAgentId=agt_buyer_1&status=open&limit=10&offset=0") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            taskQuotes: [{ quoteId: "tquote_mcp_1", schemaVersion: "TaskQuote.v1", status: "open", quoteHash: "a".repeat(64) }],
            total: 1,
            limit: 10,
            offset: 0
          })
        );
        return;
      }

      if (req.method === "POST" && req.url === "/task-offers") {
        assert.equal(req.headers["x-idempotency-key"], "idem_task_offer_issue_1");
        assert.equal(parsedBody?.quoteRef?.quoteId, "tquote_mcp_1");
        assert.equal(parsedBody?.traceId, "trace_mcp_task_1");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            taskOffer: {
              schemaVersion: "TaskOffer.v1",
              offerId: "toffer_mcp_1",
              status: "open",
              offerHash: "b".repeat(64)
            }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === "/task-offers?quoteId=tquote_mcp_1&status=open&limit=10&offset=0") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            taskOffers: [{ offerId: "toffer_mcp_1", schemaVersion: "TaskOffer.v1", status: "open", offerHash: "b".repeat(64) }],
            total: 1,
            limit: 10,
            offset: 0
          })
        );
        return;
      }

      if (req.method === "POST" && req.url === "/task-acceptances") {
        assert.equal(req.headers["x-idempotency-key"], "idem_task_acceptance_issue_1");
        assert.equal(parsedBody?.quoteId, "tquote_mcp_1");
        assert.equal(parsedBody?.offerId, "toffer_mcp_1");
        assert.equal(parsedBody?.traceId, "trace_mcp_task_1");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            taskAcceptance: {
              schemaVersion: "TaskAcceptance.v1",
              acceptanceId: "taccept_mcp_1",
              status: "accepted",
              acceptanceHash: "c".repeat(64)
            }
          })
        );
        return;
      }

      if (req.method === "GET" && req.url === "/task-acceptances?quoteId=tquote_mcp_1&status=accepted&limit=10&offset=0") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            taskAcceptances: [
              { acceptanceId: "taccept_mcp_1", schemaVersion: "TaskAcceptance.v1", status: "accepted", acceptanceHash: "c".repeat(64) }
            ],
            total: 1,
            limit: 10,
            offset: 0
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const quote = await rpc("tools/call", {
    name: "settld.task_quote_issue",
    arguments: {
      buyerAgentId: "agt_buyer_1",
      sellerAgentId: "agt_seller_1",
      requiredCapability: "analysis.generic",
      amountCents: 400,
      currency: "USD",
      quoteId: "tquote_mcp_1",
      traceId: "trace_mcp_task_1",
      idempotencyKey: "idem_task_quote_issue_1"
    }
  });
  assert.equal(quote.result?.isError, false);
  assert.equal(JSON.parse(quote.result?.content?.[0]?.text || "{}")?.result?.taskQuote?.quoteId, "tquote_mcp_1");

  const quoteList = await rpc("tools/call", {
    name: "settld.task_quote_list",
    arguments: {
      buyerAgentId: "agt_buyer_1",
      status: "open",
      limit: 10,
      offset: 0
    }
  });
  assert.equal(quoteList.result?.isError, false);
  assert.equal(JSON.parse(quoteList.result?.content?.[0]?.text || "{}")?.result?.taskQuotes?.[0]?.quoteId, "tquote_mcp_1");

  const offer = await rpc("tools/call", {
    name: "settld.task_offer_issue",
    arguments: {
      buyerAgentId: "agt_buyer_1",
      sellerAgentId: "agt_seller_1",
      quoteId: "tquote_mcp_1",
      quoteHash: "a".repeat(64),
      amountCents: 400,
      currency: "USD",
      traceId: "trace_mcp_task_1",
      offerId: "toffer_mcp_1",
      idempotencyKey: "idem_task_offer_issue_1"
    }
  });
  assert.equal(offer.result?.isError, false);
  assert.equal(JSON.parse(offer.result?.content?.[0]?.text || "{}")?.result?.taskOffer?.offerId, "toffer_mcp_1");

  const offerList = await rpc("tools/call", {
    name: "settld.task_offer_list",
    arguments: {
      quoteId: "tquote_mcp_1",
      status: "open",
      limit: 10,
      offset: 0
    }
  });
  assert.equal(offerList.result?.isError, false);
  assert.equal(JSON.parse(offerList.result?.content?.[0]?.text || "{}")?.result?.taskOffers?.[0]?.offerId, "toffer_mcp_1");

  const acceptance = await rpc("tools/call", {
    name: "settld.task_acceptance_issue",
    arguments: {
      quoteId: "tquote_mcp_1",
      offerId: "toffer_mcp_1",
      acceptedByAgentId: "agt_buyer_1",
      traceId: "trace_mcp_task_1",
      acceptanceId: "taccept_mcp_1",
      idempotencyKey: "idem_task_acceptance_issue_1"
    }
  });
  assert.equal(acceptance.result?.isError, false);
  assert.equal(JSON.parse(acceptance.result?.content?.[0]?.text || "{}")?.result?.taskAcceptance?.acceptanceId, "taccept_mcp_1");

  const acceptanceList = await rpc("tools/call", {
    name: "settld.task_acceptance_list",
    arguments: {
      quoteId: "tquote_mcp_1",
      status: "accepted",
      limit: 10,
      offset: 0
    }
  });
  assert.equal(acceptanceList.result?.isError, false);
  assert.equal(JSON.parse(acceptanceList.result?.content?.[0]?.text || "{}")?.result?.taskAcceptances?.[0]?.acceptanceId, "taccept_mcp_1");

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    "POST /task-quotes",
    "GET /task-quotes?buyerAgentId=agt_buyer_1&status=open&limit=10&offset=0",
    "POST /task-offers",
    "GET /task-offers?quoteId=tquote_mcp_1&status=open&limit=10&offset=0",
    "POST /task-acceptances",
    "GET /task-acceptances?quoteId=tquote_mcp_1&status=accepted&limit=10&offset=0"
  ]);
});

test("mcp spike: work order tool mappings", async () => {
  const requests = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const parsedBody = bodyText ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      if (req.method === "POST" && req.url === "/work-orders") {
        assert.equal(req.headers["x-idempotency-key"], "idem_work_order_create_1");
        assert.equal(parsedBody?.principalAgentId, "agt_principal_1");
        assert.equal(parsedBody?.subAgentId, "agt_worker_1");
        assert.equal(parsedBody?.requiredCapability, "code.generation");
        assert.equal(parsedBody?.traceId, "trace_mcp_work_order_1");
        assert.equal(parsedBody?.x402ToolId, "tool_codegen_1");
        assert.equal(parsedBody?.x402ProviderId, "provider_openclaw_1");
        assert.equal(parsedBody?.pricing?.amountCents, 450);
        assert.equal(parsedBody?.attestationRequirement?.required, true);
        assert.equal(parsedBody?.attestationRequirement?.minLevel, "attested");
        assert.equal(parsedBody?.attestationRequirement?.issuerAgentId, "agt_issuer_1");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            workOrder: {
              schemaVersion: "SubAgentWorkOrder.v1",
              workOrderId: "workord_1",
              status: "created"
            }
          })
        );
        return;
      }

      if (req.method === "POST" && req.url === "/work-orders/workord_1/accept") {
        assert.equal(req.headers["x-idempotency-key"], "idem_work_order_accept_1");
        assert.equal(parsedBody?.acceptedByAgentId, "agt_worker_1");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            workOrder: {
              schemaVersion: "SubAgentWorkOrder.v1",
              workOrderId: "workord_1",
              status: "accepted"
            }
          })
        );
        return;
      }

      if (req.method === "POST" && req.url === "/work-orders/workord_1/progress") {
        assert.equal(req.headers["x-idempotency-key"], "idem_work_order_progress_1");
        assert.equal(parsedBody?.eventType, "progress");
        assert.equal(parsedBody?.percentComplete, 60);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            workOrder: {
              schemaVersion: "SubAgentWorkOrder.v1",
              workOrderId: "workord_1",
              status: "working"
            }
          })
        );
        return;
      }

      if (req.method === "POST" && req.url === "/work-orders/workord_1/complete") {
        assert.equal(req.headers["x-idempotency-key"], "idem_work_order_complete_1");
        assert.equal(parsedBody?.status, "success");
        assert.equal(parsedBody?.receiptId, "worec_1");
        assert.equal(parsedBody?.traceId, "trace_mcp_work_order_1");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            workOrder: {
              schemaVersion: "SubAgentWorkOrder.v1",
              workOrderId: "workord_1",
              status: "completed",
              completionReceiptId: "worec_1"
            },
            completionReceipt: {
              schemaVersion: "SubAgentCompletionReceipt.v1",
              receiptId: "worec_1",
              workOrderId: "workord_1",
              status: "success"
            }
          })
        );
        return;
      }

      if (req.method === "POST" && req.url === "/work-orders/workord_1/settle") {
        assert.equal(req.headers["x-idempotency-key"], "idem_work_order_settle_1");
        assert.equal(parsedBody?.traceId, "trace_mcp_work_order_1");
        if (parsedBody?.x402GateId === "x402gate_conflict_1") {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: "work order settlement conflict",
              details: {
                code: "WORK_ORDER_SETTLEMENT_CONFLICT",
                message: "x402ToolId does not match x402 gate binding"
              }
            })
          );
          return;
        }
        assert.equal(parsedBody?.x402GateId, "x402gate_1");
        assert.equal(parsedBody?.x402RunId, "run_1");
        assert.equal(parsedBody?.status, "released");
        assert.equal(parsedBody?.authorityGrantRef, "agrant_mcp_1");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            workOrder: {
              schemaVersion: "SubAgentWorkOrder.v1",
              workOrderId: "workord_1",
              status: "settled",
              settlement: {
                status: "released",
                authorityGrantRef: "agrant_mcp_1"
              }
            },
            completionReceipt: {
              schemaVersion: "SubAgentCompletionReceipt.v1",
              receiptId: "worec_1",
              workOrderId: "workord_1",
              status: "success"
            }
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const addr = await listen(api);
  const baseUrl = `http://${addr.address}:${addr.port}`;

  const child = spawn(process.execPath, ["scripts/mcp/settld-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SETTLD_BASE_URL: baseUrl,
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test_1.secret",
      SETTLD_PROTOCOL: "1.0"
    }
  });

  child.stdout.setEncoding("utf8");

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const rpc = async (method, params = {}) => {
    const id = String(Math.random()).slice(2);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref?.();
    });
  };

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "node-test", version: "0" },
    capabilities: {}
  });

  const created = await rpc("tools/call", {
    name: "settld.work_order_create",
    arguments: {
      principalAgentId: "agt_principal_1",
      subAgentId: "agt_worker_1",
      requiredCapability: "code.generation",
      x402ToolId: "tool_codegen_1",
      x402ProviderId: "provider_openclaw_1",
      amountCents: 450,
      currency: "USD",
      traceId: "trace_mcp_work_order_1",
      attestationRequirement: {
        required: true,
        minLevel: "attested",
        issuerAgentId: "agt_issuer_1"
      },
      idempotencyKey: "idem_work_order_create_1"
    }
  });
  assert.equal(created.result?.isError, false);
  const createdParsed = JSON.parse(created.result?.content?.[0]?.text || "{}");
  assert.equal(createdParsed?.tool, "settld.work_order_create");
  assert.equal(createdParsed?.result?.workOrder?.workOrderId, "workord_1");

  const accepted = await rpc("tools/call", {
    name: "settld.work_order_accept",
    arguments: {
      workOrderId: "workord_1",
      acceptedByAgentId: "agt_worker_1",
      idempotencyKey: "idem_work_order_accept_1"
    }
  });
  assert.equal(accepted.result?.isError, false);
  const acceptedParsed = JSON.parse(accepted.result?.content?.[0]?.text || "{}");
  assert.equal(acceptedParsed?.tool, "settld.work_order_accept");
  assert.equal(acceptedParsed?.result?.workOrder?.status, "accepted");

  const progressed = await rpc("tools/call", {
    name: "settld.work_order_progress",
    arguments: {
      workOrderId: "workord_1",
      eventType: "progress",
      percentComplete: 60,
      idempotencyKey: "idem_work_order_progress_1"
    }
  });
  assert.equal(progressed.result?.isError, false);
  const progressedParsed = JSON.parse(progressed.result?.content?.[0]?.text || "{}");
  assert.equal(progressedParsed?.tool, "settld.work_order_progress");
  assert.equal(progressedParsed?.result?.workOrder?.status, "working");

  const completed = await rpc("tools/call", {
    name: "settld.work_order_complete",
    arguments: {
      workOrderId: "workord_1",
      receiptId: "worec_1",
      status: "success",
      traceId: "trace_mcp_work_order_1",
      idempotencyKey: "idem_work_order_complete_1"
    }
  });
  assert.equal(completed.result?.isError, false);
  const completedParsed = JSON.parse(completed.result?.content?.[0]?.text || "{}");
  assert.equal(completedParsed?.tool, "settld.work_order_complete");
  assert.equal(completedParsed?.result?.completionReceipt?.receiptId, "worec_1");

  const settled = await rpc("tools/call", {
    name: "settld.work_order_settle",
    arguments: {
      workOrderId: "workord_1",
      completionReceiptId: "worec_1",
      status: "released",
      x402GateId: "x402gate_1",
      x402RunId: "run_1",
      traceId: "trace_mcp_work_order_1",
      authorityGrantRef: "agrant_mcp_1",
      idempotencyKey: "idem_work_order_settle_1"
    }
  });
  assert.equal(settled.result?.isError, false);
  const settledParsed = JSON.parse(settled.result?.content?.[0]?.text || "{}");
  assert.equal(settledParsed?.tool, "settld.work_order_settle");
  assert.equal(settledParsed?.result?.workOrder?.status, "settled");
  assert.equal(settledParsed?.result?.workOrder?.settlement?.authorityGrantRef, "agrant_mcp_1");

  const settleConflict = await rpc("tools/call", {
    name: "settld.work_order_settle",
    arguments: {
      workOrderId: "workord_1",
      completionReceiptId: "worec_1",
      status: "released",
      x402GateId: "x402gate_conflict_1",
      x402RunId: "run_conflict_1",
      traceId: "trace_mcp_work_order_1",
      authorityGrantRef: "agrant_mcp_1",
      idempotencyKey: "idem_work_order_settle_1"
    }
  });
  assert.equal(settleConflict.result?.isError, true);
  const settleConflictParsed = JSON.parse(settleConflict.result?.content?.[0]?.text || "{}");
  assert.equal(settleConflictParsed?.tool, "settld.work_order_settle");
  assert.equal(settleConflictParsed?.code, "WORK_ORDER_SETTLEMENT_CONFLICT");
  assert.match(String(settleConflictParsed?.error ?? ""), /settlement conflict/i);

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    "POST /work-orders",
    "POST /work-orders/workord_1/accept",
    "POST /work-orders/workord_1/progress",
    "POST /work-orders/workord_1/complete",
    "POST /work-orders/workord_1/settle",
    "POST /work-orders/workord_1/settle"
  ]);
});
