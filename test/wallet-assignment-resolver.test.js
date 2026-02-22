import test from "node:test";
import assert from "node:assert/strict";

import { resolveDeterministicWalletAssignment } from "../src/core/wallet-assignment-resolver.js";

test("wallet assignment resolver prefers sponsor-matching active policy", () => {
  const assignment = resolveDeterministicWalletAssignment({
    tenantId: "tenant_default",
    profileRef: "sponsor_match_1",
    riskClass: "financial",
    delegationRef: "dlg_root_1",
    delegationDepth: 1,
    policies: [
      {
        sponsorRef: null,
        sponsorWalletRef: "wallet_fallback_1",
        policyRef: "policy_fallback_1",
        policyVersion: 1,
        status: "active"
      },
      {
        sponsorRef: "sponsor_match_1",
        sponsorWalletRef: "wallet_match_1",
        policyRef: "policy_match_1",
        policyVersion: 7,
        status: "active",
        maxDelegationDepth: 2
      }
    ]
  });
  assert.deepEqual(assignment, {
    sponsorWalletRef: "wallet_match_1",
    policyRef: "policy_match_1",
    policyVersion: 7
  });
});

test("wallet assignment resolver filters by delegation depth when policy sets max depth", () => {
  const assignment = resolveDeterministicWalletAssignment({
    tenantId: "tenant_default",
    profileRef: "sponsor_match_2",
    riskClass: "action",
    delegationRef: "dlg_root_2",
    delegationDepth: 3,
    policies: [
      {
        sponsorRef: "sponsor_match_2",
        sponsorWalletRef: "wallet_too_shallow_1",
        policyRef: "policy_too_shallow_1",
        policyVersion: 1,
        status: "active",
        maxDelegationDepth: 2
      },
      {
        sponsorRef: null,
        sponsorWalletRef: "wallet_default_2",
        policyRef: "policy_default_2",
        policyVersion: 3,
        status: "active"
      }
    ]
  });
  assert.deepEqual(assignment, {
    sponsorWalletRef: "wallet_default_2",
    policyRef: "policy_default_2",
    policyVersion: 3
  });
});

test("wallet assignment resolver is deterministic across candidate order", () => {
  const input = {
    tenantId: "tenant_default",
    profileRef: "sponsor_none_1",
    riskClass: "compute",
    delegationRef: "dlg_root_3",
    delegationDepth: 0
  };
  const policiesA = [
    { sponsorRef: null, sponsorWalletRef: "wallet_alpha_1", policyRef: "policy_alpha_1", policyVersion: 1, status: "active" },
    { sponsorRef: null, sponsorWalletRef: "wallet_beta_1", policyRef: "policy_beta_1", policyVersion: 1, status: "active" }
  ];
  const policiesB = [...policiesA].reverse();
  const assignmentA = resolveDeterministicWalletAssignment({ ...input, policies: policiesA });
  const assignmentB = resolveDeterministicWalletAssignment({ ...input, policies: policiesB });
  assert.deepEqual(assignmentA, assignmentB);
});

test("wallet assignment resolver returns null when no eligible active policies exist", () => {
  const assignment = resolveDeterministicWalletAssignment({
    tenantId: "tenant_default",
    profileRef: "sponsor_none_2",
    riskClass: "read",
    delegationRef: "dlg_root_4",
    policies: [
      { sponsorRef: null, sponsorWalletRef: "wallet_disabled_1", policyRef: "policy_disabled_1", policyVersion: 1, status: "disabled" }
    ]
  });
  assert.equal(assignment, null);
});
