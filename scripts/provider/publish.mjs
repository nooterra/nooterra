#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { keyIdFromPublicKeyPem, sha256Hex } from "../../src/core/crypto.js";
import { computePaidToolManifestHashV1, normalizePaidToolManifestV1 } from "../../src/core/paid-tool-manifest.js";
import {
  PROVIDER_PUBLISH_PROOF_AUDIENCE,
  PROVIDER_PUBLISH_PROOF_TYPE,
  mintProviderPublishProofTokenV1
} from "../../src/core/provider-publish-proof.js";

function usage() {
  return [
    "Usage:",
    "  node scripts/provider/publish.mjs --manifest <file> --base-url <providerBaseUrl> [options]",
    "",
    "Options:",
    "  --api-url <url>              Settld API base URL (default: SETTLD_API_URL or http://127.0.0.1:3000)",
    "  --api-key <token>            Settld API key (default: SETTLD_API_KEY)",
    "  --tenant-id <id>             Tenant id header (default: SETTLD_TENANT_ID or tenant_default)",
    "  --provider-id <providerId>   Override provider id (must match manifest.providerId)",
    "  --tool-id <toolId>           Conformance tool id override",
    "  --provider-key-file <path>   Provider signing public key PEM file",
    "  --provider-key-pem <pem>     Provider signing public key PEM inline",
    "  --publish-proof <jws>        Provider publish proof JWS token (manual mode)",
    "  --publish-proof-jwks-url <url> Provider JWKS URL (must match manifest.publishProofJwksUrl)",
    "  --jwks-url <url>             Alias for --publish-proof-jwks-url",
    "  --publish-proof-key-file <path> Ed25519 private key (PEM or JWK JSON) for auto-mint mode",
    "  --publish-proof-key-pem <pem> Inline Ed25519 private key for auto-mint mode",
    "  --key <path>                 Alias for --publish-proof-key-file",
    "  --kid <kid>                  Optional key id (default: derived from key)",
    "  --expires-in <seconds>       Publish proof TTL in seconds (default: 300)",
    "  --description <text>         Provider description",
    "  --contact-url <url>          Provider contact/support URL",
    "  --terms-url <url>            Provider terms URL",
    "  --tags <a,b,c>               Comma-separated tags",
    "  --no-conformance             Publish as draft (skip conformance)",
    "  --allow-fail                 Exit 0 even when conformance fails",
    "  --json-out <file>            Write publication JSON to file",
    "  --conformance-json-out <file> Write conformance report JSON to file",
    "  --help                       Show this help"
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    apiUrl: process.env.SETTLD_API_URL || "http://127.0.0.1:3000",
    apiKey: process.env.SETTLD_API_KEY || null,
    tenantId: process.env.SETTLD_TENANT_ID || "tenant_default",
    manifestPath: null,
    baseUrl: null,
    providerId: null,
    toolId: null,
    providerKeyFile: null,
    providerKeyPem: null,
    publishProof: process.env.SETTLD_PROVIDER_PUBLISH_PROOF || null,
    publishProofJwksUrl: process.env.SETTLD_PROVIDER_PUBLISH_PROOF_JWKS_URL || null,
    publishProofKeyFile: process.env.SETTLD_PROVIDER_PUBLISH_PROOF_KEY_FILE || null,
    publishProofKeyPem: process.env.SETTLD_PROVIDER_PUBLISH_PROOF_KEY_PEM || null,
    publishProofKid: process.env.SETTLD_PROVIDER_PUBLISH_PROOF_KID || null,
    publishProofExpiresInSeconds:
      process.env.SETTLD_PROVIDER_PUBLISH_PROOF_EXPIRES_IN &&
      String(process.env.SETTLD_PROVIDER_PUBLISH_PROOF_EXPIRES_IN).trim() !== ""
        ? Number(process.env.SETTLD_PROVIDER_PUBLISH_PROOF_EXPIRES_IN)
        : 300,
    description: null,
    contactUrl: null,
    termsUrl: null,
    tags: [],
    runConformance: true,
    allowFail: false,
    jsonOut: null,
    conformanceJsonOut: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--no-conformance") out.runConformance = false;
    else if (arg === "--allow-fail") out.allowFail = true;
    else if (arg === "--manifest") out.manifestPath = String(argv[++i] ?? "").trim();
    else if (arg === "--base-url") out.baseUrl = String(argv[++i] ?? "").trim();
    else if (arg === "--api-url") out.apiUrl = String(argv[++i] ?? "").trim();
    else if (arg === "--api-key") out.apiKey = String(argv[++i] ?? "").trim();
    else if (arg === "--tenant-id") out.tenantId = String(argv[++i] ?? "").trim();
    else if (arg === "--provider-id") out.providerId = String(argv[++i] ?? "").trim();
    else if (arg === "--tool-id") out.toolId = String(argv[++i] ?? "").trim();
    else if (arg === "--provider-key-file") out.providerKeyFile = String(argv[++i] ?? "").trim();
    else if (arg === "--provider-key-pem") out.providerKeyPem = String(argv[++i] ?? "").trim();
    else if (arg === "--publish-proof") out.publishProof = String(argv[++i] ?? "").trim();
    else if (arg === "--publish-proof-jwks-url") out.publishProofJwksUrl = String(argv[++i] ?? "").trim();
    else if (arg === "--jwks-url") out.publishProofJwksUrl = String(argv[++i] ?? "").trim();
    else if (arg === "--publish-proof-key-file" || arg === "--key") out.publishProofKeyFile = String(argv[++i] ?? "").trim();
    else if (arg === "--publish-proof-key-pem") out.publishProofKeyPem = String(argv[++i] ?? "").trim();
    else if (arg === "--kid") out.publishProofKid = String(argv[++i] ?? "").trim();
    else if (arg === "--expires-in") out.publishProofExpiresInSeconds = Number(argv[++i] ?? "");
    else if (arg === "--description") out.description = String(argv[++i] ?? "").trim();
    else if (arg === "--contact-url") out.contactUrl = String(argv[++i] ?? "").trim();
    else if (arg === "--terms-url") out.termsUrl = String(argv[++i] ?? "").trim();
    else if (arg === "--tags") {
      out.tags = String(argv[++i] ?? "")
        .split(",")
        .map((row) => row.trim())
        .filter(Boolean);
    } else if (arg === "--json-out") out.jsonOut = String(argv[++i] ?? "").trim();
    else if (arg === "--conformance-json-out") out.conformanceJsonOut = String(argv[++i] ?? "").trim();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.help) {
    if (!out.manifestPath) throw new Error("--manifest is required");
    if (!out.baseUrl) throw new Error("--base-url is required");
    if (!Number.isSafeInteger(Number(out.publishProofExpiresInSeconds)) || Number(out.publishProofExpiresInSeconds) <= 0) {
      throw new Error("--expires-in must be a positive integer");
    }
  }
  return out;
}

