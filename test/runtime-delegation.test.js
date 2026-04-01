import test from "node:test";
import assert from "node:assert/strict";
import { attenuateCapabilities } from "../services/runtime/delegation.ts";

test("attenuateCapabilities: returns intersection of parent and requested", () => {
  const result = attenuateCapabilities(
    ["send_email", "web_search", "make_payment"],
    ["send_email", "delete_record", "web_search"]
  );
  assert.deepEqual(result.sort(), ["send_email", "web_search"]);
});

test("attenuateCapabilities: empty parent means full access", () => {
  const result = attenuateCapabilities([], ["send_email", "web_search"]);
  assert.deepEqual(result, ["send_email", "web_search"]);
});

test("attenuateCapabilities: no overlap returns empty", () => {
  const result = attenuateCapabilities(["send_email"], ["make_payment"]);
  assert.deepEqual(result, []);
});

test("attenuateCapabilities: handles empty requested", () => {
  const result = attenuateCapabilities(["send_email"], []);
  assert.deepEqual(result, []);
});
