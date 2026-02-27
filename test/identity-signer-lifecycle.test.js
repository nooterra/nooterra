import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateSignerLifecycleForContinuity,
  IDENTITY_SIGNER_LIFECYCLE_REASON_CODES
} from "../src/services/identity/signer-lifecycle.js";

test("identity lifecycle: fails closed for rotated and revoked statuses", () => {
  const rotated = evaluateSignerLifecycleForContinuity({
    signerKey: { keyId: "key_rotate_1", status: "rotated", rotatedAt: "2026-02-20T00:00:10.000Z" },
    at: "2026-02-20T00:00:20.000Z"
  });
  assert.equal(rotated.ok, false);
  assert.equal(rotated.code, IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_ROTATED);

  const revoked = evaluateSignerLifecycleForContinuity({
    signerKey: { keyId: "key_revoke_1", status: "revoked", revokedAt: "2026-02-20T00:00:10.000Z" },
    at: "2026-02-20T00:00:20.000Z"
  });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.code, IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_REVOKED);
});

test("identity lifecycle: enforces temporal windows deterministically", () => {
  const key = {
    keyId: "key_window_1",
    status: "active",
    validFrom: "2026-02-20T00:00:10.000Z",
    validTo: "2026-02-20T00:00:20.000Z"
  };

  const before = evaluateSignerLifecycleForContinuity({ signerKey: key, at: "2026-02-20T00:00:09.000Z" });
  assert.equal(before.ok, false);
  assert.equal(before.code, IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_YET_VALID);

  const within = evaluateSignerLifecycleForContinuity({ signerKey: key, at: "2026-02-20T00:00:15.000Z" });
  assert.equal(within.ok, true);

  const after = evaluateSignerLifecycleForContinuity({ signerKey: key, at: "2026-02-20T00:00:21.000Z" });
  assert.equal(after.ok, false);
  assert.equal(after.code, IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_EXPIRED);
});

test("identity lifecycle: missing registration is fail-closed when required", () => {
  const missing = evaluateSignerLifecycleForContinuity({
    signerKey: null,
    at: "2026-02-20T00:00:15.000Z",
    requireRegistered: true
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, IDENTITY_SIGNER_LIFECYCLE_REASON_CODES.SIGNER_KEY_NOT_REGISTERED);
});
