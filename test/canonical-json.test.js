import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJsonStringify as canonicalCore } from "../src/core/canonical-json.js";
import { canonicalJsonStringify as canonicalVerify } from "../packages/artifact-verify/src/canonical-json.js";

test("canonical JSON: key order is stable and lexicographic", () => {
  const a = { b: 1, a: 2, c: { y: true, x: false } };
  const b = {};
  b.c = {};
  b.c.x = false;
  b.c.y = true;
  b.a = 2;
  b.b = 1;
  assert.equal(canonicalCore(a), canonicalCore(b));
  assert.equal(canonicalVerify(a), canonicalVerify(b));
  assert.equal(canonicalCore(a), canonicalVerify(a));
});

test("canonical JSON: unicode is hashed over UTF-8 bytes of canonical JSON string", () => {
  const value = { s: "café ∑ — 😀", escaped: "line\nbreak\tand\\slash" };
  assert.equal(canonicalCore(value), canonicalVerify(value));
});

test("canonical JSON: rejects non-finite and -0", () => {
  assert.throws(() => canonicalCore(NaN), /non-finite/);
  assert.throws(() => canonicalCore(Infinity), /non-finite/);
  assert.throws(() => canonicalCore(-Infinity), /non-finite/);
  assert.throws(() => canonicalCore(-0), /-0/);

  assert.throws(() => canonicalVerify(NaN), /non-finite/);
  assert.throws(() => canonicalVerify(Infinity), /non-finite/);
  assert.throws(() => canonicalVerify(-Infinity), /non-finite/);
  assert.throws(() => canonicalVerify(-0), /-0/);
});

test("canonical JSON: rejects non-plain objects", () => {
  class Foo {
    constructor() {
      this.a = 1;
    }
  }
  assert.throws(() => canonicalCore(new Foo()), /non-plain object/);
  assert.throws(() => canonicalVerify(new Foo()), /non-plain object/);
});

