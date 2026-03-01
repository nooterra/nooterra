import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import {
  SESSION_MEMORY_ACCESS_REASON_CODE,
  normalizeSessionMemoryAccessPolicyV1,
  computeSessionMemoryAccessPolicyHash,
  evaluateSessionMemoryReadAccessV1
} from "../src/core/session-memory-access.js";

test("session memory access: policy normalization and hash are deterministic", () => {
  const policy = {
    schemaVersion: "SessionMemoryAccessPolicy.v1",
    ownerPrincipalId: "agt_owner_1",
    teamPrincipalIds: ["agt_team_2", "agt_team_1", "agt_team_1", "agt_owner_1"],
    delegatedPrincipalIds: ["agt_delegate_2", "agt_delegate_1", "agt_delegate_1", "agt_owner_1"],
    allowTeamRead: true,
    allowDelegatedRead: true,
    allowCrossAgentSharing: false
  };

  const normalizedA = normalizeSessionMemoryAccessPolicyV1({ policy, participants: ["agt_owner_1"] });
  const normalizedB = normalizeSessionMemoryAccessPolicyV1({
    policy: {
      ...policy,
      teamPrincipalIds: ["agt_team_1", "agt_team_2"],
      delegatedPrincipalIds: ["agt_delegate_1", "agt_delegate_2"]
    },
    participants: ["agt_owner_1"]
  });
  assert.equal(canonicalJsonStringify(normalizedA), canonicalJsonStringify(normalizedB));
  assert.equal(computeSessionMemoryAccessPolicyHash(policy), computeSessionMemoryAccessPolicyHash(normalizedB));
});

test("session memory access: fails closed when principal is missing", () => {
  const decision = evaluateSessionMemoryReadAccessV1({
    principalId: null,
    participants: ["agt_owner_1"],
    policy: null
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, SESSION_MEMORY_ACCESS_REASON_CODE.PRINCIPAL_MISSING);
});

test("session memory access: default participant policy grants team scope deterministically", () => {
  const decision = evaluateSessionMemoryReadAccessV1({
    principalId: "agt_team_1",
    participants: ["agt_owner_1", "agt_team_1"],
    policy: null
  });
  assert.equal(decision.ok, true, decision.error ?? decision.code ?? "participant should get team access by default");
  assert.equal(decision.scope, "team");
});

test("session memory access: explicit personal/team/delegated scope checks fail closed", () => {
  const policy = {
    schemaVersion: "SessionMemoryAccessPolicy.v1",
    ownerPrincipalId: "agt_owner_1",
    teamPrincipalIds: ["agt_team_1"],
    delegatedPrincipalIds: ["agt_delegate_1"],
    allowTeamRead: true,
    allowDelegatedRead: false,
    allowCrossAgentSharing: false
  };

  const ownerPersonal = evaluateSessionMemoryReadAccessV1({
    principalId: "agt_owner_1",
    participants: ["agt_owner_1", "agt_team_1", "agt_delegate_1"],
    policy,
    scope: "personal"
  });
  assert.equal(ownerPersonal.ok, true, ownerPersonal.error ?? ownerPersonal.code ?? "owner personal scope should pass");

  const teamPersonalDenied = evaluateSessionMemoryReadAccessV1({
    principalId: "agt_team_1",
    participants: ["agt_owner_1", "agt_team_1", "agt_delegate_1"],
    policy,
    scope: "personal"
  });
  assert.equal(teamPersonalDenied.ok, false);
  assert.equal(teamPersonalDenied.code, SESSION_MEMORY_ACCESS_REASON_CODE.PERSONAL_SCOPE_DENIED);

  const delegatedDenied = evaluateSessionMemoryReadAccessV1({
    principalId: "agt_delegate_1",
    participants: ["agt_owner_1", "agt_team_1", "agt_delegate_1"],
    policy,
    scope: "delegated"
  });
  assert.equal(delegatedDenied.ok, false);
  assert.equal(delegatedDenied.code, SESSION_MEMORY_ACCESS_REASON_CODE.DELEGATED_SCOPE_DISABLED);
});
