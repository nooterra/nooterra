const FAILURE_CLASSES = Object.freeze([
  {
    code: "ONBOARDING_AUTH_PUBLIC_SIGNUP_UNAVAILABLE",
    phase: "auth",
    patterns: [/Public signup is unavailable/i, /Public signup is disabled/i],
    remediation:
      "Use `Generate during setup` with an onboarding bootstrap API key, or rerun with `--tenant-id <existing_tenant>`."
  },
  {
    code: "ONBOARDING_AUTH_LOGIN_UNAVAILABLE",
    phase: "auth",
    patterns: [/OTP login is unavailable on this base URL/i, /otp request failed \(403\)/i, /login failed \(403\): forbidden/i],
    remediation:
      "This base URL does not expose public OTP login. Use `Generate during setup` with an onboarding bootstrap API key, or use `Paste existing key`."
  },
  {
    code: "ONBOARDING_AUTH_OTP_INVALID",
    phase: "auth",
    patterns: [/OTP_(INVALID|EXPIRED|CONSUMED|MISSING)/i, /otp code is required/i, /invalid otp/i],
    remediation: "Request a fresh OTP and retry `nooterra login`."
  },
  {
    code: "ONBOARDING_AUTH_TENANT_DISABLED",
    phase: "auth",
    patterns: [
      /buyer OTP login is not enabled for this tenant/i,
      /BUYER_AUTH_DISABLED/i,
      /Saved login session was rejected for this tenant/i
    ],
    remediation:
      "Rerun `nooterra login` without `--tenant-id` to create a fresh tenant, or choose `Generate during setup` / `Paste existing key`."
  },
  {
    code: "ONBOARDING_BOOTSTRAP_FORBIDDEN",
    phase: "bootstrap",
    patterns: [/runtime bootstrap request failed \(403\)/i],
    remediation: "Check onboarding bootstrap API key scopes and tenant binding, then rerun setup."
  },
  {
    code: "ONBOARDING_BOOTSTRAP_UNAUTHORIZED",
    phase: "bootstrap",
    patterns: [/runtime bootstrap request failed \(401\)/i, /unauthorized/i],
    remediation: "Verify API key validity and retry with a fresh key/session."
  },
  {
    code: "ONBOARDING_WALLET_BOOTSTRAP_FAILED",
    phase: "wallet",
    patterns: [/remote wallet bootstrap failed/i, /wallet bootstrap/i],
    remediation: "Switch wallet mode to `none` to finish trust wiring, then run `nooterra wallet status` and retry funding."
  },
  {
    code: "ONBOARDING_BYO_ENV_MISSING",
    phase: "wallet",
    patterns: [/BYO wallet mode missing required env keys/i],
    remediation: "Provide the missing `--wallet-env KEY=VALUE` entries or export required Circle env vars."
  },
  {
    code: "ONBOARDING_HOST_WRITE_FAILED",
    phase: "host",
    patterns: [/host config/i, /path not writable/i],
    remediation: "Use `--dry-run` to inspect target path, then rerun with a writable host config location."
  },
  {
    code: "ONBOARDING_PREFLIGHT_FAILED",
    phase: "preflight",
    patterns: [/preflight failed/i],
    remediation: "Run with `--preflight` and fix the reported failing check before rerunning setup."
  }
]);

export function classifyOnboardingFailure(error) {
  const message = String(error?.message ?? error ?? "").trim();
  if (!message) {
    return {
      code: "ONBOARDING_UNKNOWN_FAILURE",
      phase: "unknown",
      message: "unknown onboarding failure",
      remediation: "Retry setup with `--format json` and inspect the report output."
    };
  }

  for (const failureClass of FAILURE_CLASSES) {
    if (failureClass.patterns.some((pattern) => pattern.test(message))) {
      return {
        code: failureClass.code,
        phase: failureClass.phase,
        message,
        remediation: failureClass.remediation
      };
    }
  }

  return {
    code: "ONBOARDING_UNKNOWN_FAILURE",
    phase: "unknown",
    message,
    remediation: "Retry setup with `--format json` and inspect the report output."
  };
}

export function listOnboardingFailureClasses() {
  return FAILURE_CLASSES.map((item) => ({
    code: item.code,
    phase: item.phase,
    remediation: item.remediation
  }));
}
