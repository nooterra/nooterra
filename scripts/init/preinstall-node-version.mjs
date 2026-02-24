const ALLOWED_NODE_MAJORS = new Set([20, 22]);

function detectNodeMajor(version = process.versions?.node ?? "") {
  const match = String(version).match(/^(\d+)\./);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isSafeInteger(major) && major > 0 ? major : null;
}

const currentNodeVersion = String(process.versions?.node ?? "unknown");
const currentNodeMajor = detectNodeMajor(currentNodeVersion);
const allowUnsupportedNode = String(process.env.SETTLD_ALLOW_UNSUPPORTED_NODE ?? "").trim() === "1";

if (!allowUnsupportedNode && !ALLOWED_NODE_MAJORS.has(currentNodeMajor)) {
  process.stderr.write(
    [
      "[settld] error: Node.js 20.x or 22.x is required for deterministic local behavior.",
      `Current runtime: v${currentNodeVersion}`,
      "Fix:",
      "  nvm use",
      "  # or install/use Node.js 20.x or 22.x before running setup/tests",
      "",
      "Override (not recommended):",
      "  SETTLD_ALLOW_UNSUPPORTED_NODE=1 npm ci"
    ].join("\n") + "\n"
  );
  process.exit(1);
}
