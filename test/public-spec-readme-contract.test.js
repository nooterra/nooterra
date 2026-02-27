import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const PUBLIC_SPEC_DIR = path.resolve(process.cwd(), "docs/spec/public");
const PUBLIC_SPEC_README_PATH = path.join(PUBLIC_SPEC_DIR, "README.md");

async function listPublicSpecFiles() {
  const entries = await fs.readdir(PUBLIC_SPEC_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".md"))
    .filter((name) => name !== "README.md")
    .sort((a, b) => a.localeCompare(b));
}

async function listedSpecsInReadme() {
  const text = await fs.readFile(PUBLIC_SPEC_README_PATH, "utf8");
  const lines = text.split(/\r?\n/);
  const specs = [];
  for (const line of lines) {
    const match = line.match(/^- `([^`]+\.md)`$/);
    if (!match) continue;
    specs.push(match[1]);
  }
  return Array.from(new Set(specs)).sort((a, b) => a.localeCompare(b));
}

test("public spec readme contract: README enumerates every published public spec markdown file", async () => {
  const files = await listPublicSpecFiles();
  const readmeList = await listedSpecsInReadme();
  assert.deepEqual(
    readmeList,
    files,
    [
      "docs/spec/public/README.md must list every public spec markdown file.",
      "Update the bullet list under 'Documents' when adding or removing specs."
    ].join(" ")
  );
});

