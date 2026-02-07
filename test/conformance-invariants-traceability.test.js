import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function parseInvariantsMd(text) {
  const inv = new Map(); // id -> { priority }
  const re = /^###\s+((?:INV|PROD|REL)-\d+)\s+\((P\d)\)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    inv.set(m[1], { priority: m[2] });
  }
  return inv;
}

test("conformance cases reference invariants (and all P0 invariants are covered)", () => {
  const invariantsMd = fs.readFileSync("docs/spec/INVARIANTS.md", "utf8");
  const invariants = parseInvariantsMd(invariantsMd);
  assert.ok(invariants.size > 0, "no invariants found in docs/spec/INVARIANTS.md");

  const covered = new Set();
  for (const casesPath of ["conformance/v1/cases.json", "conformance/v1/produce-cases.json", "conformance/v1/release-cases.json"]) {
    const casesDoc = JSON.parse(fs.readFileSync(casesPath, "utf8"));
    const schema = String(casesDoc?.schemaVersion ?? "");
    assert.ok(
      schema === "ConformanceCases.v1" || schema === "ProduceConformanceCases.v1" || schema === "ReleaseConformanceCases.v1",
      `${casesPath}: unexpected schemaVersion ${schema}`
    );
    assert.ok(Array.isArray(casesDoc.cases), `${casesPath}: missing cases[]`);

    for (const c of casesDoc.cases) {
      const id = String(c?.id ?? "");
      assert.ok(id, `${casesPath}: case missing id`);
      assert.ok(Array.isArray(c.invariantIds) && c.invariantIds.length > 0, `${casesPath}: case ${id} missing invariantIds[]`);
      for (const invId of c.invariantIds) {
        assert.ok(invariants.has(invId), `${casesPath}: case ${id} references unknown invariantId ${invId}`);
        covered.add(invId);
      }
    }
  }

  const p0 = [...invariants.entries()].filter(([, meta]) => meta.priority === "P0").map(([id]) => id);
  for (const invId of p0) {
    assert.ok(covered.has(invId), `P0 invariant ${invId} has no conformance coverage`);
  }
});
