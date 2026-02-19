import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("demo: compositional settlement 3-hop prints lineage, decision hashes, payouts/refunds", () => {
  const run = spawnSync(process.execPath, ["scripts/demo/compositional-settlement-3hop.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const stdout = String(run.stdout ?? "");
  assert.match(stdout, /\[demo\] lineage:/);
  assert.match(stdout, /\[demo\] settle decisionHash=/);
  assert.match(stdout, /\[demo\] unwind decisionHash=/);
  assert.match(stdout, /\[demo\] final payouts cents=/);
  assert.match(stdout, /\[demo\] final refunds cents=/);
  assert.match(stdout, /PASS demo=compositional-settlement-3hop reportHash=[0-9a-f]{64}/);

  const jsonLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("REPORT_JSON:"));
  assert.ok(jsonLine, "missing REPORT_JSON line");
  const report = JSON.parse(jsonLine.slice("REPORT_JSON:".length));

  assert.equal(report.schemaVersion, "CompositionalSettlementDemo.v1");
  assert.deepEqual(report.lineage.settleParentAgreementHashes, [report.lineage.chain[1], report.lineage.chain[0]]);
  assert.deepEqual(report.lineage.unwindChildAgreementHashes, [report.lineage.chain[1], report.lineage.chain[2]]);
  assert.match(String(report.decisionHashes?.settle ?? ""), /^[0-9a-f]{64}$/);
  assert.match(String(report.decisionHashes?.unwind ?? ""), /^[0-9a-f]{64}$/);
  assert.match(String(report.receiptHashes?.settle ?? ""), /^[0-9a-f]{64}$/);
  assert.match(String(report.receiptHashes?.unwind ?? ""), /^[0-9a-f]{64}$/);
  assert.equal(report.verification?.settle, true);
  assert.equal(report.verification?.unwind, true);
  assert.deepEqual(report.finalPayouts, { agt_A: 300, agt_B: 1400, agt_C: 5600 });
  assert.deepEqual(report.finalRefunds, { agt_A: 900, agt_B: 900, agt_C: 900 });
});
