import test from "node:test";
import assert from "node:assert/strict";

import { readToolCommitBestEffort as readCoreCommit, readToolVersionBestEffort as readCoreVersion } from "../src/core/tool-provenance.js";
import { readToolCommitBestEffort as readVerifyCommit } from "../packages/artifact-verify/src/tool-provenance.js";

test("tool commit derivation is consistent across core + verifier (env precedence)", async () => {
  const env = {
    SETTLD_COMMIT_SHA: "abcdef0123456789",
    PROXY_BUILD: "1111111",
    GIT_SHA: "2222222",
    GITHUB_SHA: "3333333",
    SETTLD_VERSION: "1.2.3"
  };
  assert.equal(readCoreCommit({ env }), "abcdef0123456789");
  assert.equal(readVerifyCommit({ env }), "abcdef0123456789");

  const env2 = { ...env, SETTLD_COMMIT_SHA: "" };
  assert.equal(readCoreCommit({ env: env2 }), "1111111");
  assert.equal(readVerifyCommit({ env: env2 }), "1111111");
});

test("tool version derivation prefers SETTLD_VERSION env when set (core)", async () => {
  const env = { SETTLD_VERSION: "9.9.9" };
  assert.equal(readCoreVersion({ env, cwd: process.cwd() }), "9.9.9");
});

