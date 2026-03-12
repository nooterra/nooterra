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
  const allNeedlesBody = "<!DOCTYPE html><html><body>Give agents wallets, not unchecked permissions. /onboarding?experience=app&source=home#identity-access for every consequential agent action. /onboarding?experience=app&source=product#identity-access Free to build. /onboarding?experience=app&source=pricing#identity-access Add an Action Wallet in minutes. /onboarding?experience=app&source=developers#identity-access Connect where agents already run. /onboarding?experience=app&source=integrations#identity-access One wallet for every consequential AI action. Know exactly what you are approving. Every action should end in a readable record. If something goes wrong, there has to be a path back. Create the account. Documentation with the website as the index Start with one real action, not a giant setup ritual. Understand the control plane before you trust it. should all resolve into the same approval, receipt, and dispute surfaces. The API should feel like one product, not a bag of endpoints. Security should explain the boundaries, not just claim them. Operator pages should lead to runbooks, not leave you guessing. Every supported host should land on the same approval Design partners should get one disciplined onboarding pack A production claim should map to a concrete release bar When something goes wrong, the support path should already exist Live route health should be visible. Support should route users into the right trust surface fast Security for Nooterra means bounded authority The public site should explain the data boundary before people enter the product. host-first Action Wallet The approval window closed before the action could continue This authority was revoked before execution could continue The action completed, but the proof did not verify This host is outside the launch support envelope</body></html>";
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
          body: allNeedlesBody
        };
      }
    }
  );
  assert.equal(report.schemaVersion, "PublicWebsiteRouteSmoke.v1");
  assert.equal(report.ok, true);
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.checks.length, 32);
  assert.equal(seenUrls[0], "https://www.nooterra.ai/");
});

test("public website route smoke: fails closed when a route returns wrong content", async () => {
  const allNeedlesBody = "<!DOCTYPE html><html><body>Give agents wallets, not unchecked permissions. /onboarding?experience=app&source=home#identity-access for every consequential agent action. /onboarding?experience=app&source=product#identity-access Free to build. /onboarding?experience=app&source=pricing#identity-access Add an Action Wallet in minutes. /onboarding?experience=app&source=developers#identity-access Connect where agents already run. /onboarding?experience=app&source=integrations#identity-access One wallet for every consequential AI action. Know exactly what you are approving. Every action should end in a readable record. If something goes wrong, there has to be a path back. Create the account. Documentation with the website as the index Start with one real action, not a giant setup ritual. Understand the control plane before you trust it. should all resolve into the same approval, receipt, and dispute surfaces. The API should feel like one product, not a bag of endpoints. Security should explain the boundaries, not just claim them. Operator pages should lead to runbooks, not leave you guessing. Every supported host should land on the same approval Design partners should get one disciplined onboarding pack A production claim should map to a concrete release bar When something goes wrong, the support path should already exist Support should route users into the right trust surface fast Security for Nooterra means bounded authority The public site should explain the data boundary before people enter the product. host-first Action Wallet The approval window closed before the action could continue This authority was revoked before execution could continue The action completed, but the proof did not verify This host is outside the launch support envelope</body></html>";
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
          body: allNeedlesBody
        };
      }
    }
  );
  assert.equal(report.ok, false);
  assert.equal(report.blockingIssues.length, 1);
  assert.equal(report.blockingIssues[0].path, "/status");
  assert.equal(report.blockingIssues[0].code, "PUBLIC_ROUTE_SMOKE_FAILED");
  assert.deepEqual(report.blockingIssues[0].missingNeedles, ["Live route health should be visible."]);
});
