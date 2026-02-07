import { execFileSync } from "node:child_process";
import fs from "node:fs";

function loadV1FreezeFiles() {
  try {
    const raw = fs.readFileSync("test/fixtures/protocol-v1-freeze.json", "utf8");
    const json = JSON.parse(raw);
    const files = json?.files && typeof json.files === "object" && !Array.isArray(json.files) ? Object.keys(json.files) : [];
    return new Set(files);
  } catch {
    return new Set();
  }
}

const V1_FROZEN_FILES = loadV1FreezeFiles();

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage: node scripts/ci/changelog-guard.mjs --base <sha> --head <sha>");
  process.exit(2);
}

function parseArgs(argv) {
  let base = null;
  let head = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--base") {
      base = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--head") {
      head = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!base || !head) usage();
  return { base, head };
}

function changedFiles(base, head) {
  const out = execFileSync("git", ["diff", "--name-only", `${base}..${head}`], { encoding: "utf8" });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function commitMessages(base, head) {
  try {
    const out = execFileSync("git", ["log", "--format=%B", `${base}..${head}`], { encoding: "utf8" });
    return String(out ?? "");
  } catch {
    return "";
  }
}

function readLabelsFromGithubEvent() {
  try {
    const p = process.env.GITHUB_EVENT_PATH ?? null;
    if (!p || !fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf8");
    const json = JSON.parse(raw);
    const labels = json?.pull_request?.labels ?? [];
    if (!Array.isArray(labels)) return [];
    return labels.map((l) => String(l?.name ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

function readPrBodyFromGithubEvent() {
  try {
    const p = process.env.GITHUB_EVENT_PATH ?? null;
    if (!p || !fs.existsSync(p)) return "";
    const raw = fs.readFileSync(p, "utf8");
    const json = JSON.parse(raw);
    return String(json?.pull_request?.body ?? "");
  } catch {
    return "";
  }
}

function matchesProtocolSurface(fp) {
  const prefixes = [
    "docs/spec/",
    "scripts/spec/",
    "test/fixtures/protocol-vectors/",
    "test/fixtures/bundles/"
  ];
  return prefixes.some((p) => fp.startsWith(p));
}

function isV1FrozenSurface(fp) {
  return V1_FROZEN_FILES.has(fp);
}

function hasProtocolChangeMarker(text) {
  const t = String(text ?? "").toLowerCase();
  return t.includes("[protocol-change]") || t.includes("protocol-change:");
}

const { base, head } = parseArgs(process.argv.slice(2));
const files = changedFiles(base, head);
const touchedChangelog = files.includes("CHANGELOG.md");
const protocolSurfaceChanged = files.some(matchesProtocolSurface);
const v1FrozenChanged = files.some(isV1FrozenSurface);
const labels = readLabelsFromGithubEvent();
const hasReleaseNoteLabel = labels.includes("release-note");

if (!touchedChangelog && (protocolSurfaceChanged || hasReleaseNoteLabel)) {
  // eslint-disable-next-line no-console
  console.error("CHANGELOG.md must be updated for this PR.");
  // eslint-disable-next-line no-console
  if (protocolSurfaceChanged) console.error("- Reason: protocol surface files changed (docs/spec, schemas, vectors, or fixtures).");
  // eslint-disable-next-line no-console
  if (hasReleaseNoteLabel) console.error("- Reason: PR is labeled release-note.");
  process.exit(1);
}

if (v1FrozenChanged && process.env.ALLOW_PROTOCOL_V1_MUTATION !== "1") {
  const markerText = `${readPrBodyFromGithubEvent()}\n${commitMessages(base, head)}`;
  const hasMarker = hasProtocolChangeMarker(markerText);
  if (!hasMarker || !touchedChangelog) {
    // eslint-disable-next-line no-console
    console.error("Protocol v1 freeze gate: v1 schemas/vectors changed.");
    // eslint-disable-next-line no-console
    console.error("- This requires (1) CHANGELOG.md update and (2) an explicit protocol-change marker in the PR body or commit message.");
    // eslint-disable-next-line no-console
    console.error("- Marker examples: [protocol-change] or protocol-change:");
    // eslint-disable-next-line no-console
    console.error("- Override (local only): ALLOW_PROTOCOL_V1_MUTATION=1");
    // eslint-disable-next-line no-console
    console.error("Changed frozen files:");
    for (const fp of files.filter(isV1FrozenSurface)) {
      // eslint-disable-next-line no-console
      console.error(`- ${fp}`);
    }
    process.exit(1);
  }
}
