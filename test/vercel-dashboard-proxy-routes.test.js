import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function loadJson(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(raw);
}

function assertProxyRewrite(config, source, destination) {
  assert.ok(Array.isArray(config.rewrites), "vercel config must define rewrites");
  assert.deepEqual(
    config.rewrites.find((entry) => entry.source === source),
    { source, destination }
  );
}

test("root vercel config proxies control-plane routes before the SPA fallback", async () => {
  const config = await loadJson("vercel.json");
  assertProxyRewrite(config, "/__magic/:match*", "https://api.nooterra.work/:match*");
  assertProxyRewrite(config, "/__nooterra/:match*", "https://api.nooterra.work/:match*");
  assertProxyRewrite(config, "/v1/:match*", "https://api.nooterra.work/v1/:match*");
  assert.deepEqual(config.rewrites.at(-1), {
    source: "/((?!(?:__magic|__nooterra|v1)(?:/|$))(?!.*\\.).*)",
    destination: "/index.html"
  });
});

test("dashboard vercel config proxies control-plane routes before the SPA fallback", async () => {
  const config = await loadJson("dashboard/vercel.json");
  assertProxyRewrite(config, "/__magic/:match*", "https://api.nooterra.work/:match*");
  assertProxyRewrite(config, "/__nooterra/:match*", "https://api.nooterra.work/:match*");
  assertProxyRewrite(config, "/v1/:match*", "https://api.nooterra.work/v1/:match*");
  assert.deepEqual(config.rewrites.at(-1), {
    source: "/((?!(?:__magic|__nooterra|v1)(?:/|$))(?!.*\\.).*)",
    destination: "/index.html"
  });
});
