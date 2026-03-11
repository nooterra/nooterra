import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../scripts/examples/action-wallet-first-governed-action.mjs", import.meta.url));

test("action-wallet first-governed-action script: --help prints quickstart usage", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, "--help"], {
    env: { ...process.env, NODE_ENV: "test" }
  }).catch((error) => {
    throw new Error(`script unexpectedly failed\nstdout:\n${error.stdout ?? ""}\nstderr:\n${error.stderr ?? ""}`);
  });
  assert.match(stdout, /first-governed-action quickstart/i);
  assert.match(stdout, /NOOTERRA_TENANT_ID/);
  assert.equal(stderr, "");
});

test("action-wallet first-governed-action script: fails closed without tenant or signup fields", async () => {
  const child = await execFileAsync(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      NOOTERRA_TENANT_ID: "",
      NOOTERRA_SIGNUP_EMAIL: "",
      NOOTERRA_SIGNUP_COMPANY: "",
      NOOTERRA_SIGNUP_NAME: ""
    }
  }).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  );
  assert.equal(child.ok, false);
  assert.match(String(child.error?.stderr ?? ""), /Set NOOTERRA_TENANT_ID to reuse a workspace/i);
});
