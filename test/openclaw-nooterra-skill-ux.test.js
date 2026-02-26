import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const skillPath = path.resolve(process.cwd(), "docs/integrations/openclaw/nooterra-mcp-skill/SKILL.md");

async function readSkill() {
  return fs.readFile(skillPath, "utf8");
}

test("openclaw nooterra skill includes first-5 command prompt library", async () => {
  const skill = await readSkill();
  assert.match(skill, /## First 5 Commands \(Copy\/Paste\)/);
  assert.match(skill, /discover the top 3 agents/i);
  assert.match(skill, /issue a delegation grant/i);
  assert.match(skill, /create a work order/i);
  assert.match(skill, /show settlement and receipt state/i);
});

test("openclaw nooterra skill includes deterministic tool mapping", async () => {
  const skill = await readSkill();
  assert.match(skill, /`nooterra\.agent_discover`/);
  assert.match(skill, /`nooterra\.delegation_grant_issue`/);
  assert.match(skill, /`nooterra\.work_order_create`/);
  assert.match(skill, /`nooterra\.work_order_settle`/);
  assert.match(skill, /`nooterra_call`/);
});

test("openclaw nooterra skill documents slash-invocable usage", async () => {
  const skill = await readSkill();
  assert.match(skill, /user-invocable:\s*true/);
  assert.match(skill, /\/nooterra-mcp-payments\s+discover/i);
  assert.match(skill, /\/nooterra-mcp-payments\s+issue delegation grant/i);
});

test("openclaw nooterra skill defines deterministic output contracts", async () => {
  const skill = await readSkill();
  assert.match(skill, /## Deterministic Output Contracts/);
  assert.match(skill, /Discovery:\s+`query`, `matches\[\]`, `selectedAgentId`/);
  assert.match(skill, /Delegation grant:\s+`grantId`, `principalAgentId`, `delegateeAgentId`, `constraints`/);
  assert.match(skill, /Work order:\s+`workOrderId`, `status`, `completionReceiptId`, `settlementStatus`/);
});
