import test from "node:test";
import assert from "node:assert/strict";

import { CIRCLE_RESERVE_STATUS, createCircleReserveAdapter } from "../src/core/circle-reserve-adapter.js";

function readEnv(name, fallback = null) {
  const raw = process.env[name];
  if (raw === null || raw === undefined || String(raw).trim() === "") return fallback;
  return String(raw).trim();
}

function isEnabled(name) {
  const raw = readEnv(name, "");
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

test(
  "circle sandbox e2e: reserve then void via cancel/compensate path",
  { skip: !isEnabled("CIRCLE_E2E") },
  async (t) => {
    const required = ["CIRCLE_API_KEY", "CIRCLE_WALLET_ID_SPEND", "CIRCLE_WALLET_ID_ESCROW", "CIRCLE_TOKEN_ID_USDC"];
    const missing = required.filter((name) => !readEnv(name));
    if (missing.length > 0) {
      t.skip(`missing required env: ${missing.join(", ")}`);
      return;
    }

    const hasEntityProvider =
      Boolean(readEnv("CIRCLE_ENTITY_SECRET_CIPHERTEXT_TEMPLATE")) ||
      (Boolean(readEnv("CIRCLE_ENTITY_SECRET_CIPHERTEXT")) && isEnabled("CIRCLE_ALLOW_STATIC_ENTITY_SECRET"));
    if (!hasEntityProvider) {
      t.skip("set CIRCLE_ENTITY_SECRET_CIPHERTEXT_TEMPLATE or allow static ciphertext for sandbox e2e");
      return;
    }

    const amountCents = Number(readEnv("CIRCLE_E2E_AMOUNT_CENTS", "100"));
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new Error("CIRCLE_E2E_AMOUNT_CENTS must be a positive safe integer");
    }

    const adapter = createCircleReserveAdapter({
      mode: "sandbox",
      config: {
        apiKey: readEnv("CIRCLE_API_KEY"),
        baseUrl: readEnv("CIRCLE_BASE_URL", "https://api-sandbox.circle.com"),
        blockchain: readEnv("CIRCLE_BLOCKCHAIN", "BASE-SEPOLIA"),
        spendWalletId: readEnv("CIRCLE_WALLET_ID_SPEND"),
        escrowWalletId: readEnv("CIRCLE_WALLET_ID_ESCROW"),
        tokenId: readEnv("CIRCLE_TOKEN_ID_USDC"),
        spendAddress: readEnv("CIRCLE_SPEND_ADDRESS", null),
        escrowAddress: readEnv("CIRCLE_ESCROW_ADDRESS", null),
        entitySecretTemplate: readEnv("CIRCLE_ENTITY_SECRET_CIPHERTEXT_TEMPLATE", null),
        entitySecretCiphertext: readEnv("CIRCLE_ENTITY_SECRET_CIPHERTEXT", null),
        allowStaticEntitySecretCiphertext: isEnabled("CIRCLE_ALLOW_STATIC_ENTITY_SECRET")
      }
    });

    const gateId = `gate_circle_e2e_${Date.now().toString(36)}`;
    const reserved = await adapter.reserve({
      tenantId: readEnv("CIRCLE_E2E_TENANT_ID", "tenant_default"),
      gateId,
      amountCents,
      currency: readEnv("CIRCLE_E2E_CURRENCY", "USD"),
      idempotencyKey: gateId
    });
    assert.equal(reserved.status, CIRCLE_RESERVE_STATUS.RESERVED);
    assert.ok(typeof reserved.reserveId === "string" && reserved.reserveId.length > 0);

    if (isEnabled("CIRCLE_E2E_SKIP_VOID")) return;

    const voided = await adapter.void({
      reserveId: reserved.reserveId,
      amountCents,
      currency: readEnv("CIRCLE_E2E_CURRENCY", "USD"),
      idempotencyKey: `${gateId}:void`
    });
    assert.equal(voided.status, CIRCLE_RESERVE_STATUS.VOIDED);
    assert.ok(["cancel", "compensate", "already_terminal"].includes(String(voided.method ?? "")));
  }
);
