import fsSync from "node:fs";

function writeStderr(text) {
  fsSync.writeFileSync(2, Buffer.from(String(text ?? ""), "utf8"));
}

function usage() {
  writeStderr("usage: signer-stdio-stderr-only-exit1.mjs --stdio [--request-json-base64 <b64>]\n");
  process.exit(2);
}

function parse(argv) {
  let stdio = false;
  let requestJsonBase64 = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--stdio") {
      stdio = true;
      continue;
    }
    if (a === "--request-json-base64") {
      requestJsonBase64 = argv[i + 1] ?? null;
      if (!requestJsonBase64) usage();
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!stdio) usage();
  return { requestJsonBase64 };
}

async function main() {
  const { requestJsonBase64 } = parse(process.argv.slice(2));
  if (!requestJsonBase64) {
    process.exitCode = 1;
    writeStderr("unknown op\n");
    return;
  }
  process.exitCode = 1;
  writeStderr("simulated failure\n");
}

await main();

