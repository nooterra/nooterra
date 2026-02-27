import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

test("API: /openapi.json matches openapi/nooterra.openapi.json snapshot", async () => {
  const api = createApi();

  const res = await request(api, {
    method: "GET",
    path: "/openapi.json",
    headers: { "x-nooterra-protocol": "1.0" }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json?.openapi, "3.0.3");
  assert.ok(res.json?.paths?.["/jobs"]);
  assert.ok(res.json?.paths?.["/ops/party-statements"]);

  const snapshot = JSON.parse(fs.readFileSync("openapi/nooterra.openapi.json", "utf8"));

  // Avoid recursive deep-equality over a very large OpenAPI tree to keep memory bounded.
  const responseDigest = createHash("sha256").update(JSON.stringify(res.json)).digest("hex");
  const snapshotDigest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  assert.equal(responseDigest, snapshotDigest);
});

test("API: /public/agent-cards/discover visibility query contract is public-only", async () => {
  const api = createApi();
  const res = await request(api, {
    method: "GET",
    path: "/openapi.json",
    headers: { "x-nooterra-protocol": "1.0" }
  });
  assert.equal(res.statusCode, 200, res.body);
  const params = res.json?.paths?.["/public/agent-cards/discover"]?.get?.parameters ?? [];
  const visibilityParam = params.find((row) => row?.in === "query" && row?.name === "visibility");
  assert.ok(visibilityParam, "missing visibility query parameter for /public/agent-cards/discover");
  assert.deepEqual(visibilityParam?.schema?.enum ?? [], ["public"]);
});

test("API: /authority-grants OpenAPI contract includes authority grant query filters", async () => {
  const api = createApi();
  const res = await request(api, {
    method: "GET",
    path: "/openapi.json",
    headers: { "x-nooterra-protocol": "1.0" }
  });
  assert.equal(res.statusCode, 200, res.body);

  const operation = res.json?.paths?.["/authority-grants"]?.get ?? null;
  assert.ok(operation, "missing GET /authority-grants");
  const params = operation?.parameters ?? [];
  const queryNames = new Set(params.filter((row) => row?.in === "query").map((row) => row?.name));
  for (const name of ["grantId", "grantHash", "principalId", "granteeAgentId", "includeRevoked", "limit", "offset"]) {
    assert.equal(queryNames.has(name), true, `missing ${name} query parameter`);
  }
});