function readJson(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  return JSON.parse(raw);
}

function resolveProviderKeyPem({ inlinePem, filePath }) {
  if (typeof inlinePem === "string" && inlinePem.trim() !== "") return inlinePem;
  if (typeof filePath === "string" && filePath.trim() !== "") {
    const resolved = path.resolve(process.cwd(), filePath);
    return fs.readFileSync(resolved, "utf8");
  }
  return null;
}

function resolvePrivateKeyPem({ inlinePem, filePath }) {
  let raw = null;
  if (typeof inlinePem === "string" && inlinePem.trim() !== "") raw = inlinePem.trim();
  else if (typeof filePath === "string" && filePath.trim() !== "") {
    const resolved = path.resolve(process.cwd(), filePath);
    raw = fs.readFileSync(resolved, "utf8").trim();
  }
  if (!raw) return null;

  if (raw.startsWith("{")) {
    let jwk = null;
    try {
      jwk = JSON.parse(raw);
    } catch (err) {
      throw makeCliError("PROVIDER_PUBLISH_INVALID_PRIVATE_KEY", "failed to parse JWK JSON private key", { message: err?.message ?? String(err ?? "") });
    }
    try {
      return crypto.createPrivateKey({ key: jwk, format: "jwk" }).export({ format: "pem", type: "pkcs8" }).toString();
    } catch (err) {
      throw makeCliError("PROVIDER_PUBLISH_INVALID_PRIVATE_KEY", "invalid JWK private key", { message: err?.message ?? String(err ?? "") });
    }
  }

  return raw;
}

