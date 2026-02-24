import test from "node:test";
import assert from "node:assert/strict";

import { createEd25519Keypair } from "../src/core/crypto.js";
import { signListingBondV1, verifyListingBondV1 } from "../src/core/listing-bond.js";

test("listing bond: sign + verify succeeds for matching bindings", () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const bond = signListingBondV1({
    bond: {
      bondId: "bond_test_1",
      tenantId: "tenant_default",
      agentId: "agt_test_1",
      purpose: "agent_card_public_listing",
      amountCents: 250,
      currency: "USD",
      issuedAt: "2026-02-24T00:00:00.000Z",
      exp: "2099-01-01T00:00:00.000Z"
    },
    signedAt: "2026-02-24T00:00:00.000Z",
    publicKeyPem,
    privateKeyPem
  });

  const verified = verifyListingBondV1({
    bond,
    publicKeyPem,
    nowAt: "2026-02-24T00:00:01.000Z",
    expectedTenantId: "tenant_default",
    expectedAgentId: "agt_test_1",
    expectedPurpose: "agent_card_public_listing",
    expectedCurrency: "USD",
    minAmountCents: 250
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.code, null);
  assert.equal(verified.payload?.bondId, "bond_test_1");
});

test("listing bond: tampered payload fails verification", () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const bond = signListingBondV1({
    bond: {
      bondId: "bond_test_2",
      tenantId: "tenant_default",
      agentId: "agt_test_2",
      purpose: "agent_card_public_listing",
      amountCents: 250,
      currency: "USD",
      issuedAt: "2026-02-24T00:00:00.000Z",
      exp: "2099-01-01T00:00:00.000Z"
    },
    signedAt: "2026-02-24T00:00:00.000Z",
    publicKeyPem,
    privateKeyPem
  });
  bond.amountCents = 500;
  const verified = verifyListingBondV1({
    bond,
    publicKeyPem,
    nowAt: "2026-02-24T00:00:01.000Z"
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, "LISTING_BOND_PAYLOAD_HASH_MISMATCH");
});

test("listing bond: expired bond is rejected", () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const bond = signListingBondV1({
    bond: {
      bondId: "bond_test_3",
      tenantId: "tenant_default",
      agentId: "agt_test_3",
      purpose: "agent_card_public_listing",
      amountCents: 250,
      currency: "USD",
      issuedAt: "2026-02-24T00:00:00.000Z",
      exp: "2026-02-24T00:00:00.000Z"
    },
    signedAt: "2026-02-24T00:00:00.000Z",
    publicKeyPem,
    privateKeyPem
  });
  const verified = verifyListingBondV1({
    bond,
    publicKeyPem,
    nowAt: "2026-02-24T00:00:01.000Z"
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, "LISTING_BOND_EXPIRED");
});

test("listing bond: denial code is stable across repeated verification", () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const bond = signListingBondV1({
    bond: {
      bondId: "bond_test_4",
      tenantId: "tenant_default",
      agentId: "agt_test_4",
      purpose: "agent_card_public_listing",
      amountCents: 250,
      currency: "USD",
      issuedAt: "2026-02-24T00:00:00.000Z",
      exp: "2099-01-01T00:00:00.000Z"
    },
    signedAt: "2026-02-24T00:00:00.000Z",
    publicKeyPem,
    privateKeyPem
  });
  const first = verifyListingBondV1({
    bond,
    publicKeyPem,
    nowAt: "2026-02-24T00:00:01.000Z",
    expectedTenantId: "tenant_other"
  });
  const second = verifyListingBondV1({
    bond,
    publicKeyPem,
    nowAt: "2026-02-24T00:00:01.000Z",
    expectedTenantId: "tenant_other"
  });
  assert.equal(first.ok, false);
  assert.equal(first.code, "LISTING_BOND_TENANT_MISMATCH");
  assert.equal(second.ok, false);
  assert.equal(second.code, first.code);
});
