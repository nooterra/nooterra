import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyPublicApiFailure,
  parseArgs,
  parseRailwayProjectNames,
  parseRailwayWhoami,
  runRailwayPublicApiReadiness
} from "../scripts/ops/run-railway-public-api-readiness.mjs";

test("railway public api readiness parser: supports defaults and overrides", () => {
  const args = parseArgs(
    [
      "--base-url",
      "https://api.example.com/",
      "--expected-project",
      "example",
      "--expected-service",
      "example-api",
      "--out",
      "artifacts/custom.json"
    ],
    {},
    "/tmp/nooterra"
  );
  assert.equal(args.baseUrl, "https://api.example.com");
  assert.equal(args.expectedProject, "example");
  assert.equal(args.expectedService, "example-api");
  assert.equal(args.out, "/tmp/nooterra/artifacts/custom.json");
});

test("railway public api readiness parser: rejects unknown args", () => {
  assert.throws(() => parseArgs(["--wat"], {}, process.cwd()), /unknown argument/);
});

test("railway public api readiness: parses Railway whoami and project list output", () => {
  assert.deepEqual(parseRailwayWhoami("Logged in as aiden@example.com 👋"), {
    raw: "Logged in as aiden@example.com 👋",
    account: "aiden@example.com"
  });
  assert.deepEqual(parseRailwayProjectNames("\naiden's Projects\n  soothing-cooperation\n  nooterra-prod\n"), [
    "soothing-cooperation",
    "nooterra-prod"
  ]);
});

test("railway public api readiness: classifies Railway fallback explicitly", () => {
  assert.equal(
    classifyPublicApiFailure({
      statusCode: 404,
      json: { message: "Application not found" },
      text: "{\"message\":\"Application not found\"}"
    }),
    "APPLICATION_NOT_FOUND"
  );
  assert.equal(
    classifyPublicApiFailure({
      statusCode: 502,
      json: { message: "DNS_HOSTNAME_NOT_FOUND" },
      text: "DNS_HOSTNAME_NOT_FOUND"
    }),
    "DNS_HOSTNAME_NOT_FOUND"
  );
});

test("railway public api readiness: passes when Railway account and public API are healthy", async () => {
  const commands = [];
  const report = await runRailwayPublicApiReadiness(
    {
      baseUrl: "https://api.example.com",
      expectedProject: "nooterra",
      expectedService: "nooterra-api",
      out: "/tmp/report.json"
    },
    {
      runRailwayCommandFn: async (args) => {
        commands.push(args.join(" "));
        if (args[0] === "whoami") {
          return { ok: true, stdout: "Logged in as founder@example.com 👋\n", stderr: "" };
        }
        if (args[0] === "list") {
          return { ok: true, stdout: "founder's Projects\n  nooterra-prod\n", stderr: "" };
        }
        throw new Error(`unexpected command ${args.join(" ")}`);
      },
      requestJsonFn: async (url) => {
        if (url.endsWith("/healthz")) {
          return { ok: true, statusCode: 200, json: { ok: true }, text: "{\"ok\":true}" };
        }
        if (url.endsWith("/v1/public/auth-mode")) {
          return { ok: true, statusCode: 200, json: { authMode: "passwordless" }, text: "{\"authMode\":\"passwordless\"}" };
        }
        throw new Error(`unexpected url ${url}`);
      }
    }
  );
  assert.deepEqual(commands, ["whoami", "list"]);
  assert.equal(report.schemaVersion, "RailwayPublicApiReadinessReport.v1");
  assert.equal(report.verdict.ok, true);
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.checks.length, 4);
});

test("railway public api readiness: fails closed when project is missing and public domain is Railway fallback", async () => {
  const report = await runRailwayPublicApiReadiness(
    {
      baseUrl: "https://api.example.com",
      expectedProject: "nooterra",
      expectedService: "nooterra-api",
      out: "/tmp/report.json"
    },
    {
      runRailwayCommandFn: async (args) => {
        if (args[0] === "whoami") {
          return { ok: true, stdout: "Logged in as founder@example.com 👋\n", stderr: "" };
        }
        if (args[0] === "list") {
          return { ok: true, stdout: "founder's Projects\n  soothing-cooperation\n", stderr: "" };
        }
        throw new Error(`unexpected command ${args.join(" ")}`);
      },
      requestJsonFn: async () => ({
        ok: false,
        statusCode: 404,
        json: { status: "error", code: 404, message: "Application not found" },
        text: "{\"status\":\"error\",\"code\":404,\"message\":\"Application not found\"}",
        fetchError: null
      })
    }
  );
  assert.equal(report.verdict.ok, false);
  assert.equal(
    report.blockingIssues.some((issue) => issue.id === "RAILWAY_PROJECT_MISSING"),
    true
  );
  const authModeIssue = report.blockingIssues.find((issue) => issue.id === "PUBLIC_API_AUTH_MODE_UNAVAILABLE");
  assert.equal(authModeIssue.details.reasonCode, "APPLICATION_NOT_FOUND");
});
