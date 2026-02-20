# settld-api-sdk

Node/TypeScript SDK for Settld API + x402 helpers.

## Webhook Signature Verification

Use `verifySettldWebhookSignature` to verify incoming `x-settld-signature` headers with:

- multi-signature support (`v1=...` list, including rotation windows),
- constant-time comparison (`crypto.timingSafeEqual`),
- timestamp tolerance checks (replay protection).

```js
import express from "express";
import { verifySettldWebhookSignature } from "settld-api-sdk";

const app = express();

// IMPORTANT: keep the raw body; do not JSON-parse before verification.
app.post("/webhooks/settld", express.raw({ type: "application/json" }), (req, res) => {
  const signatureHeader = req.get("x-settld-signature") ?? "";
  const timestamp = req.get("x-settld-timestamp"); // required for current Settld delivery format
  const secret = process.env.SETTLD_WEBHOOK_SECRET;

  verifySettldWebhookSignature(req.body, signatureHeader, secret, {
    timestamp,
    toleranceSeconds: 300
  });

  const event = JSON.parse(req.body.toString("utf8"));
  // handle event...
  res.status(200).json({ ok: true });
});
```

The verifier also supports signature headers that embed timestamp directly:

`x-settld-signature: t=1708380000,v1=<sig-new>,v1=<sig-old>`

## Express Middleware Helper

Use `verifySettldWebhook` to verify signatures in an Express-style middleware.

```js
import express from "express";
import { verifySettldWebhook } from "settld-api-sdk";

const app = express();
const secret = process.env.SETTLD_WEBHOOK_SECRET;

// IMPORTANT: preserve raw body bytes before JSON parsing mutates payload shape.
app.use(
  express.json({
    verify(req, _res, buf) {
      req.rawBody = buf;
    }
  })
);

app.post(
  "/webhooks/settld",
  verifySettldWebhook(secret, { toleranceSeconds: 300 }),
  (req, res) => {
    const event = req.body;
    // handle event...
    res.status(200).json({ ok: true });
  }
);
```

If `req.rawBody` is missing (or `req.body` is already parsed into a plain object), the middleware returns `400` with a raw-body guidance message.
