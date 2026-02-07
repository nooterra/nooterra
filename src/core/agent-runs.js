export const AGENT_RUN_SCHEMA_VERSION = "AgentRun.v1";
export const AGENT_RUN_EVENT_SCHEMA_VERSION = "AgentEvent.v1";

export const AGENT_RUN_STATUS = Object.freeze({
  CREATED: "created",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed"
});

export const AGENT_RUN_EVENT_TYPE = Object.freeze({
  RUN_CREATED: "RUN_CREATED",
  RUN_STARTED: "RUN_STARTED",
  RUN_HEARTBEAT: "RUN_HEARTBEAT",
  EVIDENCE_ADDED: "EVIDENCE_ADDED",
  RUN_COMPLETED: "RUN_COMPLETED",
  RUN_FAILED: "RUN_FAILED"
});

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function assertIsoDate(value, name) {
  assertNonEmptyString(value, name);
  const t = Date.parse(value);
  if (!Number.isFinite(t)) throw new TypeError(`${name} must be an ISO date string`);
}

function assertOptionalString(value, name) {
  if (value === undefined || value === null) return;
  assertNonEmptyString(value, name);
}

export function validateRunCreatedPayload(payload) {
  assertPlainObject(payload, "payload");
  assertNonEmptyString(payload.runId, "payload.runId");
  assertNonEmptyString(payload.agentId, "payload.agentId");
  assertNonEmptyString(payload.tenantId, "payload.tenantId");
  assertOptionalString(payload.taskType, "payload.taskType");
  assertOptionalString(payload.inputRef, "payload.inputRef");
  return payload;
}

export function validateRunStartedPayload(payload) {
  assertPlainObject(payload, "payload");
  assertNonEmptyString(payload.runId, "payload.runId");
  assertOptionalString(payload.startedBy, "payload.startedBy");
  return payload;
}

export function validateRunHeartbeatPayload(payload) {
  assertPlainObject(payload, "payload");
  assertNonEmptyString(payload.runId, "payload.runId");
  if (payload.progressPct !== undefined && payload.progressPct !== null) {
    if (!Number.isFinite(payload.progressPct)) throw new TypeError("payload.progressPct must be a finite number");
    if (payload.progressPct < 0 || payload.progressPct > 100) throw new TypeError("payload.progressPct must be within 0..100");
  }
  assertOptionalString(payload.stage, "payload.stage");
  return payload;
}

export function validateEvidenceAddedPayload(payload) {
  assertPlainObject(payload, "payload");
  assertNonEmptyString(payload.runId, "payload.runId");
  assertNonEmptyString(payload.evidenceRef, "payload.evidenceRef");
  return payload;
}

export function validateRunCompletedPayload(payload) {
  assertPlainObject(payload, "payload");
  assertNonEmptyString(payload.runId, "payload.runId");
  assertOptionalString(payload.outputRef, "payload.outputRef");
  if (payload.metrics !== undefined && payload.metrics !== null) assertPlainObject(payload.metrics, "payload.metrics");
  return payload;
}

export function validateRunFailedPayload(payload) {
  assertPlainObject(payload, "payload");
  assertNonEmptyString(payload.runId, "payload.runId");
  assertOptionalString(payload.code, "payload.code");
  assertOptionalString(payload.message, "payload.message");
  return payload;
}

function validatePayloadForType(type, payload) {
  if (type === AGENT_RUN_EVENT_TYPE.RUN_CREATED) return validateRunCreatedPayload(payload);
  if (type === AGENT_RUN_EVENT_TYPE.RUN_STARTED) return validateRunStartedPayload(payload);
  if (type === AGENT_RUN_EVENT_TYPE.RUN_HEARTBEAT) return validateRunHeartbeatPayload(payload);
  if (type === AGENT_RUN_EVENT_TYPE.EVIDENCE_ADDED) return validateEvidenceAddedPayload(payload);
  if (type === AGENT_RUN_EVENT_TYPE.RUN_COMPLETED) return validateRunCompletedPayload(payload);
  if (type === AGENT_RUN_EVENT_TYPE.RUN_FAILED) return validateRunFailedPayload(payload);
  throw new TypeError(`unsupported agent run event type: ${type}`);
}

function isTerminalStatus(status) {
  return status === AGENT_RUN_STATUS.COMPLETED || status === AGENT_RUN_STATUS.FAILED;
}