function derivePublicKeyPemFromPrivateKeyPem(privateKeyPem) {
  try {
    return crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem)).export({ format: "pem", type: "spki" }).toString();
  } catch (err) {
    throw makeCliError("PROVIDER_PUBLISH_INVALID_PRIVATE_KEY", "failed to derive public key from private key", {
      message: err?.message ?? String(err ?? "")
    });
  }
}

function writeJsonFile(filePath, value) {
  const resolved = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function defaultConformanceOutPath(publicationOutPath) {
  if (typeof publicationOutPath !== "string" || publicationOutPath.trim() === "") return null;
  const resolved = path.resolve(process.cwd(), publicationOutPath);
  if (resolved.endsWith(".json")) return resolved.slice(0, -".json".length) + ".conformance.json";
  return `${resolved}.conformance.json`;
}

function toPublicationSummary(publication) {
  return {
    providerId: publication?.providerId ?? null,
    status: publication?.status ?? null,
    certified: publication?.certified === true,
    publicationId: publication?.publicationId ?? null,
    manifestHash: publication?.manifestHash ?? null
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function makeCliError(code, message, details = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function normalizeOptionalAbsoluteUrl(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  let parsed = null;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw makeCliError("PROVIDER_PUBLISH_INVALID_URL", `${fieldName} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw makeCliError("PROVIDER_PUBLISH_INVALID_URL", `${fieldName} must use http or https`);
  }
  return parsed.toString();
}

function buildPublishProofInput({ args, manifest, providerId }) {
  const manifestPublishProofJwksUrl = normalizeOptionalAbsoluteUrl(
    manifest?.publishProofJwksUrl ?? null,
    "manifest.publishProofJwksUrl"
  );
  if (!manifestPublishProofJwksUrl) {
    throw makeCliError(
      "PROVIDER_PUBLISH_MISSING_MANIFEST_PUBLISH_PROOF_JWKS_URL",
      "manifest.publishProofJwksUrl is required"
    );
  }
  const cliPublishProofJwksUrl = normalizeOptionalAbsoluteUrl(args.publishProofJwksUrl ?? null, "publishProofJwksUrl");
  if (cliPublishProofJwksUrl && cliPublishProofJwksUrl !== manifestPublishProofJwksUrl) {
    throw makeCliError(
      "PROVIDER_PUBLISH_JWKS_URL_MISMATCH",
      "--publish-proof-jwks-url must match manifest.publishProofJwksUrl",
      {
        expected: manifestPublishProofJwksUrl,
        actual: cliPublishProofJwksUrl
      }
    );
  }
  const publishProofJwksUrl = cliPublishProofJwksUrl || manifestPublishProofJwksUrl;
  if (!publishProofJwksUrl) {
    throw makeCliError(
      "PROVIDER_PUBLISH_MISSING_PUBLISH_PROOF_JWKS_URL",
      "publish proof requires --publish-proof-jwks-url (or --jwks-url)"
    );
  }

  const manualPublishProof = typeof args.publishProof === "string" && args.publishProof.trim() !== "" ? args.publishProof.trim() : null;
  if (manualPublishProof) {
    return {
      publishProof: manualPublishProof,
      publishProofJwksUrl,
      mode: "manual",
      publishProofKid: null,
      publishProofTokenSha256: sha256Hex(manualPublishProof)
    };
  }

  const privateKeyPem = resolvePrivateKeyPem({
    inlinePem: args.publishProofKeyPem,
    filePath: args.publishProofKeyFile
  });
  if (!privateKeyPem) {
    throw makeCliError(
      "PROVIDER_PUBLISH_MISSING_PUBLISH_PROOF",
      "provide --publish-proof (manual) or --publish-proof-key-file/--key (auto-mint)"
    );
  }

  const publicKeyPem = derivePublicKeyPemFromPrivateKeyPem(privateKeyPem);
  const derivedKid = keyIdFromPublicKeyPem(publicKeyPem);
  const normalizedKid =
    typeof args.publishProofKid === "string" && args.publishProofKid.trim() !== "" ? args.publishProofKid.trim() : derivedKid;
  if (normalizedKid !== derivedKid) {
    throw makeCliError("PROVIDER_PUBLISH_KID_MISMATCH", "--kid does not match the provided private key", {
      expectedKid: derivedKid,
      actualKid: normalizedKid
    });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = Number(args.publishProofExpiresInSeconds);
  const manifestHash = computePaidToolManifestHashV1(manifest);
  const minted = mintProviderPublishProofTokenV1({
    payload: {
      aud: PROVIDER_PUBLISH_PROOF_AUDIENCE,
      typ: PROVIDER_PUBLISH_PROOF_TYPE,
      manifestHash,
      providerId,
      iat: nowSec,
      exp: nowSec + ttlSec
    },
    keyId: normalizedKid,
    publicKeyPem,
    privateKeyPem
  });
  return {
    publishProof: minted.token,
    publishProofJwksUrl,
    mode: "auto_minted",
    publishProofKid: minted.kid ?? normalizedKid,
    publishProofTokenSha256: minted.tokenSha256 ?? sha256Hex(minted.token)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.apiKey) throw makeCliError("PROVIDER_PUBLISH_MISSING_API_KEY", "SETTLD_API_KEY or --api-key is required");

  const manifest = normalizePaidToolManifestV1(readJson(args.manifestPath));
  const effectiveProviderId = args.providerId || manifest.providerId;
  if (effectiveProviderId !== String(manifest.providerId)) {
    throw makeCliError("PROVIDER_PUBLISH_PROVIDER_ID_MISMATCH", "--provider-id must match manifest.providerId", {
      providerId: effectiveProviderId,
      manifestProviderId: manifest.providerId
    });
  }
  const providerSigningPublicKeyPem = resolveProviderKeyPem({ inlinePem: args.providerKeyPem, filePath: args.providerKeyFile });
  const publishProofInput = buildPublishProofInput({
    args,
    manifest,
    providerId: effectiveProviderId
  });

  const response = await fetch(new URL("/marketplace/providers/publish", args.apiUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      "x-proxy-tenant-id": args.tenantId,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      providerId: effectiveProviderId || null,
      baseUrl: args.baseUrl,
      toolId: args.toolId || null,
      providerSigningPublicKeyPem,
      publishProof: publishProofInput.publishProof,
      publishProofJwksUrl: publishProofInput.publishProofJwksUrl,
      runConformance: args.runConformance,
      description: args.description,
      contactUrl: args.contactUrl,
      termsUrl: args.termsUrl,
      tags: args.tags,
      manifest
    })
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw makeCliError("PROVIDER_PUBLISH_REQUEST_FAILED", "publish failed", {
      statusCode: response.status,
      response: json ?? text ?? null
    });
  }
  const publication = json?.publication ?? null;
  if (!publication || typeof publication !== "object") {
    throw makeCliError("PROVIDER_PUBLISH_INVALID_RESPONSE", "publish response missing publication");
  }

  if (args.jsonOut) {
    writeJsonFile(args.jsonOut, publication);
  }
  const conformanceReport = publication?.conformanceReport ?? null;
  const conformanceOutPath = args.conformanceJsonOut || defaultConformanceOutPath(args.jsonOut);
  if (conformanceOutPath && conformanceReport && typeof conformanceReport === "object" && !Array.isArray(conformanceReport)) {
    writeJsonFile(conformanceOutPath, conformanceReport);
  }

  const summary = {
    ...toPublicationSummary(publication),
    providerRef: publication?.providerRef ?? null,
    publishProofMode: publishProofInput.mode,
    publishProofKid: publishProofInput.publishProofKid ?? null,
    publishProofTokenSha256: publishProofInput.publishProofTokenSha256 ?? null,
    conformanceVerdict: conformanceReport?.verdict ?? null,
    publicationJsonOut: args.jsonOut ? path.resolve(process.cwd(), args.jsonOut) : null,
    conformanceJsonOut: conformanceOutPath ?? null
  };
  const conformanceFailed = args.runConformance !== false && publication.certified !== true;
  if (conformanceFailed) {
    const payload = {
      ok: false,
      code: "PROVIDER_PUBLISH_CONFORMANCE_FAILED",
      message: "provider publication is not certified",
      allowFailApplied: args.allowFail === true,
      ...summary
    };
    printJson(payload);
    if (!args.allowFail) process.exitCode = 1;
    return;
  }

  printJson({
    ok: true,
    ...summary
  });
}

main().catch((err) => {
  printJson({
    ok: false,
    code: typeof err?.code === "string" && err.code.trim() !== "" ? err.code : "PROVIDER_PUBLISH_CLI_ERROR",
    message: err?.message ?? String(err ?? ""),
    details: err?.details ?? null
  });
  process.exit(1);
});
