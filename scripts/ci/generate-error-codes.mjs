import fs from "node:fs/promises";
import path from "node:path";

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      out.push(...(await walk(fp)));
    } else if (e.isFile() && fp.endsWith(".js")) out.push(fp);
  }
  return out;
}

function stableSortStrings(list) {
  return [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function extractErrorCodesFromJsSource(source) {
  const codes = new Set();
  const re = /\berror\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    codes.add(m[1]);
  }
  // CLI-specific "errors[]" code (not an `error:` field).
  if (source.includes('code: "FAIL_ON_WARNINGS"')) codes.add("FAIL_ON_WARNINGS");
  // Defensive fallback used by CLI when no `result.error` exists.
  if (source.includes('"FAILED"')) codes.add("FAILED");
  return codes;
}

async function main() {
  const repoRoot = process.cwd();
  const srcFiles = await walk(path.join(repoRoot, "packages", "artifact-verify", "src"));
  const cliFile = path.join(repoRoot, "packages", "artifact-verify", "bin", "nooterra-verify.js");
  const files = [...srcFiles, cliFile];

  const codes = new Set();
  for (const fp of files) {
    // eslint-disable-next-line no-await-in-loop
    const text = await fs.readFile(fp, "utf8");
    for (const c of extractErrorCodesFromJsSource(text)) codes.add(c);
  }

  const outPath = path.join(repoRoot, "docs", "spec", "error-codes.v1.txt");
  const lines = stableSortStrings(codes);
  await fs.writeFile(outPath, lines.join("\n") + "\n", "utf8");
}

await main();

