import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { executeBuiltinTool, setPool } from "../services/runtime/builtin-tools.js";

const PROVIDER_FIXTURE_DIR = path.resolve(process.cwd(), "test", "fixtures", "provider-contracts");

async function readProviderFixture(name) {
  return JSON.parse(await fs.readFile(path.join(PROVIDER_FIXTURE_DIR, name), "utf8"));
}

function createMockPool() {
  const state = {
    sideEffects: [],
  };

  const query = async (sql, params = []) => {
    const normalized = String(sql).replace(/\s+/g, " ").trim();

    if (normalized.startsWith("SELECT id, request_hash, status, response_json, error_text, replay_count, last_replayed_at FROM worker_tool_side_effects")) {
      const [tenantId, toolName, idempotencyKey] = params;
      const row = state.sideEffects.find((entry) =>
        entry.tenant_id === tenantId && entry.tool_name === toolName && entry.idempotency_key === idempotencyKey
      );
      return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
    }

    if (normalized.startsWith("INSERT INTO worker_tool_side_effects")) {
      const [id, tenantId, workerId, executionId, toolName, idempotencyKey, requestHash, requestJson, target, amountUsd] = params;
      state.sideEffects.push({
        id,
        tenant_id: tenantId,
        worker_id: workerId,
        execution_id: executionId,
        tool_name: toolName,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        request_json: JSON.parse(requestJson),
        status: "pending",
        target,
        amount_usd: amountUsd == null ? null : Number(amountUsd),
        provider_ref: null,
        response_json: null,
        error_text: null,
        replay_count: 0,
        last_replayed_at: null,
      });
      return { rowCount: 1, rows: [{ id }] };
    }

    if (normalized.startsWith("UPDATE worker_tool_side_effects SET replay_count = COALESCE(replay_count, 0) + 1")) {
      const [tenantId, toolName, idempotencyKey] = params;
      const row = state.sideEffects.find((entry) =>
        entry.tenant_id === tenantId && entry.tool_name === toolName && entry.idempotency_key === idempotencyKey
      );
      if (!row) return { rowCount: 0, rows: [] };
      row.replay_count = Number(row.replay_count || 0) + 1;
      row.last_replayed_at = new Date().toISOString();
      return { rowCount: 1, rows: [] };
    }

    if (normalized.startsWith("UPDATE worker_tool_side_effects SET status = $4")) {
      const [tenantId, toolName, idempotencyKey, status, responseJson, errorText, providerRef] = params;
      const row = state.sideEffects.find((entry) =>
        entry.tenant_id === tenantId && entry.tool_name === toolName && entry.idempotency_key === idempotencyKey
      );
      if (!row) return { rowCount: 0, rows: [] };
      row.status = status;
      row.response_json = responseJson == null ? null : JSON.parse(responseJson);
      row.error_text = errorText ?? null;
      row.provider_ref = providerRef ?? null;
      return { rowCount: 1, rows: [] };
    }

    if (normalized.startsWith("SELECT COUNT(*)::int AS call_count,")) {
      return { rowCount: 1, rows: [{ call_count: 0, total_amount: 0 }] };
    }

    throw new Error(`Unhandled SQL in provider mock pool: ${normalized}`);
  };

  return { state, query };
}

function withProviderEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("scheduler builtin provider contracts: Twilio SMS invalid JSON fails closed and replays without refetch", async () => {
  const pool = createMockPool();
  setPool(pool);

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  await withProviderEnv({
    TWILIO_ACCOUNT_SID: "acct_test",
    TWILIO_AUTH_TOKEN: "token_test",
    TWILIO_PHONE_NUMBER: "+14155550199",
  }, async () => {
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          throw new SyntaxError("bad json");
        },
      };
    };

    const meta = { tenant_id: "tenant_1", worker_id: "worker_1", execution_id: "exec_sms_1", tool_call_id: "tool_sms_1" };
    const args = { to: "+14155550100", body: "Hello" };
    const first = await executeBuiltinTool("send_sms", args, meta);
    const replay = await executeBuiltinTool("send_sms", args, meta);

    assert.equal(first.success, false);
    assert.match(first.error, /invalid json/i);
    assert.equal(replay.success, false);
    assert.match(replay.error, /invalid json/i);
    assert.equal(fetchCalls, 1);
    assert.equal(pool.state.sideEffects[0].status, "failed");
    assert.equal(pool.state.sideEffects[0].replay_count, 1);
  }).finally(() => {
    globalThis.fetch = originalFetch;
  });
});

