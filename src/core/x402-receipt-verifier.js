import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";
import { verifyToolProviderQuoteSignatureV1 } from "./provider-quote-signature.js";
import { verifySettlementKernelArtifacts } from "./settlement-kernel.js";
import { verifyToolProviderSignatureV1 } from "./tool-provider-signature.js";

export const X402_RECEIPT_VERIFICATION_REPORT_SCHEMA_VERSION = "X402ReceiptVerificationReport.v1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSha256OrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) return null;
  return text;
}

function parseEvidenceRefMap(evidenceRefs) {
  const out = {
    requestSha256: null,
    responseSha256: null,
    providerKeyId: null,
    providerSignedAt: null,
    providerNonce: null,
    providerPayloadSha256: null,
    providerSignatureBase64: null,
    providerQuoteId: null,
    providerQuotePayloadSha256: null
  };
  if (!Array.isArray(evidenceRefs)) return out;
  for (const row of evidenceRefs) {
    const ref = typeof row === "string" ? row.trim() : "";
    if (!ref) continue;
    if (ref.startsWith("http:request_sha256:")) {
      out.requestSha256 = normalizeSha256OrNull(ref.slice("http:request_sha256:".length)) ?? out.requestSha256;
      continue;
    }
    if (ref.startsWith("http:response_sha256:")) {
      out.responseSha256 = normalizeSha256OrNull(ref.slice("http:response_sha256:".length)) ?? out.responseSha256;
      continue;
    }
    if (ref.startsWith("provider:key_id:")) {
      const value = ref.slice("provider:key_id:".length).trim();
      if (value) out.providerKeyId = value;
      continue;
    }
    if (ref.startsWith("provider:signed_at:")) {
      const value = ref.slice("provider:signed_at:".length).trim();
      if (value) out.providerSignedAt = value;
      continue;
    }
    if (ref.startsWith("provider:nonce:")) {
      const value = ref.slice("provider:nonce:".length).trim();
      if (value) out.providerNonce = value;
      continue;
    }
    if (ref.startsWith("provider:payload_sha256:")) {
      out.providerPayloadSha256 =
        normalizeSha256OrNull(ref.slice("provider:payload_sha256:".length)) ?? out.providerPayloadSha256;
      continue;
    }
    if (ref.startsWith("provider:sig_b64:")) {
      const value = ref.slice("provider:sig_b64:".length).trim();
      if (value) out.providerSignatureBase64 = value;
      continue;
    }
    if (ref.startsWith("provider_quote:quote_id:")) {
      const value = ref.slice("provider_quote:quote_id:".length).trim();
      if (value) out.providerQuoteId = value;
      continue;
    }
    if (ref.startsWith("provider_quote:payload_sha256:")) {
      out.providerQuotePayloadSha256 =
        normalizeSha256OrNull(ref.slice("provider_quote:payload_sha256:".length)) ?? out.providerQuotePayloadSha256;
      continue;
    }
  }
  return out;
}

function pushIssue(target, { code, message, detail = null }) {
  target.push(
    normalizeForCanonicalJson(
      {
        code: String(code),
        message: String(message),
        ...(detail === null || detail === undefined ? {} : { detail })
      },
      { path: "$" }
    )
  );
}

function pushCheck(checks, { id, ok, detail = null }) {
  checks.push(
    normalizeForCanonicalJson(
      {
        id: String(id),
        ok: ok === true,
        ...(detail === null || detail === undefined ? {} : { detail })
      },
      { path: "$" }
    )
  );
}

