import { FastifyInstance } from "fastify";

const DEFAULT_KEYS = [
  "password",
  "token",
  "apiKey",
  "authorization",
  "auth",
  "wallet",
  "secret",
  "privateKey",
  "publicKey",
  "x-api-key",
  "x-nooterra-signature",
  "signature",
  "headers.authorization",
];

function redactValue(value: any): any {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > 8 ? "***REDACTED***" : "***";
  }
  if (typeof value === "object") {
    const clone: any = Array.isArray(value) ? [] : {};
    for (const k of Object.keys(value)) {
      if (DEFAULT_KEYS.includes(k.toLowerCase())) {
        clone[k] = "***REDACTED***";
      } else {
        clone[k] = redactValue((value as any)[k]);
      }
    }
    return clone;
  }
  return value;
}

export async function registerRedactLogger(app: FastifyInstance<any, any, any, any>) {
  const enabled = process.env.LOG_REDACT === "true";
  if (!enabled) return;

  app.addHook("onSend", async (request, reply, payload) => {
    // Redact common sensitive fields in logged payloads
    try {
      if (typeof payload === "string") {
        return payload;
      }
      return redactValue(payload as any);
    } catch {
      return payload;
    }
  });

  app.addHook("onRequest", async (request, _reply) => {
    // Redact headers/params/body before logging
    (request as any).redacted = {
      headers: redactValue(request.headers),
      params: redactValue(request.params),
      query: redactValue(request.query),
      body: redactValue(request.body),
    };
  });
}
