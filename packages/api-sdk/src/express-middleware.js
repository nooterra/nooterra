import {
  SettldWebhookNoMatchingSignatureError,
  SettldWebhookSignatureHeaderError,
  SettldWebhookTimestampToleranceError,
  verifySettldWebhookSignature
} from "./webhook-signature.js";

function isBodyVerifiable(body) {
  if (body === null || body === undefined) return false;
  if (typeof body === "string") return true;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) return true;
  if (body instanceof Uint8Array) return true;
  if (body instanceof ArrayBuffer) return true;
  return false;
}

function readHeader(req, headerName) {
  const key = String(headerName || "").toLowerCase();
  if (typeof req?.get === "function") {
    return req.get(key) ?? req.get(headerName) ?? null;
  }
  const headers = req?.headers;
  if (!headers || typeof headers !== "object") return null;
  const direct = headers[key];
  if (Array.isArray(direct)) return direct[0] ?? null;
  if (typeof direct === "string") return direct;
  const alt = headers[headerName];
  if (Array.isArray(alt)) return alt[0] ?? null;
  return typeof alt === "string" ? alt : null;
}

function resolveMiddlewareOptions(optionsOrTolerance) {
  if (optionsOrTolerance === undefined || optionsOrTolerance === null) {
    return {
      toleranceSeconds: 300,
      signatureHeaderName: "x-settld-signature",
      timestampHeaderName: "x-settld-timestamp"
    };
  }
  if (typeof optionsOrTolerance === "number") {
    return {
      toleranceSeconds: optionsOrTolerance,
      signatureHeaderName: "x-settld-signature",
      timestampHeaderName: "x-settld-timestamp"
    };
  }
  if (typeof optionsOrTolerance !== "object" || Array.isArray(optionsOrTolerance)) {
    throw new TypeError("options must be a number or plain object");
  }
  return {
    toleranceSeconds:
      optionsOrTolerance.toleranceSeconds === undefined || optionsOrTolerance.toleranceSeconds === null
        ? 300
        : Number(optionsOrTolerance.toleranceSeconds),
    signatureHeaderName: optionsOrTolerance.signatureHeaderName || "x-settld-signature",
    timestampHeaderName: optionsOrTolerance.timestampHeaderName || "x-settld-timestamp"
  };
}

function writeErrorResponse(res, statusCode, code, message) {
  if (typeof res?.status === "function") {
    const withStatus = res.status(statusCode);
    if (typeof withStatus?.json === "function") {
      withStatus.json({
        ok: false,
        error: { code, message }
      });
      return;
    }
    if (typeof withStatus?.send === "function") {
      withStatus.send(message);
      return;
    }
  }
  if (typeof res?.writeHead === "function") {
    res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    if (typeof res?.end === "function") {
      res.end(JSON.stringify({ ok: false, error: { code, message } }));
      return;
    }
  }
  if (typeof res?.end === "function") {
    res.end(JSON.stringify({ ok: false, error: { code, message } }));
  }
}

function classifyVerificationError(err) {
  if (err instanceof SettldWebhookSignatureHeaderError) {
    return {
      status: 400,
      code: err.code || "SETTLD_WEBHOOK_SIGNATURE_HEADER_INVALID",
      message: err.message
    };
  }
  if (err instanceof SettldWebhookTimestampToleranceError) {
    return {
      status: 401,
      code: err.code || "SETTLD_WEBHOOK_TIMESTAMP_OUTSIDE_TOLERANCE",
      message: err.message
    };
  }
  if (err instanceof SettldWebhookNoMatchingSignatureError) {
    return {
      status: 401,
      code: err.code || "SETTLD_WEBHOOK_SIGNATURE_NO_MATCH",
      message: err.message
    };
  }
  return {
    status: 401,
    code: "SETTLD_WEBHOOK_UNAUTHORIZED",
    message: err?.message || "webhook signature verification failed"
  };
}

/**
 * Express-style middleware for Settld webhook verification.
 *
 * IMPORTANT:
 * - This requires the raw request body bytes.
 * - Use `req.rawBody` (preferred) or `req.body` as Buffer/string/typed array.
 */
export function verifySettldWebhook(secretOrResolver, optionsOrTolerance = 300) {
  const options = resolveMiddlewareOptions(optionsOrTolerance);
  const resolveSecret =
    typeof secretOrResolver === "function" ? secretOrResolver : () => secretOrResolver;

  return function settldWebhookMiddleware(req, res, next) {
    Promise.resolve()
      .then(() => resolveSecret(req))
      .then((secret) => {
        const rawBody = req?.rawBody ?? req?.body;
        if (!isBodyVerifiable(rawBody)) {
          writeErrorResponse(
            res,
            400,
            "SETTLD_WEBHOOK_RAW_BODY_REQUIRED",
            "Settld Webhook Error: request body is already parsed or missing raw bytes. Configure body-parser to preserve the raw buffer."
          );
          return;
        }

        const signatureHeader = readHeader(req, options.signatureHeaderName);
        const timestampHeader = readHeader(req, options.timestampHeaderName);
        verifySettldWebhookSignature(rawBody, signatureHeader ?? "", secret, {
          toleranceSeconds: options.toleranceSeconds,
          timestamp: timestampHeader
        });
        if (typeof next === "function") next();
      })
      .catch((err) => {
        if (err instanceof TypeError && /secret is required/.test(String(err.message))) {
          if (typeof next === "function") {
            next(err);
            return;
          }
        }
        const classified = classifyVerificationError(err);
        writeErrorResponse(res, classified.status, classified.code, classified.message);
      });
  };
}

