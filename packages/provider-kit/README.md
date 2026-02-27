# @nooterra/provider-kit

Provider middleware for paid tool endpoints using NooterraPay.

## What it provides

- `HTTP 402` challenge flow with both `x-payment-required` and `PAYMENT-REQUIRED`
- Offline NooterraPay verification (`Authorization: NooterraPay <token>`)
- Cached `/.well-known/nooterra-keys.json` resolution with pinned-key fallback
- Provider-signed quote challenges on `402` (`x-nooterra-provider-quote*` headers)
- Provider response signing (`x-nooterra-provider-*` headers)
- Replay dedupe keyed by `authorizationRef` (fallback `gateId`)

## Minimal usage

```js
import http from "node:http";
import { createNooterraPaidNodeHttpHandler } from "@nooterra/provider-kit";

const paidHandler = createNooterraPaidNodeHttpHandler({
  providerId: "prov_exa_mock",
  providerPublicKeyPem: process.env.PROVIDER_PUBLIC_KEY_PEM,
  providerPrivateKeyPem: process.env.PROVIDER_PRIVATE_KEY_PEM,
  priceFor: ({ req, url }) => ({
    amountCents: 500,
    currency: "USD",
    providerId: "prov_exa_mock",
    toolId: `${req.method}:${url.pathname}`
  }),
  nooterraPay: {
    keysetUrl: "http://127.0.0.1:3000/.well-known/nooterra-keys.json"
  },
  execute: async ({ url }) => ({
    body: {
      ok: true,
      query: url.searchParams.get("q") ?? ""
    }
  })
});

const server = http.createServer((req, res) => paidHandler(req, res));
server.listen(9402);
```

## Exports

- `createNooterraPaidNodeHttpHandler(options)`
- `createNooterraPayKeysetResolver(options)`
- `createInMemoryReplayStore(options)`
- `parseNooterraPayAuthorizationHeader(header)`
- `buildPaymentRequiredHeaderValue(offer)`
