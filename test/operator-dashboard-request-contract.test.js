import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const OPERATOR_DASHBOARD_PATH = path.resolve(process.cwd(), "dashboard/src/operator/OperatorDashboard.jsx");

test("operator dashboard requestJson fails closed on HTML or non-JSON success responses", () => {
  const source = fs.readFileSync(OPERATOR_DASHBOARD_PATH, "utf8");

  assert.match(source, /looksLikeHtmlDocument/);
  assert.match(source, /CONTROL_PLANE_ROUTE_MISCONFIGURED/);
  assert.match(source, /CONTROL_PLANE_RESPONSE_NOT_JSON/);
  assert.match(source, /content-type/);
  assert.match(source, /control plane returned HTML instead of JSON/);
  assert.match(source, /control plane returned a non-JSON success response/);
});
