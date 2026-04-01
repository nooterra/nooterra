import test from "node:test";
import assert from "node:assert/strict";
import { META_AGENT_CHARTER, isMetaAgent, getMetaAgentTools } from "../services/runtime/meta-agent.ts";

test("META_AGENT_CHARTER: has immutable neverDo rules", () => {
  assert.ok(META_AGENT_CHARTER.neverDo.includes("Modify own charter or permissions"));
  assert.ok(META_AGENT_CHARTER.neverDo.includes("Delete workers permanently"));
  assert.ok(META_AGENT_CHARTER.neverDo.includes("Bypass approval requirements"));
});

test("META_AGENT_CHARTER: has required canDo and askFirst rules", () => {
  assert.ok(META_AGENT_CHARTER.canDo.length > 0);
  assert.ok(META_AGENT_CHARTER.askFirst.length > 0);
  assert.ok(META_AGENT_CHARTER.askFirst.includes("Pause underperforming workers"));
});

test("isMetaAgent: identifies meta-agent by charter role", () => {
  assert.equal(isMetaAgent({ charter: { role: "Nooterra Fleet Manager" } }), true);
  assert.equal(isMetaAgent({ charter: { role: "Other Agent" } }), false);
  assert.equal(isMetaAgent({ charter: {} }), false);
  assert.equal(isMetaAgent({}), false);
});

test("getMetaAgentTools: returns 6 management tools", () => {
  const tools = getMetaAgentTools(null, "ten_1");
  assert.equal(tools.length, 6);
  const names = tools.map(t => t.function.name);
  assert.ok(names.includes("__read_fleet_digest"));
  assert.ok(names.includes("__create_worker"));
  assert.ok(names.includes("__pause_worker"));
  assert.ok(names.includes("__emit_alert"));
  assert.ok(names.includes("__read_worker_stats"));
  assert.ok(names.includes("__generate_proposals"));
});

test("getMetaAgentTools: all tools have descriptions and parameter schemas", () => {
  const tools = getMetaAgentTools(null, "ten_1");
  for (const tool of tools) {
    assert.ok(tool.type === "function");
    assert.ok(tool.function.name.startsWith("__"));
    assert.ok(typeof tool.function.description === "string");
    assert.ok(tool.function.parameters !== undefined);
  }
});
