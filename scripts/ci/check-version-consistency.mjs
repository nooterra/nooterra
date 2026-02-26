import fs from "node:fs";
import path from "node:path";

function readTrimmed(filePath) {
  return String(fs.readFileSync(filePath, "utf8")).trim();
}

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
}

const repoRoot = process.cwd();
const nooterraVersionPath = path.join(repoRoot, "NOOTERRA_VERSION");
const artifactVerifyPackagePath = path.join(repoRoot, "packages", "artifact-verify", "package.json");

if (!fs.existsSync(nooterraVersionPath)) {
  fail("version consistency check failed: NOOTERRA_VERSION file is missing");
}
if (!fs.existsSync(artifactVerifyPackagePath)) {
  fail("version consistency check failed: packages/artifact-verify/package.json is missing");
}

const repoVersion = readTrimmed(nooterraVersionPath);
const artifactVerifyPackage = JSON.parse(fs.readFileSync(artifactVerifyPackagePath, "utf8"));
const artifactVerifyVersion = String(artifactVerifyPackage.version ?? "").trim();

if (!repoVersion) {
  fail("version consistency check failed: NOOTERRA_VERSION is empty");
}
if (!artifactVerifyVersion) {
  fail("version consistency check failed: packages/artifact-verify/package.json version is empty");
}
if (repoVersion !== artifactVerifyVersion) {
  fail(
    `version consistency check failed: NOOTERRA_VERSION=${repoVersion} does not match packages/artifact-verify/package.json version=${artifactVerifyVersion}`
  );
}

// eslint-disable-next-line no-console
console.log(`version consistency check passed: ${repoVersion}`);