test("scheduler builtin provider contracts: Twilio SMS accepts the committed success fixture and persists provider metadata", async () => {
  const pool = createMockPool();
  setPool(pool);

  const fixture = await readProviderFixture("twilio-message-create-success.json");
  const originalFetch = globalThis.fetch;

  await withProviderEnv({
    TWILIO_ACCOUNT_SID: "acct_test",
    TWILIO_AUTH_TOKEN: "token_test",
    TWILIO_PHONE_NUMBER: "+14155550199",
  }, async () => {
    globalThis.fetch = async (url, options = {}) => {
      assert.match(String(url), /\/Messages\.json$/);
      assert.match(String(options.headers?.Authorization || ""), /^Basic /);
      assert.equal(options.method, "POST");
      assert.equal(options.headers?.["Content-Type"], "application/x-www-form-urlencoded");

      const body = new URLSearchParams(String(options.body || ""));
      assert.equal(body.get("To"), "+14155550100");
      assert.equal(body.get("From"), "+14155550199");
      assert.equal(body.get("Body"), "Hello from Nooterra");

      return {
        ok: true,
        async json() {
          return fixture;
        },
      };
    };

    const result = await executeBuiltinTool("send_sms", {
      to: "+14155550100",
      body: "Hello from Nooterra",
    }, {
      tenant_id: "tenant_1",
      worker_id: "worker_1",
      execution_id: "exec_sms_fixture_1",
      tool_call_id: "tool_sms_fixture_1",
    });

    assert.equal(result.success, true);
    assert.equal(result.result.sid, fixture.sid);
    assert.equal(result.result.status, fixture.status);
    assert.equal(result.result.idempotent_replay, false);
    assert.equal(pool.state.sideEffects[0].status, "succeeded");
    assert.equal(pool.state.sideEffects[0].provider_ref, fixture.sid);
  }).finally(() => {
    globalThis.fetch = originalFetch;
  });
});

test("scheduler builtin provider contracts: Twilio call response missing sid fails closed", async () => {
  const pool = createMockPool();
  setPool(pool);

  const originalFetch = globalThis.fetch;

  await withProviderEnv({
    TWILIO_ACCOUNT_SID: "acct_test",
    TWILIO_AUTH_TOKEN: "token_test",
    TWILIO_PHONE_NUMBER: "+14155550199",
  }, async () => {
    globalThis.fetch = async () => ({
      ok: true,
      async json() {
        return { status: "queued" };
      },
    });

    const result = await executeBuiltinTool("make_phone_call", {
      to: "+14155550100",
      message: "Reminder",
      voice: "alice",
    }, {
      tenant_id: "tenant_1",
      worker_id: "worker_1",
      execution_id: "exec_call_1",
      tool_call_id: "tool_call_1",
    });

    assert.equal(result.success, false);
    assert.match(result.error, /missing sid/i);
    assert.equal(pool.state.sideEffects[0].status, "failed");
  }).finally(() => {
    globalThis.fetch = originalFetch;
  });
});

