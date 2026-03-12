import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PRODUCT_SHELL_PATH = path.resolve(process.cwd(), "dashboard/src/product/ProductShell.jsx");

test("requestAuthJson stays pinned to auth-plane base URLs", () => {
  const source = fs.readFileSync(PRODUCT_SHELL_PATH, "utf8");
  const requestAuthJsonSection = source.slice(
    source.indexOf("async function requestAuthJson"),
    source.indexOf("useEffect(() => {", source.indexOf("async function requestAuthJson"))
  );

  assert.match(requestAuthJsonSection, /DEFAULT_AUTH_BASE_URL/);
  assert.match(requestAuthJsonSection, /managedWebsiteFallbacks = shouldUseManagedPublicApiFallback\(DEFAULT_AUTH_BASE_URL\)/);
  assert.doesNotMatch(requestAuthJsonSection, /runtimeApiBaseUrl/);
  assert.doesNotMatch(requestAuthJsonSection, /DEFAULT_PUBLIC_API_BASE_URL_CANDIDATES/);
  assert.doesNotMatch(requestAuthJsonSection, /\/__nooterra/);
});
