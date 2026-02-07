import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { PRODUCE_ERROR_CODES_V1 } from "../packages/artifact-produce/src/cli/produce-error-codes.js";

function stableSortStrings(list) {
  return [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

test("docs/spec/producer-error-codes.v1.txt matches producer error code set", () => {
  const doc = fs
    .readFileSync("docs/spec/producer-error-codes.v1.txt", "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const uniq = stableSortStrings(new Set(doc));
  assert.deepEqual(doc, uniq, "docs/spec/producer-error-codes.v1.txt must be sorted and deduplicated");

  assert.deepEqual(doc, PRODUCE_ERROR_CODES_V1);
});

test("docs/spec/PRODUCER_ERRORS.md mentions all producer codes", () => {
  const md = fs.readFileSync("docs/spec/PRODUCER_ERRORS.md", "utf8");
  const missing = PRODUCE_ERROR_CODES_V1.filter((c) => !md.includes("`" + c + "`"));
  assert.deepEqual(missing, [], `docs/spec/PRODUCER_ERRORS.md missing codes:\n${missing.join("\n")}`);
});