test("scheduler builtin provider contracts: Twilio call accepts the committed success fixture", async () => {
  const pool = createMockPool();
  setPool(pool);

  const fixture = await readProviderFixture("twilio-call-create-success.json");
  const originalFetch = globalThis.fetch;

  await withProviderEnv({
    TWILIO_ACCOUNT_SID: "acct_test",
    TWILIO_AUTH_TOKEN: "token_test",
    TWILIO_PHONE_NUMBER: "+14155550199",
  }, async () => {
    globalThis.fetch = async (url, options = {}) => {
      assert.match(String(url), /\/Calls\.json$/);
      assert.equal(options.method, "POST");
      assert.match(String(options.headers?.Authorization || ""), /^Basic /);

      const body = new URLSearchParams(String(options.body || ""));
      assert.equal(body.get("To"), "+14155550100");
      assert.equal(body.get("From"), "+14155550199");
      assert.match(String(body.get("Twiml") || ""), /<Say voice="alice">Reminder<\/Say>/);

      return {
        ok: true,
        async json() {
          return fixture;
        },
      };
    };

    const result = await executeBuiltinTool("make_phone_call", {
      to: "+14155550100",
      message: "Reminder",
      voice: "alice",
    }, {
      tenant_id: "tenant_1",
      worker_id: "worker_1",
      execution_id: "exec_call_fixture_1",
      tool_call_id: "tool_call_fixture_1",
    });

    assert.equal(result.success, true);
    assert.equal(result.result.sid, fixture.sid);
    assert.equal(result.result.status, fixture.status);
    assert.equal(pool.state.sideEffects[0].status, "succeeded");
    assert.equal(pool.state.sideEffects[0].provider_ref, fixture.sid);
  }).finally(() => {
    globalThis.fetch = originalFetch;
  });
});

test("scheduler builtin provider contracts: Resend timeout fails closed and replays without refetch", async () => {
  const pool = createMockPool();
  setPool(pool);

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  await withProviderEnv({
    RESEND_API_KEY: "re_test",
    RESEND_FROM: "workers@example.com",
  }, async () => {
    globalThis.fetch = async () => {
      fetchCalls += 1;
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    };

    const meta = { tenant_id: "tenant_1", worker_id: "worker_1", execution_id: "exec_email_1", tool_call_id: "tool_email_1" };
    const args = { to: "alice@example.com", subject: "Hello", body: "World" };
    const first = await executeBuiltinTool("send_email", args, meta);
    const replay = await executeBuiltinTool("send_email", args, meta);

    assert.equal(first.success, false);
    assert.match(first.error, /timed out/i);
    assert.equal(replay.success, false);
    assert.match(replay.error, /timed out/i);
    assert.equal(fetchCalls, 1);
    assert.equal(pool.state.sideEffects[0].status, "failed");
    assert.equal(pool.state.sideEffects[0].replay_count, 1);
  }).finally(() => {
    globalThis.fetch = originalFetch;
  });
});

test("scheduler builtin provider contracts: Resend email accepts the committed success fixture", async () => {
  const pool = createMockPool();
  setPool(pool);

  const fixture = await readProviderFixture("resend-email-create-success.json");
  const originalFetch = globalThis.fetch;

  await withProviderEnv({
    RESEND_API_KEY: "re_test",
    RESEND_FROM: "workers@example.com",
  }, async () => {
    globalThis.fetch = async (url, options = {}) => {
      assert.equal(String(url), "https://api.resend.com/emails");
      assert.equal(options.method, "POST");
      assert.equal(options.headers?.Authorization, "Bearer re_test");
      assert.equal(options.headers?.["Content-Type"], "application/json");

      const payload = JSON.parse(String(options.body || "{}"));
      assert.equal(payload.from, "workers@example.com");
      assert.equal(payload.to, "alice@example.com");
      assert.equal(payload.subject, "Hello");
      assert.equal(payload.text, "World");

      return {
        ok: true,
        async json() {
          return fixture;
        },
      };
    };

    const result = await executeBuiltinTool("send_email", {
      to: "alice@example.com",
      subject: "Hello",
      body: "World",
    }, {
      tenant_id: "tenant_1",
      worker_id: "worker_1",
      execution_id: "exec_email_fixture_1",
      tool_call_id: "tool_email_fixture_1",
    });

    assert.equal(result.success, true);
    assert.equal(result.result.id, fixture.id);
    assert.equal(result.result.idempotent_replay, false);
    assert.equal(pool.state.sideEffects[0].status, "succeeded");
    assert.equal(pool.state.sideEffects[0].provider_ref, fixture.id);
  }).finally(() => {
    globalThis.fetch = originalFetch;
  });
});
