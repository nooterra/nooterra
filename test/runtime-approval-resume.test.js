import test from "node:test";
import assert from "node:assert/strict";

import { resumeAfterApproval } from "../services/runtime/approval-resume.js";

function makeSequentialPool(results) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (results.length === 0) {
        throw new Error(`Unexpected query: ${sql}`);
      }
      const next = results.shift();
      return typeof next === "function" ? next(sql, params) : next;
    }
  };
}

test("scheduler approval resume: replays approved tools with preserved prior assistant response", async () => {
  const pool = makeSequentialPool([
    {
      rowCount: 1,
      rows: [
        {
          id: "apr_1",
          worker_id: "wrk_1",
          tenant_id: "ten_1",
          execution_id: "exec_1",
          tool_name: "send_email",
          tool_args: { to: "alice@example.com" },
          matched_rule: "Outbound email requires approval",
          status: "approved",
          decision: "approved"
        }
      ]
    },
    {
      rowCount: 1,
      rows: [
        {
          id: "exec_1",
          worker_id: "wrk_1",
          tenant_id: "ten_1",
          status: "awaiting_approval",
          activity: [],
          result: "",
          receipt: JSON.stringify({ response: "Please execute the approved follow-up emails now." })
        }
      ]
    },
    {
      rowCount: 1,
      rows: [{ id: "wrk_1", tenant_id: "ten_1", name: "Follow-up Worker" }]
    },
    {
      rowCount: 1,
      rows: [{ id: "exec_1" }]
    },
    {
      rowCount: 2,
      rows: [
        { id: "apr_1", tool_name: "send_email", tool_args: { to: "alice@example.com" }, matched_rule: "Outbound email requires approval" },
        { id: "apr_2", tool_name: "create_task", tool_args: { title: "Log outreach" }, matched_rule: null }
      ]
    },
    {
      rowCount: 2,
      rows: []
    }
  ]);

  const executeCalls = [];
  const executeWorker = async (...args) => {
    executeCalls.push(args);
  };

  const result = await resumeAfterApproval({
    pool,
    approvalId: "apr_1",
    executeWorker,
    log: () => {}
  });

  assert.equal(result.resumed, true);
  assert.equal(result.executionId, "exec_1");
  assert.equal(executeCalls.length, 1);
  assert.equal(executeCalls[0][1], "exec_1");
  assert.equal(executeCalls[0][2], "approval_resume");
  assert.deepEqual(executeCalls[0][3].approvedToolCalls, [
    { name: "send_email", args: { to: "alice@example.com" }, matchedRule: "Outbound email requires approval" },
    { name: "create_task", args: { title: "Log outreach" }, matchedRule: null }
  ]);
  assert.equal(executeCalls[0][3].priorAssistantResponse, "Please execute the approved follow-up emails now.");
  assert.match(pool.calls[4].sql, /COALESCE\(decision, status\) = 'approved'/);
  assert.match(pool.calls[5].sql, /SET status = 'resumed'/);
});

test("scheduler approval resume: times out hung worker resumes and reverts execution status", async () => {
  const pool = makeSequentialPool([
    {
      rowCount: 1,
      rows: [
        {
          id: "apr_2",
          worker_id: "wrk_1",
          tenant_id: "ten_1",
          execution_id: "exec_2",
          tool_name: "send_email",
          tool_args: { to: "alice@example.com" },
          matched_rule: "Outbound email requires approval",
          status: "approved",
          decision: "approved"
        }
      ]
    },
    {
      rowCount: 1,
      rows: [
        {
          id: "exec_2",
          worker_id: "wrk_1",
          tenant_id: "ten_1",
          status: "awaiting_approval",
          activity: [],
          result: "",
          receipt: null
        }
      ]
    },
    {
      rowCount: 1,
      rows: [{ id: "wrk_1", tenant_id: "ten_1", name: "Follow-up Worker" }]
    },
    {
      rowCount: 1,
      rows: [{ id: "exec_2" }]
    },
    {
      rowCount: 1,
      rows: [
        { id: "apr_2", tool_name: "send_email", tool_args: { to: "alice@example.com" }, matched_rule: "Outbound email requires approval" }
      ]
    },
    {
      rowCount: 1,
      rows: []
    }
  ]);

  const originalTimeout = process.env.APPROVAL_RESUME_TIMEOUT_MS;
  process.env.APPROVAL_RESUME_TIMEOUT_MS = "10";

  try {
    const result = await resumeAfterApproval({
      pool,
      approvalId: "apr_2",
      executeWorker: async () => new Promise(() => {}),
      log: () => {}
    });

    assert.equal(result.resumed, false);
    assert.equal(result.executionId, "exec_2");
    assert.match(result.error, /timed out/i);
    assert.match(pool.calls[5].sql, /SET status = 'awaiting_approval'/);
  } finally {
    if (originalTimeout == null) delete process.env.APPROVAL_RESUME_TIMEOUT_MS;
    else process.env.APPROVAL_RESUME_TIMEOUT_MS = originalTimeout;
  }
});