function verifyProviderOutputSignature({ receipt, bindings, verificationContext, evidence, checks, warnings, errors }) {
  const status = isPlainObject(bindings?.providerSig) ? bindings.providerSig : null;
  const required = status?.required === true;
  const expectedVerified = status?.verified === true;
  const expectedResponseSha = normalizeSha256OrNull(bindings?.response?.sha256);
  const contextKey = isPlainObject(verificationContext?.providerSigningKey) ? verificationContext.providerSigningKey : null;
  const publicKeyPem =
    typeof contextKey?.publicKeyPem === "string" && contextKey.publicKeyPem.trim() !== "" ? contextKey.publicKeyPem.trim() : null;

  const fromReceipt = isPlainObject(receipt?.providerSignature) ? { ...receipt.providerSignature } : null;
  const fromEvidence =
    evidence.providerKeyId && evidence.providerSignedAt && evidence.providerNonce && evidence.providerSignatureBase64 && expectedResponseSha
      ? {
          schemaVersion: "ToolProviderSignature.v1",
          algorithm: "ed25519",
          keyId: evidence.providerKeyId,
          signedAt: evidence.providerSignedAt,
          nonce: evidence.providerNonce,
          responseHash: expectedResponseSha,
          payloadHash: evidence.providerPayloadSha256,
          signatureBase64: evidence.providerSignatureBase64
        }
      : null;
  const candidate = fromReceipt ?? fromEvidence;

  if (!candidate) {
    if (required || expectedVerified) {
      const issue = {
        code: "provider_signature_material_missing",
        message: "provider signature bytes are missing from receipt/evidence"
      };
      pushIssue(errors, issue);
    } else {
      const issue = {
        code: "provider_signature_not_available",
        message: "provider signature bytes are not present; skipped crypto verification"
      };
      pushIssue(warnings, issue);
    }
    pushCheck(checks, { id: "provider_output_signature_crypto", ok: !required && !expectedVerified, detail: { skipped: true } });
    return;
  }

  if (!publicKeyPem) {
    pushIssue(errors, {
      code: "provider_signature_key_missing",
      message: "verificationContext.providerSigningKey.publicKeyPem is required for signature verification"
    });
    pushCheck(checks, { id: "provider_output_signature_crypto", ok: false, detail: { reason: "missing_public_key" } });
    return;
  }

  if (expectedResponseSha && normalizeSha256OrNull(candidate.responseHash) !== expectedResponseSha) {
    pushIssue(errors, {
      code: "provider_signature_response_hash_mismatch",
      message: "provider signature responseHash does not match receipt binding",
      detail: {
        expected: expectedResponseSha,
        actual: normalizeSha256OrNull(candidate.responseHash)
      }
    });
  }

  if (
    status?.providerKeyId &&
    typeof candidate.keyId === "string" &&
    candidate.keyId.trim() !== "" &&
    String(status.providerKeyId) !== String(candidate.keyId)
  ) {
    pushIssue(errors, {
      code: "provider_signature_key_id_mismatch",
      message: "provider signature keyId does not match bindings.providerSig.providerKeyId",
      detail: {
        expected: status.providerKeyId,
        actual: candidate.keyId
      }
    });
  }

  let ok = false;
  try {
    ok = verifyToolProviderSignatureV1({ signature: candidate, publicKeyPem });
  } catch (err) {
    pushIssue(errors, {
      code: "provider_signature_parse_failed",
      message: "provider signature object is malformed",
      detail: { message: err?.message ?? String(err ?? "") }
    });
    ok = false;
  }
  if (!ok) {
    pushIssue(errors, {
      code: "provider_signature_crypto_invalid",
      message: "provider output signature verification failed"
    });
  }
  pushCheck(checks, { id: "provider_output_signature_crypto", ok });
}

function verifyProviderQuoteSignature({ receipt, bindings, verificationContext, evidence, checks, warnings, errors }) {
  const status = isPlainObject(bindings?.providerQuoteSig) ? bindings.providerQuoteSig : null;
  const required = status?.required === true;
  const expectedVerified = status?.verified === true;
  const payload = isPlainObject(receipt?.providerQuotePayload) ? receipt.providerQuotePayload : null;
  const signature = isPlainObject(receipt?.providerQuoteSignature) ? receipt.providerQuoteSignature : null;
  const contextKey = isPlainObject(verificationContext?.providerQuoteSigningKey) ? verificationContext.providerQuoteSigningKey : null;
  const publicKeyPem =
    typeof contextKey?.publicKeyPem === "string" && contextKey.publicKeyPem.trim() !== "" ? contextKey.publicKeyPem.trim() : null;

  if (!payload || !signature || !publicKeyPem) {
    if (required || expectedVerified) {
      const issue = {
        code: "provider_quote_signature_material_missing",
        message: "quote payload/signature/public key missing; quote signature cannot be re-verified offline",
        detail: {
          hasPayload: Boolean(payload),
          hasSignature: Boolean(signature),
          hasPublicKey: Boolean(publicKeyPem)
        }
      };
      pushIssue(warnings, issue);
    }
    pushCheck(checks, {
      id: "provider_quote_signature_crypto",
      ok: !required && !expectedVerified,
      detail: { skipped: true, hasPayload: Boolean(payload), hasSignature: Boolean(signature), hasPublicKey: Boolean(publicKeyPem) }
    });
    return;
  }

  let ok = false;
  try {
    ok = verifyToolProviderQuoteSignatureV1({ quote: payload, signature, publicKeyPem });
  } catch (err) {
    pushIssue(errors, {
      code: "provider_quote_signature_parse_failed",
      message: "provider quote signature object is malformed",
      detail: { message: err?.message ?? String(err ?? "") }
    });
    ok = false;
  }
  if (!ok) {
    pushIssue(errors, {
      code: "provider_quote_signature_crypto_invalid",
      message: "provider quote signature verification failed"
    });
  }
  const payloadSha256 = sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(payload, { path: "$" })));
  if (status?.quoteSha256 && normalizeSha256OrNull(status.quoteSha256) !== payloadSha256) {
    pushIssue(errors, {
      code: "provider_quote_signature_hash_mismatch",
      message: "bindings.providerQuoteSig.quoteSha256 does not match quote payload hash",
      detail: {
        expected: normalizeSha256OrNull(status.quoteSha256),
        actual: payloadSha256
      }
    });
  }
  if (evidence.providerQuotePayloadSha256 && evidence.providerQuotePayloadSha256 !== payloadSha256) {
    pushIssue(errors, {
      code: "provider_quote_evidence_hash_mismatch",
      message: "provider quote evidence payload hash does not match quote payload hash",
      detail: {
        expected: evidence.providerQuotePayloadSha256,
        actual: payloadSha256
      }
    });
  }
  if (status?.quoteId && payload?.quoteId && String(status.quoteId) !== String(payload.quoteId)) {
    pushIssue(errors, {
      code: "provider_quote_id_mismatch",
      message: "bindings.providerQuoteSig.quoteId does not match quote payload quoteId",
      detail: {
        expected: status.quoteId,
        actual: payload.quoteId
      }
    });
  }
  if (evidence.providerQuoteId && payload?.quoteId && String(evidence.providerQuoteId) !== String(payload.quoteId)) {
    pushIssue(errors, {
      code: "provider_quote_evidence_id_mismatch",
      message: "provider quote evidence quoteId does not match quote payload quoteId",
      detail: {
        expected: evidence.providerQuoteId,
        actual: payload.quoteId
      }
    });
  }
  pushCheck(checks, { id: "provider_quote_signature_crypto", ok });
}

