import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const PROFILE_FINGERPRINT_SCHEMA_VERSION = "NooterraProfileFingerprint.v1";

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

export function computeProfileFingerprint(profile) {
  assertPlainObject(profile, "profile");
  const canonicalProfile = normalizeForCanonicalJson(profile, { path: "$" });
  const profileCanonicalJson = canonicalJsonStringify(canonicalProfile);
  const profileFingerprint = sha256Hex(profileCanonicalJson);
  return {
    schemaVersion: PROFILE_FINGERPRINT_SCHEMA_VERSION,
    profileId: typeof profile.profileId === "string" ? profile.profileId : null,
    profileSchemaVersion: typeof profile.schemaVersion === "string" ? profile.schemaVersion : null,
    profileFingerprint
  };
}
