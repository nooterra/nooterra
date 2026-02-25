import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReleaseNotesFromGates,
  parseArgs
} from "../scripts/release/build-release-notes-from-gates.mjs";

async function writeJson(pathname, value) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("build release notes parser: supports explicit args", () => {
  const cwd = "/tmp/settld";
  const args = parseArgs(
    [
      "--promotion-guard",
      "artifacts/gates/release-promotion-guard.json",
      "--required-checks",
      "artifacts/gates/production-cutover-required-checks.json",
      "--tag",
      "v0.3.1",
      "--version",
      "0.3.1",
      "--out",
      "artifacts/release/release-notes.md",
      "--json-out",
      "artifacts/release/release-notes-report.json"
    ],
    {},
    cwd
  );
  assert.equal(args.tag, "v0.3.1");
  assert.equal(args.version, "0.3.1");
  assert.equal(args.outPath, path.resolve(cwd, "artifacts/release/release-notes.md"));
  assert.equal(args.jsonOutPath, path.resolve(cwd, "artifacts/release/release-notes-report.json"));
});

test("build release notes: writes markdown with collaboration and lineage statuses", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "settld-release-notes-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const promotionPath = path.join(root, "artifacts", "gates", "release-promotion-guard.json");
  const requiredPath = path.join(root, "artifacts", "gates", "production-cutover-required-checks.json");
  const outPath = path.join(root, "artifacts", "release", "release-notes.md");
  const jsonOutPath = path.join(root, "artifacts", "release", "release-notes.json");

  await writeJson(promotionPath, {
    schemaVersion: "ReleasePromotionGuardReport.v1",
    verdict: { ok: true, status: "pass" }
  });
  await writeJson(requiredPath, {
    schemaVersion: "ProductionCutoverRequiredChecksAssertion.v1",
    ok: false,
    checks: [
      { id: "settld_verified_collaboration", ok: true, status: "passed" },
      { id: "openclaw_substrate_demo_lineage_verified", ok: false, status: "failed" },
      { id: "openclaw_substrate_demo_transcript_verified", ok: true, status: "passed" }
    ]
  });

  const report = await buildReleaseNotesFromGates({
    promotionGuardPath: promotionPath,
    requiredChecksPath: requiredPath,
    tag: "v0.3.1",
    version: "0.3.1",
    outPath,
    jsonOutPath
  });
  assert.equal(report.schemaVersion, "ReleaseNotesFromGates.v1");
  assert.equal(report.summary.promotionGuardStatus, "pass");
  assert.equal(report.summary.requiredChecksOk, false);
  assert.equal(report.summary.collaborationCheckOk, true);
  assert.equal(report.summary.lineageCheckOk, false);
  assert.equal(report.summary.transcriptCheckOk, true);

  const markdown = await fs.readFile(outPath, "utf8");
  assert.match(markdown, /Tag: `v0\.3\.1`/);
  assert.match(markdown, /Version: `0\.3\.1`/);
  assert.match(markdown, /Release promotion guard: \*\*pass\*\*/);
  assert.match(markdown, /settld_verified_collaboration: \*\*pass\*\*/);
  assert.match(markdown, /openclaw_substrate_demo_lineage_verified: \*\*fail\*\*/);
  assert.match(markdown, /openclaw_substrate_demo_transcript_verified: \*\*pass\*\*/);

  const json = JSON.parse(await fs.readFile(jsonOutPath, "utf8"));
  assert.equal(json.schemaVersion, "ReleaseNotesFromGates.v1");
});