export function reduceAgentRun(events) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  if (events.length === 0) return null;

  let run = null;
  let revision = 0;

  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("event must be an object");
    assertNonEmptyString(event.type, "event.type");
    assertNonEmptyString(event.streamId, "event.streamId");
    assertIsoDate(event.at, "event.at");
    const payload = event.payload ?? {};
    validatePayloadForType(event.type, payload);

    if (event.type === AGENT_RUN_EVENT_TYPE.RUN_CREATED) {
      if (run) throw new TypeError("run stream already initialized");
      if (payload.runId !== event.streamId) throw new TypeError("payload.runId must match streamId");
      run = {
        schemaVersion: AGENT_RUN_SCHEMA_VERSION,
        runId: payload.runId,
        agentId: payload.agentId,
        tenantId: payload.tenantId,
        taskType: payload.taskType ?? null,
        inputRef: payload.inputRef ?? null,
        status: AGENT_RUN_STATUS.CREATED,
        evidenceRefs: [],
        metrics: null,
        failure: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        revision,
        createdAt: event.at,
        updatedAt: event.at,
        lastEventId: event.id ?? null,
        lastChainHash: event.chainHash ?? null
      };
      continue;
    }

    if (!run) throw new TypeError("run stream is missing RUN_CREATED");
    if (payload.runId && payload.runId !== run.runId) throw new TypeError("payload.runId must match runId");

    if (event.type === AGENT_RUN_EVENT_TYPE.RUN_STARTED) {
      if (isTerminalStatus(run.status)) throw new TypeError("cannot start a terminal run");
      run.status = AGENT_RUN_STATUS.RUNNING;
      run.startedAt = run.startedAt ?? event.at;
    } else if (event.type === AGENT_RUN_EVENT_TYPE.RUN_HEARTBEAT) {
      if (run.status === AGENT_RUN_STATUS.CREATED) {
        run.status = AGENT_RUN_STATUS.RUNNING;
        run.startedAt = run.startedAt ?? event.at;
      }
      if (isTerminalStatus(run.status)) throw new TypeError("cannot heartbeat a terminal run");
    } else if (event.type === AGENT_RUN_EVENT_TYPE.EVIDENCE_ADDED) {
      if (isTerminalStatus(run.status)) throw new TypeError("cannot append evidence to a terminal run");
      const evidenceRef = String(payload.evidenceRef);
      if (!run.evidenceRefs.includes(evidenceRef)) run.evidenceRefs.push(evidenceRef);
      run.evidenceRefs.sort((a, b) => a.localeCompare(b));
    } else if (event.type === AGENT_RUN_EVENT_TYPE.RUN_COMPLETED) {
      if (isTerminalStatus(run.status)) throw new TypeError("run already terminal");
      run.status = AGENT_RUN_STATUS.COMPLETED;
      run.startedAt = run.startedAt ?? event.at;
      run.completedAt = event.at;
      run.failedAt = null;
      run.failure = null;
      run.metrics = payload.metrics && typeof payload.metrics === "object" && !Array.isArray(payload.metrics) ? { ...payload.metrics } : run.metrics;
    } else if (event.type === AGENT_RUN_EVENT_TYPE.RUN_FAILED) {
      if (isTerminalStatus(run.status)) throw new TypeError("run already terminal");
      run.status = AGENT_RUN_STATUS.FAILED;
      run.startedAt = run.startedAt ?? event.at;
      run.failedAt = event.at;
      run.completedAt = null;
      run.failure = {
        code: payload.code ?? null,
        message: payload.message ?? null
      };
    } else {
      throw new TypeError(`unsupported event type: ${event.type}`);
    }

    revision += 1;
    run.revision = revision;
    run.updatedAt = event.at;
    run.lastEventId = event.id ?? run.lastEventId ?? null;
    run.lastChainHash = event.chainHash ?? run.lastChainHash ?? null;
  }

  return run;
}

export function computeAgentRunVerification({ run, events = [] } = {}) {
  if (!run || typeof run !== "object") {
    return {
      verificationStatus: "amber",
      runStatus: null,
      reasonCodes: ["RUN_NOT_FOUND"],
      evidenceCount: 0,
      eventCount: Array.isArray(events) ? events.length : 0,
      durationMs: null,
      settlementReleaseRatePct: null
    };
  }

  const evidenceCount = Array.isArray(run.evidenceRefs) ? run.evidenceRefs.length : 0;
  const startedMs = run.startedAt ? Date.parse(run.startedAt) : NaN;
  const endMs = run.completedAt ? Date.parse(run.completedAt) : run.failedAt ? Date.parse(run.failedAt) : NaN;
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(endMs) && endMs >= startedMs ? Math.floor(endMs - startedMs) : null;

  let verificationStatus = "amber";
  const reasonCodes = [];
  let settlementReleaseRatePct = null;
  if (run.status === AGENT_RUN_STATUS.COMPLETED) {
    const metricRateRaw = run?.metrics?.settlementReleaseRatePct;
    const metricRate = Number(metricRateRaw);
    const normalizedRate = Number.isSafeInteger(metricRate) && metricRate >= 0 && metricRate <= 100 ? metricRate : 100;
    settlementReleaseRatePct = normalizedRate;
    if (normalizedRate >= 100) {
      verificationStatus = "green";
    } else if (normalizedRate <= 0) {
      verificationStatus = "red";
      reasonCodes.push("RUN_COMPLETED_ZERO_SETTLEMENT");
    } else {
      verificationStatus = "amber";
      reasonCodes.push("RUN_COMPLETED_PARTIAL_SETTLEMENT");
    }
  } else if (run.status === AGENT_RUN_STATUS.FAILED) {
    verificationStatus = "red";
    reasonCodes.push("RUN_FAILED");
    if (typeof run.failure?.code === "string" && run.failure.code.trim() !== "") reasonCodes.push(`RUN_FAILED_${run.failure.code}`);
    settlementReleaseRatePct = 0;
  } else if (run.status === AGENT_RUN_STATUS.RUNNING) {
    reasonCodes.push("RUN_IN_PROGRESS");
  } else {
    reasonCodes.push("RUN_CREATED_NOT_STARTED");
  }

  return {
    verificationStatus,
    runStatus: run.status ?? null,
    reasonCodes,
    evidenceCount,
    eventCount: Array.isArray(events) ? events.length : 0,
    durationMs,
    settlementReleaseRatePct
  };
}
