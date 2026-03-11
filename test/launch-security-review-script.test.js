import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createLaunchSecurityReviewReport,
  main as runLaunchSecurityReview,
  parseArgs
} from "../scripts/ops/run-launch-security-review.mjs";

async function withTempRoot(files, fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "launch-security-review-"));
  try {
    await Promise.all(
      Object.entries(files).map(async ([relativePath, content]) => {
        const absolutePath = path.join(root, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, "utf8");
      })
    );
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const PASS_FIXTURES = {
  "services/magic-link/src/server.js": `
    const allowed = ["https://www.nooterra.ai", "https://nooterra.ai"];
    if (pathname === "/v1/public/auth-mode") {}
    const sameOrigin = "fetch(url,{credentials:'same-origin'})";
    const sameOriginPost = "fetch(url,{method:'POST',credentials:'same-origin'";
    const codes = ["APPROVAL_LINK_SESSION_MISMATCH", "APPROVAL_LINK_EXPIRED", "DECISION_ALREADY_RECORDED"];
  `,
  "test/api-onboarding-proxy.test.js": `
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://www.nooterra.ai");
  `,
  "test/magic-link-service.test.js": `
    assert.match(body, /different browser session/i);
    assert.equal(json.code, "APPROVAL_LINK_SESSION_MISMATCH");
    assert.equal(json.code, "APPROVAL_LINK_EXPIRED");
    assert.match(body, /read-only/i);
  `,
  "src/api/app.js": `
    throw new Error("approval decision actionSha256 does not match approval request action");
    throw new Error("approval request envelopeId does not match authority envelope");
    throw new Error("approval request actionSha256 does not match canonical action");
    throw new Error("approval request requestedBy does not match canonical requester");
    throw new Error("approval request already has a different decision");
  `,
  "vercel.json": `
    {"rewrites":[
      {"source": "/__magic/:match*"},
      {"source": "/__nooterra/:match*"},
      {"source": "/v1/:match*"},
      {"destination": "/index.html"}
    ]}
  `,
  "dashboard/vercel.json": `
    {"rewrites":[
      {"source": "/__magic/:match*"},
      {"source": "/__nooterra/:match*"},
      {"source": "/v1/:match*"},
      {"destination": "/index.html"}
    ]}
  `,
  "dashboard/src/product/api.js": `
    export const DEFAULT_PUBLIC_API_BASE_URL = "https://api.nooterra.work";
    const a = "/__nooterra";
    const b = "/__magic";
    throw new Error("control plane returned HTML instead of JSON");
    throw new Error("control plane returned a non-JSON success response");
  `,
  "test/dashboard-product-api-request-json.test.js": `
    headers: { "content-type": "text/html; charset=utf-8" };
    baseUrl: "/__magic";
    test("requestJson fails closed when a control-plane route returns non-JSON success text", async () => {});
  `
};

test("createLaunchSecurityReviewReport fails closed on missing evidence", () => {
  const report = createLaunchSecurityReviewReport({
    rootDir: "/tmp/nooterra",
    capturedAt: "2026-03-11T22:10:00.000Z",
    checks: [{ id: "approval_link_session_binding", title: "Approval links bind", ok: false, evidence: [], missing: [{ file: "/tmp/x", pattern: "foo" }] }]
  });
  assert.equal(report.schemaVersion, "LaunchSecurityReviewReport.v1");
  assert.equal(report.status, "fail");
  assert.equal(report.blockingIssues.length, 1);
});

test("CLI reports pass when launch security evidence is present", async () => {
  await withTempRoot(PASS_FIXTURES, async (root) => {
    const stdout = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      stdout.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    };
    try {
      await runLaunchSecurityReview(["--root", root, "--captured-at", "2026-03-11T22:15:00.000Z"]);
    } finally {
      process.stdout.write = originalWrite;
    }
    const report = JSON.parse(stdout.join(""));
    assert.equal(report.status, "pass");
    assert.equal(report.checks.length, 6);
  });
});

test("CLI fails closed when launch security evidence is missing", async () => {
  const failingFixtures = {
    ...PASS_FIXTURES,
    "services/magic-link/src/server.js": `const allowed = ["https://www.nooterra.ai"];`
  };
  await withTempRoot(failingFixtures, async (root) => {
    const stdout = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      stdout.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    };
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await runLaunchSecurityReview(["--root", root]);
      assert.equal(process.exitCode, 1);
    } finally {
      process.stdout.write = originalWrite;
      process.exitCode = previousExitCode;
    }
    const report = JSON.parse(stdout.join(""));
    assert.equal(report.status, "fail");
    assert.ok(report.blockingIssues.length >= 1);
  });
});

test("parseArgs rejects unknown arguments", () => {
  assert.throws(() => parseArgs(["--wat"]), /Unknown argument/);
});
