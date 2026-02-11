import { readFile } from "node:fs/promises";

export const LIGHTHOUSE_ACTIVE_STATUSES = Object.freeze([
  "paid_production_settlement_confirmed",
  "production_active"
]);

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isIsoTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  return Number.isFinite(Date.parse(value));
}

export function evaluateLighthouseTracker(parsed) {
  const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
  const requiredActiveAccounts =
    Number.isSafeInteger(Number(parsed?.requiredActiveAccounts)) && Number(parsed.requiredActiveAccounts) > 0
      ? Number(parsed.requiredActiveAccounts)
      : 3;
  const activeStatuses = new Set(LIGHTHOUSE_ACTIVE_STATUSES);
  const duplicateAccountIds = [];
  const seenAccountIds = new Set();

  const accountChecks = accounts.map((row, index) => {
    const accountId = asNonEmptyString(row?.accountId) ?? `unknown_${index + 1}`;
    if (seenAccountIds.has(accountId)) duplicateAccountIds.push(accountId);
    seenAccountIds.add(accountId);

    const status = String(row?.status ?? "").toLowerCase();
    const isActive = activeStatuses.has(status);
    const signedAt = asNonEmptyString(row?.signedAt);
    const goLiveAt = asNonEmptyString(row?.goLiveAt);
    const settlementRef = asNonEmptyString(row?.productionSettlementRef);
    const missing = [];
    const errors = [];

    if (isActive) {
      if (!signedAt) missing.push("signedAt");
      if (!goLiveAt) missing.push("goLiveAt");
      if (!settlementRef) missing.push("productionSettlementRef");
      if (signedAt && !isIsoTimestamp(signedAt)) errors.push("signedAt_invalid_iso");
      if (goLiveAt && !isIsoTimestamp(goLiveAt)) errors.push("goLiveAt_invalid_iso");
      if (signedAt && goLiveAt && isIsoTimestamp(signedAt) && isIsoTimestamp(goLiveAt)) {
        const signedAtMs = Date.parse(signedAt);
        const goLiveAtMs = Date.parse(goLiveAt);
        if (goLiveAtMs < signedAtMs) errors.push("goLiveAt_before_signedAt");
      }
    }

    return {
      accountId,
      status,
      isActive,
      ready: isActive && missing.length === 0 && errors.length === 0,
      missing,
      errors
    };
  });

  const readyActive = accountChecks.filter((row) => row.ready);
  const incompleteActive = accountChecks.filter((row) => row.isActive && row.ready !== true);
  const trackerErrors = [];
  if (duplicateAccountIds.length) {
    trackerErrors.push({
      code: "duplicate_account_id",
      accountIds: Array.from(new Set(duplicateAccountIds)).sort()
    });
  }
  const integrityOk = trackerErrors.length === 0;

  return {
    ok: readyActive.length >= requiredActiveAccounts && integrityOk,
    totalAccounts: accounts.length,
    activeAccounts: readyActive.length,
    requiredActiveAccounts,
    eligibleStatuses: Array.from(activeStatuses),
    incompleteActiveAccounts: incompleteActive,
    errors: trackerErrors,
    accounts: accountChecks
  };
}

export async function loadLighthouseTrackerFromPath(pathname) {
  const raw = await readFile(pathname, "utf8");
  const parsed = JSON.parse(raw);
  return evaluateLighthouseTracker(parsed);
}