export function verifyX402ReceiptRecord({ receipt, strict = false } = {}) {
  if (!isPlainObject(receipt)) throw new TypeError("receipt must be an object");
  if (String(receipt.schemaVersion ?? "") !== "X402ReceiptRecord.v1") {
    throw new TypeError("receipt.schemaVersion must be X402ReceiptRecord.v1");
  }
  const checks = [];
  const warnings = [];
  const errors = [];

  const bindings = isPlainObject(receipt.bindings) ? receipt.bindings : {};
  const verificationContext = isPlainObject(receipt.verificationContext) ? receipt.verificationContext : {};
  const evidence = parseEvidenceRefMap(receipt.evidenceRefs);

  const runId = typeof receipt.runId === "string" && receipt.runId.trim() !== "" ? receipt.runId.trim() : null;
  const kernelVerification = verifySettlementKernelArtifacts({
    runId,
    settlement: {
      runId,
      decisionTrace: {
        decisionRecord: isPlainObject(receipt.decisionRecord) ? receipt.decisionRecord : null,
        settlementReceipt: isPlainObject(receipt.settlementReceipt) ? receipt.settlementReceipt : null
      }
    }
  });
  if (!kernelVerification.valid) {
    pushIssue(errors, {
      code: "settlement_kernel_invalid",
      message: "settlement kernel artifacts are invalid",
      detail: { errors: kernelVerification.errors ?? [] }
    });
  }
  pushCheck(checks, { id: "settlement_kernel_artifacts", ok: kernelVerification.valid, detail: { errors: kernelVerification.errors ?? [] } });

  const settlementReceiptId =
    typeof receipt?.settlementReceipt?.receiptId === "string" && receipt.settlementReceipt.receiptId.trim() !== ""
      ? receipt.settlementReceipt.receiptId.trim()
      : null;
  const receiptIdMatches = settlementReceiptId ? settlementReceiptId === String(receipt.receiptId ?? "") : false;
  if (!receiptIdMatches) {
    pushIssue(errors, {
      code: "receipt_id_mismatch",
      message: "top-level receiptId does not match settlementReceipt.receiptId",
      detail: {
        receiptId: receipt.receiptId ?? null,
        settlementReceiptId
      }
    });
  }
  pushCheck(checks, { id: "receipt_id_binding", ok: receiptIdMatches });

  const bindingRequestSha = normalizeSha256OrNull(bindings?.request?.sha256);
  const bindingResponseSha = normalizeSha256OrNull(bindings?.response?.sha256);
  const requestEvidenceOk = !bindingRequestSha || !evidence.requestSha256 || evidence.requestSha256 === bindingRequestSha;
  const responseEvidenceOk = !bindingResponseSha || !evidence.responseSha256 || evidence.responseSha256 === bindingResponseSha;
  if (!requestEvidenceOk) {
    pushIssue(errors, {
      code: "request_hash_binding_mismatch",
      message: "bindings.request.sha256 does not match evidence reference",
      detail: { expected: bindingRequestSha, actual: evidence.requestSha256 }
    });
  }
  if (!responseEvidenceOk) {
    pushIssue(errors, {
      code: "response_hash_binding_mismatch",
      message: "bindings.response.sha256 does not match evidence reference",
      detail: { expected: bindingResponseSha, actual: evidence.responseSha256 }
    });
  }
  pushCheck(checks, { id: "request_hash_binding", ok: requestEvidenceOk, detail: { binding: bindingRequestSha, evidence: evidence.requestSha256 } });
  pushCheck(checks, {
    id: "response_hash_binding",
    ok: responseEvidenceOk,
    detail: { binding: bindingResponseSha, evidence: evidence.responseSha256 }
  });

  const providerSigThumbprintBinding = normalizeSha256OrNull(bindings?.providerSig?.keyJwkThumbprintSha256);
  const providerSigThumbprintContext = normalizeSha256OrNull(verificationContext?.providerSigningKey?.jwkThumbprintSha256);
  const providerSigThumbprintOk =
    !providerSigThumbprintBinding || !providerSigThumbprintContext || providerSigThumbprintBinding === providerSigThumbprintContext;
  if (!providerSigThumbprintOk) {
    pushIssue(errors, {
      code: "provider_sig_thumbprint_mismatch",
      message: "bindings.providerSig key thumbprint does not match verificationContext provider key",
      detail: {
        expected: providerSigThumbprintBinding,
        actual: providerSigThumbprintContext
      }
    });
  }
  pushCheck(checks, {
    id: "provider_sig_thumbprint_binding",
    ok: providerSigThumbprintOk,
    detail: { binding: providerSigThumbprintBinding, context: providerSigThumbprintContext }
  });

  const providerQuoteThumbprintBinding = normalizeSha256OrNull(bindings?.providerQuoteSig?.keyJwkThumbprintSha256);
  const providerQuoteThumbprintContext = normalizeSha256OrNull(verificationContext?.providerQuoteSigningKey?.jwkThumbprintSha256);
  const providerQuoteThumbprintOk =
    !providerQuoteThumbprintBinding || !providerQuoteThumbprintContext || providerQuoteThumbprintBinding === providerQuoteThumbprintContext;
  if (!providerQuoteThumbprintOk) {
    pushIssue(errors, {
      code: "provider_quote_sig_thumbprint_mismatch",
      message: "bindings.providerQuoteSig key thumbprint does not match verificationContext provider quote key",
      detail: {
        expected: providerQuoteThumbprintBinding,
        actual: providerQuoteThumbprintContext
      }
    });
  }
  pushCheck(checks, {
    id: "provider_quote_sig_thumbprint_binding",
    ok: providerQuoteThumbprintOk,
    detail: { binding: providerQuoteThumbprintBinding, context: providerQuoteThumbprintContext }
  });

  verifyProviderOutputSignature({ receipt, bindings, verificationContext, evidence, checks, warnings, errors });
  verifyProviderQuoteSignature({ receipt, bindings, verificationContext, evidence, checks, warnings, errors });

  const strictMode = strict === true;
  if (strictMode) {
    for (const warning of warnings) {
      pushIssue(errors, {
        code: `strict_${warning.code}`,
        message: warning.message,
        detail: warning.detail ?? null
      });
    }
  }

  const ok = errors.length === 0;
  const failedChecks = checks.filter((check) => check.ok !== true).length;
  const report = normalizeForCanonicalJson(
    {
      schemaVersion: X402_RECEIPT_VERIFICATION_REPORT_SCHEMA_VERSION,
      ok,
      strict: strictMode,
      receiptId: typeof receipt.receiptId === "string" ? receipt.receiptId : null,
      checks,
      warnings,
      errors,
      summary: {
        totalChecks: checks.length,
        failedChecks,
        warningCount: warnings.length,
        errorCount: errors.length
      }
    },
    { path: "$" }
  );
  return report;
}

export function formatX402ReceiptVerificationReportText(report) {
  if (!isPlainObject(report)) throw new TypeError("report must be an object");
  const lines = [];
  lines.push(`receiptId: ${report.receiptId ?? "unknown"}`);
  lines.push(`ok: ${report.ok === true ? "true" : "false"}`);
  lines.push(`checks: ${Number(report?.summary?.totalChecks ?? 0) - Number(report?.summary?.failedChecks ?? 0)}/${report?.summary?.totalChecks ?? 0}`);
  if (Array.isArray(report.errors) && report.errors.length > 0) {
    lines.push("errors:");
    for (const issue of report.errors) {
      lines.push(`  - ${issue.code}: ${issue.message}`);
    }
  }
  if (Array.isArray(report.warnings) && report.warnings.length > 0) {
    lines.push("warnings:");
    for (const issue of report.warnings) {
      lines.push(`  - ${issue.code}: ${issue.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
