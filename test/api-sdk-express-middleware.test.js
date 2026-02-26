import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { verifyNooterraWebhook } from "../packages/api-sdk/src/index.js";

function sign(secret, timestamp, rawBody) {
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${timestamp}.`, "utf8");
  hmac.update(bodyBuffer);
  return hmac.digest("hex");
}

function createResponseCapture() {
  return {
    statusCode: null,
    jsonBody: null,
    textBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
    send(text) {
      this.textBody = text;
      return this;
    }
  };
}

function invokeMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (nextCalled) => {
      if (settled) return;
      settled = true;
      resolve({ nextCalled, res });
    };
    const next = (err) => {
      if (err) {
        if (!settled) {
          settled = true;
          reject(err);
        }
        return;
      }
      settle(true);
    };
    middleware(req, res, next);
    setTimeout(() => {
      settle(false);
    }, 25);
  });
}

function freshTimestamp() {
  return new Date().toISOString();
}

test("api-sdk express middleware: passes valid request with raw body", async () => {
  const secret = "whsec_mw_ok_1";
  const rawBody = Buffer.from("{\"event\":\"x402.escalation.created\"}", "utf8");
  const timestamp = freshTimestamp();
  const signature = sign(secret, timestamp, rawBody);
  const middleware = verifyNooterraWebhook(secret, { toleranceSeconds: 300 });
  const req = {
    rawBody,
    headers: {
      "x-nooterra-signature": signature,
      "x-nooterra-timestamp": timestamp
    }
  };
  const res = createResponseCapture();

  const result = await invokeMiddleware(middleware, req, res);
  assert.equal(result.nextCalled, true);
  assert.equal(res.statusCode, null);
});

test("api-sdk express middleware: rejects parsed object body with actionable 400", async () => {
  const middleware = verifyNooterraWebhook("whsec_mw_obj_1");
  const req = {
    body: { event: "x402.escalation.created" },
    headers: {
      "x-nooterra-signature": "bad"
    }
  };
  const res = createResponseCapture();

  const result = await invokeMiddleware(middleware, req, res);
  assert.equal(result.nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.jsonBody?.error?.code, "NOOTERRA_WEBHOOK_RAW_BODY_REQUIRED");
  assert.match(String(res.jsonBody?.error?.message || ""), /raw/i);
});

test("api-sdk express middleware: rejects bad signature with 401", async () => {
  const secret = "whsec_mw_bad_1";
  const rawBody = Buffer.from("{\"event\":\"x402.escalation.created\"}", "utf8");
  const timestamp = freshTimestamp();
  const middleware = verifyNooterraWebhook(secret, 300);
  const req = {
    rawBody,
    headers: {
      "x-nooterra-signature": sign("whsec_other", timestamp, rawBody),
      "x-nooterra-timestamp": timestamp
    }
  };
  const res = createResponseCapture();

  const result = await invokeMiddleware(middleware, req, res);
  assert.equal(result.nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.jsonBody?.error?.code, "NOOTERRA_WEBHOOK_SIGNATURE_NO_MATCH");
});

test("api-sdk express middleware: supports async secret resolver", async () => {
  const secret = "whsec_mw_async_1";
  const rawBody = Buffer.from("{\"event\":\"x402.escalation.created\"}", "utf8");
  const timestamp = freshTimestamp();
  const signature = sign(secret, timestamp, rawBody);
  const middleware = verifyNooterraWebhook(async () => secret, { toleranceSeconds: 300 });
  const req = {
    rawBody,
    headers: {
      "x-nooterra-signature": signature,
      "x-nooterra-timestamp": timestamp
    }
  };
  const res = createResponseCapture();

  const result = await invokeMiddleware(middleware, req, res);
  assert.equal(result.nextCalled, true);
  assert.equal(res.statusCode, null);
});

test("api-sdk express middleware: missing signature header maps to 400", async () => {
  const middleware = verifyNooterraWebhook("whsec_mw_missing_sig");
  const req = {
    rawBody: Buffer.from("{\"event\":\"x402.escalation.created\"}", "utf8"),
    headers: {
      "x-nooterra-timestamp": "2026-02-19T23:10:00.000Z"
    }
  };
  const res = createResponseCapture();

  const result = await invokeMiddleware(middleware, req, res);
  assert.equal(result.nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.jsonBody?.error?.code, "NOOTERRA_WEBHOOK_SIGNATURE_HEADER_INVALID");
});
