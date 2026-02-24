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
  assert.ok(names.includes("settld.agent_card_upsert"));
  assert.ok(names.includes("settld.agent_discover"));
  assert.ok(names.includes("settld.capability_attest"));
  assert.ok(names.includes("settld.capability_attestation_list"));
  assert.ok(names.includes("settld.capability_attestation_revoke"));
  assert.ok(names.includes("settld.work_order_create"));
  assert.ok(names.includes("settld.work_order_accept"));
  assert.ok(names.includes("settld.work_order_progress"));
  assert.ok(names.includes("settld.work_order_complete"));
  assert.ok(names.includes("settld.work_order_settle"));
  assert.ok(names.includes("settld.x402_gate_create"));
  assert.ok(names.includes("settld.x402_gate_verify"));
  assert.ok(names.includes("settld.x402_gate_get"));

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

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    "POST /agent-cards",
    "GET /agent-cards/discover?capability=travel.booking&status=active&visibility=public&runtime=openclaw&minTrustScore=60&includeReputation=true&reputationVersion=v2&reputationWindow=30d&scoreStrategy=balanced&limit=10&offset=0"
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
        assert.equal(parsedBody?.x402GateId, "x402gate_1");
        assert.equal(parsedBody?.x402RunId, "run_1");
        assert.equal(parsedBody?.status, "released");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            workOrder: {
              schemaVersion: "SubAgentWorkOrder.v1",
              workOrderId: "workord_1",
              status: "settled"
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
      amountCents: 450,
      currency: "USD",
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
      idempotencyKey: "idem_work_order_settle_1"
    }
  });
  assert.equal(settled.result?.isError, false);
  const settledParsed = JSON.parse(settled.result?.content?.[0]?.text || "{}");
  assert.equal(settledParsed?.tool, "settld.work_order_settle");
  assert.equal(settledParsed?.result?.workOrder?.status, "settled");

  child.kill("SIGTERM");
  await Promise.race([onceEvent(child, "exit"), new Promise((r) => setTimeout(r, 100))]);
  api.close();

  const methodsAndUrls = requests.map((r) => `${r.method} ${r.url}`);
  assert.deepEqual(methodsAndUrls, [
    "POST /work-orders",
    "POST /work-orders/workord_1/accept",
    "POST /work-orders/workord_1/progress",
    "POST /work-orders/workord_1/complete",
    "POST /work-orders/workord_1/settle"
  ]);
});
