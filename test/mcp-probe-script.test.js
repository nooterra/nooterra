import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../scripts/mcp/probe.mjs";

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
