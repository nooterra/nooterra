import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const RELEASE_WORKFLOW_PATH = path.resolve(process.cwd(), ".github/workflows/release.yml");

async function readWorkflow() {
  return await fs.readFile(RELEASE_WORKFLOW_PATH, "utf8");
}

test("release workflow contract: asserts production cutover required checks in release_promotion_guard", async () => {
  const text = await readWorkflow();
  assert.match(text, /Assert production cutover required checks \(collaboration \+ lineage \+ transcript\)/);
  assert.match(text, /node scripts\/ci\/assert-production-cutover-required-checks\.mjs/);
  assert.match(text, /--in artifacts\/gates\/production-cutover-gate\.json/);
  assert.match(text, /--json-out artifacts\/gates\/production-cutover-required-checks\.json/);
});

test("release workflow contract: release artifacts include production cutover required checks report", async () => {
  const text = await readWorkflow();
  assert.match(text, /artifacts\/gates\/production-cutover-required-checks\.json/);
});

test("release workflow contract: release body path and notes generator are pinned", async () => {
  const text = await readWorkflow();
  assert.match(text, /node scripts\/release\/build-release-notes-from-gates\.mjs/);
  assert.match(text, /--promotion-guard \/tmp\/release-assets\/release-promotion-guard\.json/);
  assert.match(text, /--required-checks \/tmp\/release-assets\/production-cutover-required-checks\.json/);
  assert.match(text, /--out \/tmp\/release-notes\.md/);
  assert.match(text, /--json-out \/tmp\/release-notes\.json/);
  assert.match(text, /body_path: \/tmp\/release-notes\.md/);
});

test("release workflow contract: required release assets assert production cutover checks artifact", async () => {
  const text = await readWorkflow();
  assert.match(text, /test -f \/tmp\/release-assets\/production-cutover-required-checks\.json/);
});

test("release workflow contract: upload release notes artifact step is present", async () => {
  const text = await readWorkflow();
  assert.match(text, /name: Upload release notes artifact/);
  assert.match(text, /name: release-notes-\$\{\{ steps\.v\.outputs\.version \}\}/);
  assert.match(text, /\/tmp\/release-notes\.md/);
  assert.match(text, /\/tmp\/release-notes\.json/);
});
