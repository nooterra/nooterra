function usageError(message) {
  const err = new Error(message);
  err.code = "INVALID_ARGS";
  return err;
}

export function parseCommonArgs(argv) {
  const out = {
    format: "text",
    explain: false,
    outDir: null,
    keysPath: null,
    trustFile: null,
    signerMode: "local",
    signerUrl: null,
    signerCommand: null,
    signerArgsJson: null,
    signerAuth: null,
    signerTokenEnv: null,
    signerTokenFile: null,
    signerHeaders: [],
    signerPlugin: null,
    signerPluginExport: null,
    signerPluginConfig: null,
    govKeyId: null,
    serverKeyId: null,
    deterministic: false,
    now: null,
    verifyAfter: false,
    hashConcurrency: null,
    strictVerify: true,
    force: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--format") {
      const v = argv[i + 1] ?? null;
      if (v !== "json" && v !== "text") throw usageError("--format must be json or text");
      out.format = v;
      i += 1;
      continue;
    }
    if (a === "--explain") {
      out.explain = true;
      continue;
    }
    if (a === "--out") {
      out.outDir = argv[i + 1] ?? null;
      if (!out.outDir) throw usageError("--out is required");
      i += 1;
      continue;
    }
    if (a === "--keys") {
      out.keysPath = argv[i + 1] ?? null;
      if (!out.keysPath) throw usageError("--keys is required");
      i += 1;
      continue;
    }
    if (a === "--signer") {
      const v = argv[i + 1] ?? null;
      if (v !== "local" && v !== "remote" && v !== "plugin") throw usageError("--signer must be local, remote, or plugin");
      out.signerMode = v;
      i += 1;
      continue;
    }
    if (a === "--signer-url") {
      out.signerUrl = argv[i + 1] ?? null;
      if (!out.signerUrl) throw usageError("--signer-url requires a URL");
      i += 1;
      continue;
    }
    if (a === "--signer-command") {
      out.signerCommand = argv[i + 1] ?? null;
      if (!out.signerCommand) throw usageError("--signer-command requires a command");
      i += 1;
      continue;
    }
    if (a === "--signer-args-json") {
      const raw = argv[i + 1] ?? null;
      if (!raw) throw usageError("--signer-args-json requires a JSON array");
      out.signerArgsJson = raw;
      i += 1;
      continue;
    }
    if (a === "--signer-auth") {
      const v = argv[i + 1] ?? null;
      if (v !== "none" && v !== "bearer") throw usageError("--signer-auth must be none or bearer");
      out.signerAuth = v;
      i += 1;
      continue;
    }
    if (a === "--signer-token-env") {
      out.signerTokenEnv = argv[i + 1] ?? null;
      if (!out.signerTokenEnv) throw usageError("--signer-token-env requires an env var name");
      i += 1;
      continue;
    }
    if (a === "--signer-token-file") {
      out.signerTokenFile = argv[i + 1] ?? null;
      if (!out.signerTokenFile) throw usageError("--signer-token-file requires a path");
      i += 1;
      continue;
    }
    if (a === "--signer-header") {
      const v = argv[i + 1] ?? null;
      if (!v) throw usageError("--signer-header requires a value like 'X-Foo: bar'");
      out.signerHeaders.push(v);
      i += 1;
      continue;
    }
    if (a === "--signer-plugin") {
      out.signerPlugin = argv[i + 1] ?? null;
      if (!out.signerPlugin) throw usageError("--signer-plugin requires a path or package spec");
      i += 1;
      continue;
    }
    if (a === "--signer-plugin-export") {
      out.signerPluginExport = argv[i + 1] ?? null;
      if (!out.signerPluginExport) throw usageError("--signer-plugin-export requires an export name");
      i += 1;
      continue;
    }
    if (a === "--signer-plugin-config") {
      out.signerPluginConfig = argv[i + 1] ?? null;
      if (!out.signerPluginConfig) throw usageError("--signer-plugin-config requires a JSON file path");
      i += 1;
      continue;
    }
    if (a === "--gov-key-id") {
      out.govKeyId = argv[i + 1] ?? null;
      if (!out.govKeyId) throw usageError("--gov-key-id requires a keyId");
      i += 1;
      continue;
    }
    if (a === "--server-key-id") {
      out.serverKeyId = argv[i + 1] ?? null;
      if (!out.serverKeyId) throw usageError("--server-key-id requires a keyId");
      i += 1;
      continue;
    }
    if (a === "--trust-file") {
      out.trustFile = argv[i + 1] ?? null;
      if (!out.trustFile) throw usageError("--trust-file requires a path");
      i += 1;
      continue;
    }
    if (a === "--deterministic") {
      out.deterministic = true;
      continue;
    }
    if (a === "--now") {
      out.now = argv[i + 1] ?? null;
      if (!out.now) throw usageError("--now requires an ISO8601 timestamp");
      i += 1;
      continue;
    }
    if (a === "--verify-after") {
      out.verifyAfter = true;
      continue;
    }
    if (a === "--hash-concurrency") {
      const raw = argv[i + 1] ?? null;
      if (!raw) throw usageError("--hash-concurrency requires a number");
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) throw usageError("--hash-concurrency must be a positive number");
      out.hashConcurrency = Math.floor(n);
      i += 1;
      continue;
    }
    if (a === "--nonstrict") {
      out.strictVerify = false;
      continue;
    }
    if (a === "--strict") {
      out.strictVerify = true;
      continue;
    }
    if (a === "--force") {
      out.force = true;
      continue;
    }
  }

  return out;
}

export function resolveNowIso({ deterministic, nowFlag, env = process.env } = {}) {
  const fromFlag = typeof nowFlag === "string" && nowFlag.trim() ? nowFlag.trim() : null;
  if (fromFlag) {
    const ms = Date.parse(fromFlag);
    if (!Number.isFinite(ms)) throw usageError("--now must be an ISO8601 timestamp");
    return new Date(ms).toISOString();
  }

  const fromEnv = typeof env.SOURCE_DATE_EPOCH === "string" && env.SOURCE_DATE_EPOCH.trim() ? env.SOURCE_DATE_EPOCH.trim() : null;
  if (deterministic && fromEnv) {
    const n = Number(fromEnv);
    if (!Number.isFinite(n) || n < 0) throw usageError("SOURCE_DATE_EPOCH must be a non-negative number (seconds)");
    const ms = n > 1e12 ? n : n * 1000;
    return new Date(ms).toISOString();
  }

  if (deterministic) {
    // Stable default: Unix epoch.
    return new Date(0).toISOString();
  }

  return new Date().toISOString();
}
