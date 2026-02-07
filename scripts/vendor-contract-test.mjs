import { runVendorContractTest } from "./vendor-contract-test-lib.mjs";

// `node --test` treats `**/*test*.mjs` as a test file. This script is a CLI,
// so bail out early when invoked without CLI flags.
if (!process.argv.includes("--bundle") && !process.argv.includes("--trust")) process.exit(0);

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    [
      "usage:",
      "  node scripts/vendor-contract-test.mjs --bundle <bundle.zip> --trust <trust.json> --expect strict-pass",
      "",
      "outputs:",
      "  deterministic JSON to stdout; exit code 0 on expectation match."
    ].join("\n")
  );
  process.exit(2);
}

function parse(argv) {
  const out = { bundlePath: null, trustPath: null, expect: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--bundle") {
      out.bundlePath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--trust") {
      out.trustPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--expect") {
      out.expect = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!out.bundlePath || !out.trustPath || !out.expect) usage();
  if (out.expect !== "strict-pass") usage();
  return out;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const out = await runVendorContractTest({ bundlePath: args.bundlePath, trustPath: args.trustPath, expect: args.expect });
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  process.exit(out.ok ? 0 : 1);
}

await main();
