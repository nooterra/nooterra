#!/usr/bin/env node
import { buildSessionReplayPackV1, signSessionReplayPackV1 } from "../../../src/core/session-replay-pack.js";
import { buildSessionTranscriptV1, signSessionTranscriptV1 } from "../../../src/core/session-transcript.js";

function fail({ caseId, code, message, details = null }) {
  const payload = {
    schemaVersion: "SessionArtifactConformanceResponse.v1",
    caseId,
    ok: false,
    code,
    message,
    details
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(1);
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("error", reject);
    process.stdin.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw === "" ? {} : JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizeParticipants(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const row of value) {
    const normalized = normalizeNonEmptyString(row);
    if (!normalized) continue;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

async function main() {
  const request = await readStdinJson();
  const caseId = typeof request?.caseId === "string" ? request.caseId : null;

  try {
    if (request?.schemaVersion !== "SessionArtifactConformanceRequest.v1") {
      throw new TypeError("schemaVersion must be SessionArtifactConformanceRequest.v1");
    }
    assertObject(request.fixture, "fixture");
    const fixture = request.fixture;
    const acl = fixture.acl && typeof fixture.acl === "object" && !Array.isArray(fixture.acl) ? fixture.acl : null;
    if (acl) {
      const principalId = normalizeNonEmptyString(acl.principalId);
      const participants = normalizeParticipants(acl.participants);
      if (!principalId || participants.length === 0 || !participants.includes(principalId)) {
        fail({
          caseId,
          code: "SESSION_ACCESS_DENIED",
          message: "session access denied",
          details: {
            sessionId: normalizeNonEmptyString(fixture?.session?.sessionId),
            principalId,
            participants
          }
        });
      }
    }

    const replayPackUnsigned = buildSessionReplayPackV1({
      tenantId: fixture.tenantId,
      session: fixture.session,
      events: fixture.events,
      verification: fixture.verification ?? null
    });

    const transcriptUnsigned = buildSessionTranscriptV1({
      tenantId: fixture.tenantId,
      session: fixture.session,
      events: fixture.events,
      verification: fixture.verification ?? null
    });

    const signing = fixture.signing && typeof fixture.signing === "object" && !Array.isArray(fixture.signing) ? fixture.signing : null;
    const replayPack =
      signing === null
        ? replayPackUnsigned
        : signSessionReplayPackV1({
            replayPack: replayPackUnsigned,
            signedAt: signing.signedAt ?? replayPackUnsigned.generatedAt,
            publicKeyPem: signing.publicKeyPem,
            privateKeyPem: signing.privateKeyPem,
            keyId: signing.keyId ?? null
          });

    const transcript =
      signing === null
        ? transcriptUnsigned
        : signSessionTranscriptV1({
            transcript: transcriptUnsigned,
            signedAt: signing.signedAt ?? transcriptUnsigned.generatedAt,
            publicKeyPem: signing.publicKeyPem,
            privateKeyPem: signing.privateKeyPem,
            keyId: signing.keyId ?? null
          });

    const payload = {
      schemaVersion: "SessionArtifactConformanceResponse.v1",
      caseId,
      ok: true,
      runtime: {
        implementation: "nooterra-reference-js",
        adapterSchemaVersion: "SessionArtifactConformanceResponse.v1"
      },
      replayPack,
      transcript
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch (err) {
    fail({
      caseId,
      code: "SESSION_ADAPTER_RUNTIME_ERROR",
      message: err?.message ?? String(err ?? "unknown error")
    });
  }
}

main().catch((err) => {
  fail({
    caseId: null,
    code: "SESSION_ADAPTER_RUNTIME_ERROR",
    message: err?.message ?? String(err ?? "unknown error")
  });
});
