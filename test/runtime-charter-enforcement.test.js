import test from "node:test";
import assert from "node:assert/strict";

import { autoPauseWorker, createApprovalRecord, getAvgExecutionCost, validateToolCall } from "../services/runtime/charter-enforcement.js";
import { evaluatePredicate, PREDICATE_TYPES } from "../services/runtime/world-model-predicates.js";

test("scheduler charter enforcement: world-model invariants can hard-block tool calls", () => {
  const result = validateToolCall(
    { canDo: ["send_email"] },
    "send_email",
    { to: "ceo@competitor.com", subject: "Hello" },
    {
      invariants: [
        {
          id: "inv_competitor_domain_block",
          appliesTo: ["send_email"],
          statement: "Never send email to competitor domains",
          violationCategory: "neverDo",
          predicate: "NOT_MATCHES_PATTERN",
          argPath: "to",
          predicateArgs: { pattern: "@competitor\\.com$" }
        }
      ]
    }
  );

  assert.equal(result.allowed, false);
  assert.equal(result.ruleType, "neverDo");
  assert.match(result.reason, /world-model invariant/i);
  assert.equal(result.rule, "Never send email to competitor domains");
});

test("scheduler charter enforcement: world-model invariants can escalate to approval", () => {
  const result = validateToolCall(
    { canDo: ["create_invoice"] },
    "create_invoice",
    { amount: 1500, currency: "USD" },
    {
      invariants: [
        {
          id: "inv_large_invoice_approval",
          appliesTo: ["create_invoice"],
          statement: "Invoices above $500 require approval",
          violationCategory: "askFirst",
          predicate: "LESS_THAN_OR_EQUAL",
          argPath: "amount",
          predicateArgs: { threshold: 500 }
        }
      ]
    }
  );

  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.ruleType, "askFirst");
  assert.equal(result.matchedRule, "Invoices above $500 require approval");
});

test("scheduler charter enforcement: temporary policy overrides can force approval re-entry", () => {
  const result = validateToolCall(
    { canDo: ["send_email"] },
    "send_email",
    { to: "alice@example.com", subject: "Hi" },
    null,
    {
      forceApprovalForAllTools: true,
      matchedRule: "Webhook anomaly approval re-entry",
      reason: "Replay spike requires approval re-entry",
    }
  );

  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.ruleType, "askFirst");
  assert.equal(result.matchedRule, "Webhook anomaly approval re-entry");
  assert.match(result.reason, /replay spike/i);
});

test("scheduler charter enforcement: temporary policy overrides can force approval for a specific tool", () => {
  const result = validateToolCall(
    { canDo: ["send_email", "send_sms"] },
    "send_email",
    { to: "alice@example.com", subject: "Hi" },
    null,
    {
      forceApprovalToolNames: ["send_email"],
      forceApprovalToolReasons: {
        send_email: "Repeated outbound provider failures require approval re-entry for send_email",
      },
    }
  );

  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.ruleType, "askFirst");
  assert.match(result.reason, /provider failures/i);
});

test("scheduler charter enforcement: temporary policy overrides can block a specific tool", () => {
  const result = validateToolCall(
    { canDo: ["send_email", "send_sms"] },
    "send_sms",
    { to: "+14155550100", body: "Hi" },
    null,
    {
      blockedToolNames: ["send_sms"],
      blockedToolReasons: {
        send_sms: "Provider cooldown active for send_sms",
      },
    }
  );

  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, undefined);
  assert.equal(result.ruleType, "neverDo");
  assert.match(result.reason, /cooldown/i);
});

test("scheduler charter enforcement: approval records preserve tool replay contract", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }
  };

  const approvalId = await createApprovalRecord(pool, {
    workerId: "wrk_1",
    tenantId: "ten_1",
    executionId: "exec_1",
    toolName: "send_email",
    toolArgs: { to: "alice@example.com", subject: "Hi Alice" },
    action: "Tool call: send_email",
    matchedRule: "Outbound email requires approval"
  });

  assert.match(approvalId, /^apr_/);
  assert.equal(queries.length, 1);
  const { params } = queries[0];
  assert.equal(params[1], "ten_1");
  assert.equal(params[2], "wrk_1");
  assert.equal(params[3], "exec_1");
  assert.equal(params[4], "send_email");
  assert.deepEqual(params[5], { to: "alice@example.com", subject: "Hi Alice" });
  assert.equal(params[6], "Tool call: send_email");
  assert.equal(params[7], "Outbound email requires approval");
  assert.match(params[8], /^[0-9a-f]{64}$/);
});

test("scheduler charter enforcement: db helper fallbacks contain query failures", async () => {
  const pool = {
    async query() {
      throw new Error("db unavailable");
    }
  };

  const avgCost = await getAvgExecutionCost(pool, "wrk_1");
  const pause = await autoPauseWorker(pool, "wrk_1", "exec_1", ["boom"]);
  const approvalId = await createApprovalRecord(pool, {
    workerId: "wrk_1",
    tenantId: "ten_1",
    executionId: "exec_1",
    toolName: "send_email",
    toolArgs: { to: "alice@example.com" },
    action: "Tool call: send_email",
    matchedRule: "Outbound email requires approval"
  });

  assert.equal(avgCost, 0);
  assert.equal(pause.workerPaused, false);
  assert.equal(pause.executionMarked, false);
  assert.equal(approvalId, null);
});

test("scheduler charter enforcement: world-model predicate rejects unsafe regex patterns", () => {
  const result = evaluatePredicate({
    type: PREDICATE_TYPES.NOT_MATCHES_PATTERN,
    argPath: "to",
    pattern: "(a+)+$"
  }, {
    to: "alice@example.com"
  });

  assert.equal(result.passed, false);
  assert.match(result.reason, /not allowed/i);
});
