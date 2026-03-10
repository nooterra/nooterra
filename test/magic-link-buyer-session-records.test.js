import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createBuyerSessionRecord,
  getBuyerSessionRecord,
  listBuyerSessionRecords,
  markBuyerSessionStepUp,
  revokeBuyerSessionRecord,
  touchBuyerSessionRecord
} from "../services/magic-link/src/buyer-session-records.js";

test("buyer session records: create, list, touch, and revoke sessions deterministically", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-buyer-sessions-"));
  try {
    const created = await createBuyerSessionRecord({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com",
      sessionId: "sess_primary",
      issuedAt: "2026-03-09T00:00:00.000Z",
      expiresAt: "2026-03-10T00:00:00.000Z",
      userAgent: "Mozilla/5.0 Test Device"
    });
    assert.equal(created.ok, true);

    const touched = await touchBuyerSessionRecord({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com",
      sessionId: "sess_primary",
      at: "2026-03-09T01:00:00.000Z"
    });
    assert.equal(touched.ok, true);
    assert.equal(touched.session?.lastSeenAt, "2026-03-09T01:00:00.000Z");

    const fetched = await getBuyerSessionRecord({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com",
      sessionId: "sess_primary"
    });
    assert.equal(fetched?.sessionId, "sess_primary");
    assert.equal(fetched?.userAgent, "Mozilla/5.0 Test Device");
    assert.equal(fetched?.stepUpAt, null);

    const steppedUp = await markBuyerSessionStepUp({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com",
      sessionId: "sess_primary",
      at: "2026-03-09T01:05:00.000Z",
      method: "passkey"
    });
    assert.equal(steppedUp.ok, true);
    assert.equal(steppedUp.session?.stepUpAt, "2026-03-09T01:05:00.000Z");
    assert.equal(steppedUp.session?.stepUpMethod, "passkey");

    const listed = await listBuyerSessionRecords({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com"
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].stepUpMethod, "passkey");

    const revoked = await revokeBuyerSessionRecord({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com",
      sessionId: "sess_primary",
      reason: "USER_LOGOUT"
    });
    assert.equal(revoked.ok, true);
    assert.equal(revoked.session?.revokedReason, "USER_LOGOUT");

    const active = await listBuyerSessionRecords({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com"
    });
    assert.equal(active.length, 0);

    const all = await listBuyerSessionRecords({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com",
      includeRevoked: true
    });
    assert.equal(all.length, 1);
    assert.ok(typeof all[0].revokedAt === "string" && all[0].revokedAt.length > 0);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
