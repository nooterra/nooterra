import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  SettldWebhookNoMatchingSignatureError,
  SettldWebhookSignatureHeaderError,
  SettldWebhookTimestampToleranceError,
  verifySettldWebhookSignature
} from "../packages/api-sdk/src/index.js";

function sign(secret, timestamp, rawBody) {
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${timestamp}.`, "utf8");
  hmac.update(bodyBuffer);
  return hmac.digest("hex");
}

test("api-sdk webhook verifier: verifies legacy signature header using external timestamp", () => {
  const secret = "whsec_test_legacy_1";
  const rawBody = Buffer.from("{\"artifactType\":\"X402EscalationLifecycle.v1\",\"ok\":true}", "utf8");
  const timestamp = "2026-02-19T22:00:00.000Z";
  const signature = sign(secret, timestamp, rawBody);

  const ok = verifySettldWebhookSignature(rawBody, signature, secret, {
    timestamp,
    toleranceSeconds: 300,
    nowMs: Date.parse("2026-02-19T22:04:30.000Z")
  });
  assert.equal(ok, true);
});

test("api-sdk webhook verifier: verifies multi-signature header with embedded timestamp", () => {
  const secret = "whsec_test_multi_1";
  const rawBody = "{\"event\":\"x402.escalation.created\"}";
  const timestamp = "2026-02-19T22:10:00.000Z";
  const good = sign(secret, timestamp, rawBody);
  const bad = sign("whsec_other", timestamp, rawBody);
  const signatureHeader = `t=${timestamp},v1=${bad},v1=${good}`;

  const ok = verifySettldWebhookSignature(rawBody, signatureHeader, secret, {
    toleranceSeconds: 300,
    nowMs: Date.parse("2026-02-19T22:10:05.000Z")
  });
  assert.equal(ok, true);
});

test("api-sdk webhook verifier: accepts ArrayBuffer raw body", () => {
  const secret = "whsec_test_ab_1";
  const rawBody = Buffer.from("{\"event\":\"x402.escalation.created\"}", "utf8");
  const timestamp = "2026-02-19T22:10:00.000Z";
  const signature = sign(secret, timestamp, rawBody);
  const arrayBufferBody = rawBody.buffer.slice(rawBody.byteOffset, rawBody.byteOffset + rawBody.byteLength);

  const ok = verifySettldWebhookSignature(arrayBufferBody, signature, secret, {
    timestamp,
    toleranceSeconds: 300,
    nowMs: Date.parse("2026-02-19T22:10:05.000Z")
  });
  assert.equal(ok, true);
});

test("api-sdk webhook verifier: rejects stale signatures outside tolerance", () => {
  const secret = "whsec_test_stale_1";
  const rawBody = "{\"event\":\"x402.escalation.created\"}";
  const timestamp = "2026-02-19T22:10:00.000Z";
  const signature = sign(secret, timestamp, rawBody);
  const signatureHeader = `t=${timestamp},v1=${signature}`;

  assert.throws(
    () =>
      verifySettldWebhookSignature(rawBody, signatureHeader, secret, {
        toleranceSeconds: 60,
        nowMs: Date.parse("2026-02-19T22:12:30.000Z")
      }),
    SettldWebhookTimestampToleranceError
  );
});

test("api-sdk webhook verifier: rejects unmatched signatures", () => {
  const secret = "whsec_test_nomatch_1";
  const rawBody = "{\"event\":\"x402.escalation.created\"}";
  const timestamp = "2026-02-19T22:10:00.000Z";
  const signatureHeader = `t=${timestamp},v1=${sign("whsec_other", timestamp, rawBody)}`;

  assert.throws(
    () =>
      verifySettldWebhookSignature(rawBody, signatureHeader, secret, {
        toleranceSeconds: 300,
        nowMs: Date.parse("2026-02-19T22:10:10.000Z")
      }),
    SettldWebhookNoMatchingSignatureError
  );
});

test("api-sdk webhook verifier: rejects missing timestamp when not provided externally", () => {
  const secret = "whsec_test_missing_ts_1";
  const rawBody = "{\"event\":\"x402.escalation.created\"}";
  const signatureHeader = sign(secret, "2026-02-19T22:10:00.000Z", rawBody);

  assert.throws(() => verifySettldWebhookSignature(rawBody, signatureHeader, secret, 300), SettldWebhookSignatureHeaderError);
});
