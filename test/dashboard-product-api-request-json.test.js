import assert from "node:assert/strict";
import test from "node:test";

import { requestJson } from "../dashboard/src/product/api.js";

test("requestJson fails closed when a control-plane route returns HTML", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<!DOCTYPE html><html><body>spa shell</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });

  try {
    await assert.rejects(
      () =>
        requestJson({
          baseUrl: "/__magic",
          pathname: "/v1/public/auth-mode",
          method: "GET"
        }),
      (error) => {
        assert.equal(error.code, "CONTROL_PLANE_ROUTE_MISCONFIGURED");
        assert.equal(error.status, 200);
        assert.equal(error.details?.baseUrl, "/__magic");
        assert.equal(error.details?.pathname, "/v1/public/auth-mode");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestJson fails closed when a control-plane route returns non-JSON success text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });

  try {
    await assert.rejects(
      () =>
        requestJson({
          baseUrl: "https://api.nooterra.work",
          pathname: "/healthz",
          method: "GET"
        }),
      (error) => {
        assert.equal(error.code, "CONTROL_PLANE_RESPONSE_NOT_JSON");
        assert.equal(error.status, 200);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
