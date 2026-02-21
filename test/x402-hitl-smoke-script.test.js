import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "../scripts/ops/run-x402-hitl-smoke.mjs";

test("x402 hitl smoke parser: uses env defaults and accepts api key without ops token", () => {
  const args = parseArgs([], {
    SETTLD_BASE_URL: "http://127.0.0.1:3999",
    SETTLD_TENANT_ID: "tenant_ops_test",
    SETTLD_PROTOCOL: "1.0",
    SETTLD_API_KEY: "kid.secret"
  });
  assert.equal(args.baseUrl, "http://127.0.0.1:3999");
  assert.equal(args.tenantId, "tenant_ops_test");
  assert.equal(args.protocol, "1.0");
  assert.equal(args.apiKey, "kid.secret");
  assert.equal(args.opsToken, null);
  assert.equal(args.outPath, "artifacts/ops/x402-hitl-smoke.json");
});

test("x402 hitl smoke parser: accepts ops token path when api key is omitted", () => {
  const args = parseArgs(["--ops-token", "tok_ops"], {});
  assert.equal(args.apiKey, null);
  assert.equal(args.opsToken, "tok_ops");
});

test("x402 hitl smoke parser: rejects unknown arguments", () => {
  assert.throws(() => parseArgs(["--not-a-flag"]), /unknown argument/);
});

test("x402 hitl smoke parser: requires api key or ops token", () => {
  assert.throws(
    () =>
      parseArgs([], {
        SETTLD_BASE_URL: "http://127.0.0.1:3000",
        SETTLD_TENANT_ID: "tenant_default",
        SETTLD_PROTOCOL: "1.0"
      }),
    /provide --api-key or --ops-token/
  );
});
