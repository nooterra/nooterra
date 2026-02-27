import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function walkJs(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkJs(fp));
    else if (ent.isFile() && fp.endsWith(".js")) out.push(fp);
  }
  return out;
}

function stableSortStrings(list) {
  return [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function parseRegistryList(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

function extractErrorCodesFromJsSource(source) {
  const codes = new Set();
  const re = /\berror\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(source)) !== null) codes.add(m[1]);
  if (source.includes('code: "FAIL_ON_WARNINGS"')) codes.add("FAIL_ON_WARNINGS");
  if (source.includes('"FAILED"')) codes.add("FAILED");
  return codes;
}

function extractErrorCodesFromRepo() {
  const repoRoot = process.cwd();
  const srcDir = path.join(repoRoot, "packages", "artifact-verify", "src");
  const cli = path.join(repoRoot, "packages", "artifact-verify", "bin", "nooterra-verify.js");
  const files = [...walkJs(srcDir), cli];
  const out = new Set();
  for (const fp of files) {
    const text = fs.readFileSync(fp, "utf8");
    for (const c of extractErrorCodesFromJsSource(text)) out.add(c);
  }
  return stableSortStrings(out);
}

test("docs/spec/error-codes.v1.txt matches verifier error code set", () => {
  const expected = extractErrorCodesFromRepo();
  const doc = fs
    .readFileSync("docs/spec/error-codes.v1.txt", "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // No duplicates, stable ordering.
  const uniq = stableSortStrings(new Set(doc));
  assert.deepEqual(doc, uniq, "docs/spec/error-codes.v1.txt must be sorted and deduplicated");

  assert.deepEqual(doc, expected);
});

test("core fixture/conformance error codes are explained in docs/spec/ERRORS.md", () => {
  const errorsMd = fs.readFileSync("docs/spec/ERRORS.md", "utf8");

  const fixtureMatrix = JSON.parse(fs.readFileSync("test/fixtures/bundles/v1/fixtures.json", "utf8"));
  const fixtureCodes = new Set();
  for (const row of fixtureMatrix.fixtures ?? []) {
    const codes = row?.expected?.errorCodes ?? [];
    for (const c of Array.isArray(codes) ? codes : []) {
      if (typeof c === "string" && c.trim()) fixtureCodes.add(c.trim());
    }
  }

  const conformanceDir = "conformance/v1/expected";
  const conformanceCodes = new Set();
  for (const fn of fs.readdirSync(conformanceDir)) {
    if (!fn.endsWith(".json")) continue;
    const j = JSON.parse(fs.readFileSync(path.join(conformanceDir, fn), "utf8"));
    for (const c of Array.isArray(j.errorCodes) ? j.errorCodes : []) {
      if (typeof c === "string" && c.trim()) conformanceCodes.add(c.trim());
    }
  }

  const required = stableSortStrings(new Set([...fixtureCodes, ...conformanceCodes]));
  // Require "core" documentation coverage by exact backticked mention.
  const missing = required.filter((c) => !errorsMd.includes("`" + c + "`"));
  assert.deepEqual(missing, [], `docs/spec/ERRORS.md is missing core codes:\n${missing.join("\n")}`);
});

test("ns3 evidence-binding coverage matrix reason codes are registry-backed and documented", () => {
  const matrix = JSON.parse(fs.readFileSync("docs/kernel-compatible/ns3-evidence-binding-coverage-matrix.json", "utf8"));
  assert.equal(
    matrix?.schemaVersion,
    "NooterraNs3EvidenceBindingCoverageMatrix.v1",
    "ns3 coverage matrix schemaVersion must be NooterraNs3EvidenceBindingCoverageMatrix.v1"
  );

  const operations = Array.isArray(matrix?.operations) ? matrix.operations : [];
  assert.equal(operations.length > 0, true, "ns3 coverage matrix must include operations");

  const operationKeys = operations.map((row) => String(row?.operationKey ?? "").trim()).filter(Boolean);
  assert.deepEqual(
    operationKeys,
    stableSortStrings(new Set(operationKeys)),
    "ns3 coverage matrix operations must be sorted by operationKey and deduplicated"
  );

  const matrixCodes = new Set();
  for (const row of operations) {
    const required = Array.isArray(row?.evidenceExpectations?.requiredReasonCodes) ? row.evidenceExpectations.requiredReasonCodes : [];
    const mismatch = Array.isArray(row?.evidenceExpectations?.mismatchReasonCodes) ? row.evidenceExpectations.mismatchReasonCodes : [];
    for (const code of [...required, ...mismatch]) {
      const normalized = String(code ?? "").trim();
      if (normalized) matrixCodes.add(normalized);
    }
  }

  const matrixReasonCodes = stableSortStrings(matrixCodes);
  assert.deepEqual(
    Array.isArray(matrix?.reasonCodes) ? matrix.reasonCodes : [],
    matrixReasonCodes,
    "ns3 coverage matrix reasonCodes must exactly match operation expectations"
  );

  const x402Registry = new Set(parseRegistryList("docs/spec/x402-error-codes.v1.txt"));
  const unknown = matrixReasonCodes.filter((code) => !x402Registry.has(code));
  assert.deepEqual(unknown, [], `ns3 coverage matrix references unknown x402 reason codes:\n${unknown.join("\n")}`);

  const errorsMd = fs.readFileSync("docs/spec/ERRORS.md", "utf8");
  const undocumented = matrixReasonCodes.filter((code) => !errorsMd.includes("`" + code + "`"));
  assert.deepEqual(
    undocumented,
    [],
    `docs/spec/ERRORS.md is missing ns3 coverage matrix reason codes:\n${undocumented.join("\n")}`
  );
});
