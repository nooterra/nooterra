import test from "node:test";
import assert from "node:assert/strict";

import { createStarterProfile } from "../src/core/profile-templates.js";
import { PROFILE_FINGERPRINT_SCHEMA_VERSION, computeProfileFingerprint } from "../src/core/profile-fingerprint.js";

test("profile fingerprint: deterministic sha256 for canonical profile payload", () => {
  const profile = createStarterProfile({ profileId: "engineering-spend" });
  const first = computeProfileFingerprint(profile);
  const second = computeProfileFingerprint(profile);

  assert.equal(first.schemaVersion, PROFILE_FINGERPRINT_SCHEMA_VERSION);
  assert.equal(first.profileId, "engineering-spend");
  assert.match(first.profileFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(first, second);
});
