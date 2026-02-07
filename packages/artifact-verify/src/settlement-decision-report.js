import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256HexUtf8, verifyHashHexEd25519 } from "./crypto.js";

export const SETTLEMENT_DECISION_REPORT_SCHEMA_V1 = "SettlementDecisionReport.v1";

function stripSettlementDecisionReportSig(report) {
  const { reportHash: _h, signature: _sig, signerKeyId: _kid, signedAt: _sa, ...rest } = report ?? {};
  return rest;
}

export function computeSettlementDecisionReportHashV1(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new TypeError("report must be an object");
  const core = stripSettlementDecisionReportSig(report);
  return sha256HexUtf8(canonicalJsonStringify(core));
}

export function verifySettlementDecisionReportV1Signature({ report, trustedBuyerDecisionPublicKeyByKeyId } = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return { ok: false, error: "settlement decision report must be an object" };
  if (String(report.schemaVersion ?? "") !== SETTLEMENT_DECISION_REPORT_SCHEMA_V1) {
    return { ok: false, error: "unsupported settlement decision report schemaVersion", schemaVersion: report.schemaVersion ?? null };
  }
  if (!(trustedBuyerDecisionPublicKeyByKeyId instanceof Map)) return { ok: false, error: "trustedBuyerDecisionPublicKeyByKeyId must be a Map" };

  const signerKeyId = typeof report.signerKeyId === "string" && report.signerKeyId.trim() ? report.signerKeyId.trim() : null;
  const signature = typeof report.signature === "string" && report.signature.trim() ? report.signature.trim() : null;
  const declaredHash = typeof report.reportHash === "string" && report.reportHash.trim() ? report.reportHash.trim() : null;
  if (!signerKeyId || !signature || !declaredHash) return { ok: false, error: "settlement decision report missing signature fields" };

  let expectedHash;
  try {
    expectedHash = computeSettlementDecisionReportHashV1(report);
  } catch (err) {
    return { ok: false, error: "failed to hash settlement decision report", detail: { message: err?.message ?? String(err ?? "") } };
  }
  if (expectedHash !== declaredHash) return { ok: false, error: "SETTLEMENT_DECISION_SIGNATURE_PAYLOAD_MISMATCH", expected: expectedHash, actual: declaredHash };

  const publicKeyPem = trustedBuyerDecisionPublicKeyByKeyId.get(signerKeyId) ?? null;
  if (!publicKeyPem) return { ok: false, error: "settlement decision signerKeyId not trusted", signerKeyId };

  const okSig = verifyHashHexEd25519({ hashHex: expectedHash, signatureBase64: signature, publicKeyPem });
  if (!okSig) return { ok: false, error: "SETTLEMENT_DECISION_SIGNATURE_INVALID", signerKeyId };
  return { ok: true, reportHash: expectedHash, signerKeyId };
}

export function verifySettlementDecisionReportV1Binding({ report, expectedManifestHash, expectedHeadAttestationHash } = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return { ok: false, error: "settlement decision report must be an object" };
  if (String(report.schemaVersion ?? "") !== SETTLEMENT_DECISION_REPORT_SCHEMA_V1) {
    return { ok: false, error: "unsupported settlement decision report schemaVersion", schemaVersion: report.schemaVersion ?? null };
  }
  const bundle = report.invoiceBundle ?? null;
  const manifestHash = typeof bundle?.manifestHash === "string" ? bundle.manifestHash : null;
  const headAttestationHash = typeof bundle?.headAttestationHash === "string" ? bundle.headAttestationHash : null;

  if (typeof expectedManifestHash === "string" && expectedManifestHash && manifestHash !== expectedManifestHash) {
    return { ok: false, error: "settlement decision invoiceBundle.manifestHash mismatch", expected: expectedManifestHash, actual: manifestHash ?? null };
  }
  if (typeof expectedHeadAttestationHash === "string" && expectedHeadAttestationHash && headAttestationHash !== expectedHeadAttestationHash) {
    return { ok: false, error: "settlement decision invoiceBundle.headAttestationHash mismatch", expected: expectedHeadAttestationHash, actual: headAttestationHash ?? null };
  }
  return { ok: true, manifestHash, headAttestationHash };
}
