import test from "node:test";
import assert from "node:assert/strict";

import { buildNodeSentryOptions } from "../src/core/sentry-node.js";

test("buildNodeSentryOptions returns null without DSN", () => {
  assert.equal(buildNodeSentryOptions({ service: "api", env: {} }), null);
});

test("buildNodeSentryOptions returns deterministic defaults", () => {
  const options = buildNodeSentryOptions({
    service: "magic-link",
    env: {
      SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
      NODE_ENV: "production",
      NOOTERRA_VERSION: "0.2.8"
    }
  });
  assert.equal(options.dsn, "https://examplePublicKey@o0.ingest.sentry.io/0");
  assert.equal(options.environment, "production");
  assert.equal(options.release, "0.2.8");
  assert.equal(options.serverName, "magic-link");
  assert.equal(options.tracesSampleRate, 0);
  assert.equal(options.profilesSampleRate, 0);
  assert.deepEqual(options.initialScope.tags, { service: "magic-link", runtime: "node" });
});
