# Canonical JSON

Settld hashes and signs canonical JSON to avoid ambiguity across runtimes/languages.

## Canonicalization algorithm

Settld uses **RFC 8785 (JCS — JSON Canonicalization Scheme)** as the canonicalization contract for all protocol-critical hashes/signatures.

In this repo, “canonical JSON” means the UTF-8 bytes of the JCS canonical form.

Given an input value (a JSON value):

- `null`, `string`, `boolean` serialize as-is.
- `number` must be finite and must not be `-0` (protocol rejects these).
- `array` preserves element order; each element is canonicalized recursively.
- `object` must be a plain object (prototype is `Object.prototype` or `null`), with no symbol keys.
  - Keys are sorted ascending (lexicographic).
  - Values are canonicalized recursively.

The canonical form is serialized as JSON (no whitespace) per JCS.

### Optional fields

- JSON has no `undefined`. Protocol objects MUST NOT include `undefined` in hashed/signed payloads.
- “Field not present” is semantically different from “field present with `null`”. Protocol surfaces SHOULD omit optional fields when absent, and use `null` only when the spec explicitly calls for it.

## Hash rule

When a spec says **“hash the object”**, it means:

`sha256_hex( utf8( canonical_json_stringify(object) ) )`
