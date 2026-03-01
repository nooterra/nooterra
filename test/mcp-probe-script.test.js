import assert from "node:assert/strict";
import test from "node:test";

import { detectToolCallFailure, parseArgs } from "../scripts/mcp/probe.mjs";

test("mcp probe parser: defaults include empty required tool list", () => {
  const args = parseArgs([]);
  assert.equal(Array.isArray(args.requireTools), true);
  assert.equal(args.requireTools.length, 0);
  assert.equal(args.x402Smoke, false);
  assert.equal(args.interactionGraphSmoke, false);
});

test("mcp probe parser: supports --require-tool and dedupes", () => {
  const args = parseArgs([
    "--require-tool",
    "nooterra.agent_discover",
    "--require-tool=nooterra.interaction_graph_pack_get",
    "--require-tool",
    "nooterra.agent_discover"
  ]);
  assert.deepEqual(args.requireTools, ["nooterra.agent_discover", "nooterra.interaction_graph_pack_get"]);
});

test("mcp probe parser: supports expected tool result mode", () => {
  const errorMode = parseArgs(["--expect-tool-error"]);
  assert.equal(errorMode.expectToolResult, "error");
  const successMode = parseArgs(["--expect-tool-success"]);
  assert.equal(successMode.expectToolResult, "success");
});

test("mcp probe parser: supports interaction graph smoke flags", () => {
  const inline = parseArgs(["--interaction-graph-smoke"]);
  assert.equal(inline.interactionGraphSmoke, true);
  assert.equal(inline.interactionGraphSmokeFile, null);
  const fromFile = parseArgs(["--interaction-graph-smoke-file", "tmp/smoke.json"]);
  assert.equal(fromFile.interactionGraphSmoke, true);
  assert.equal(fromFile.interactionGraphSmokeFile, "tmp/smoke.json");
});

test("mcp probe parser: fails closed on missing require-tool value", () => {
  assert.throws(() => parseArgs(["--require-tool", ""]), /--require-tool requires a non-empty tool name/i);
  assert.throws(() => parseArgs(["--require-tool="]), /--require-tool requires a non-empty tool name/i);
});

test("mcp probe error detection: treats nested tool result errors as failures", () => {
  const callResponse = {
    result: {
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            tool: "nooterra.submit_evidence",
            durationMs: 11,
            result: { ok: false, error: "event rejected", code: "EVENT_REJECTED" }
          })
        }
      ]
    }
  };
  const detected = detectToolCallFailure(callResponse, "nooterra.submit_evidence");
  assert.equal(Boolean(detected), true);
  assert.match(String(detected?.message ?? ""), /event rejected/i);
});

test("mcp probe error detection: passes through successful result payloads", () => {
  const callResponse = {
    result: {
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            tool: "nooterra.submit_evidence",
            durationMs: 8,
            result: { ok: true, event: { id: "evt_1" } }
          })
        }
      ]
    }
  };
  const detected = detectToolCallFailure(callResponse, "nooterra.submit_evidence");
  assert.equal(detected, null);
});
