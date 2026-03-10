import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PRODUCT_SHELL_PATH = path.resolve(process.cwd(), "dashboard/src/product/ProductShell.jsx");

test("product shell onboarding stays passkey-first with email recovery", () => {
  const source = fs.readFileSync(PRODUCT_SHELL_PATH, "utf8");

  assert.match(source, /Primary: passkey/);
  assert.match(source, /Recovery: email OTP/);
  assert.match(source, /Saved device passkey/);
  assert.match(source, /Passkey is the primary path/i);
  assert.match(source, /Create Workspace \+ Save Passkey/);
  assert.match(source, /Sign In With Saved Passkey/);
  assert.match(source, /Recovery by email/);
  assert.match(source, /Request Recovery Code/);
  assert.match(source, /Use Recovery Code/);

  assert.doesNotMatch(source, /OTP email/);
  assert.doesNotMatch(source, /Verify Recovery OTP/);
  assert.doesNotMatch(source, /Request Recovery OTP/);
});
