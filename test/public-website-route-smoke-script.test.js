import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, runPublicWebsiteRouteSmoke } from "../scripts/ci/run-public-website-route-smoke.mjs";

test("public website route smoke: parses website base URL and default report path", () => {
  const args = parseArgs(["--website-base-url", "https://www.nooterra.ai/"], {}, "/tmp/nooterra-route-smoke");
  assert.equal(args.websiteBaseUrl, "https://www.nooterra.ai");
  assert.equal(
    args.out,
    "/tmp/nooterra-route-smoke/artifacts/gates/public-website-route-smoke.json"
  );
});

test("public website route smoke: reports success when all routes return branded HTML", async () => {
  const seenUrls = [];
  const report = await runPublicWebsiteRouteSmoke(
    {
      websiteBaseUrl: "https://www.nooterra.ai"
    },
    {
      requestPageFn: async (url) => {
        seenUrls.push(url);
        return {
          ok: true,
          statusCode: 200,
          contentType: "text/html; charset=utf-8",
          body: `<!DOCTYPE html><html><body>${url.includes("/docs/api") ? "The API is the runtime contract" : "Let AI act. Approve the action Action Wallet See exactly what happened Challenge what went wrong Set up your workspace Every route should help you move Get from zero to first governed action Architecture should explain what Nooterra governs should all resolve into the same approval Security should explain the boundaries Operations should make launch and failure boring Current posture for the launch surface Security for Nooterra means bounded authority Nooterra minimizes what it needs host-first Action Wallet Integrate trust in minutes. Choose your launch host. The approval window closed before the action could continue This authority was revoked before execution could continue The action completed, but the proof did not verify This host is outside the launch support envelope"}</body></html>`
        };
      }
    }
  );
  assert.equal(report.schemaVersion, "PublicWebsiteRouteSmoke.v1");
  assert.equal(report.ok, true);
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.checks.length, 23);
  assert.equal(seenUrls[0], "https://www.nooterra.ai/");
});

test("public website route smoke: fails closed when a route returns wrong content", async () => {
  const report = await runPublicWebsiteRouteSmoke(
    {
      websiteBaseUrl: "https://www.nooterra.ai"
    },
    {
      requestPageFn: async (url) => {
        if (url.endsWith("/status")) {
          return {
            ok: true,
            statusCode: 200,
            contentType: "text/html; charset=utf-8",
            body: "<!DOCTYPE html><html><body>generic shell</body></html>"
          };
        }
        return {
          ok: true,
          statusCode: 200,
          contentType: "text/html; charset=utf-8",
          body: "<!DOCTYPE html><html><body>Let AI act. Integrate trust in minutes. Choose your launch host. Action Wallet Approve the action See exactly what happened Challenge what went wrong Set up your workspace Every route should help you move Get from zero to first governed action Architecture should explain what Nooterra governs should all resolve into the same approval The API is the runtime contract Security should explain the boundaries Operations should make launch and failure boring Security for Nooterra means bounded authority Nooterra minimizes what it needs host-first Action Wallet The approval window closed before the action could continue This authority was revoked before execution could continue The action completed, but the proof did not verify This host is outside the launch support envelope</body></html>"
        };
      }
    }
  );
  assert.equal(report.ok, false);
  assert.equal(report.blockingIssues.length, 1);
  assert.equal(report.blockingIssues[0].path, "/status");
  assert.equal(report.blockingIssues[0].code, "PUBLIC_ROUTE_SMOKE_FAILED");
});
