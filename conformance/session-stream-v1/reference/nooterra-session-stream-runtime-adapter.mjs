#!/usr/bin/env node

function fail({ caseId, code, message, details = null }) {
  const payload = {
    schemaVersion: "SessionStreamConformanceResponse.v1",
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

function normalizeEventId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseCursor(value) {
  const normalized = normalizeEventId(value);
  if (!normalized) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new TypeError("sinceEventId/Last-Event-ID must match ^[A-Za-z0-9._:-]+$");
  }
  return normalized;
}

function parseEventType(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new TypeError("eventType must be an uppercase enum token");
  }
  return normalized.toUpperCase();
}

function normalizeEventRecord(value) {
  assertObject(value, "event");
  const id = parseCursor(value.id);
  if (!id) throw new TypeError("event.id is required");
  const type = parseEventType(String(value.type ?? ""));
  if (!type) throw new TypeError("event.type is required");
  return {
    id,
    type,
    streamId: typeof value.streamId === "string" && value.streamId.trim() !== "" ? value.streamId.trim() : null,
    payload: value.payload ?? null,
    at: typeof value.at === "string" && value.at.trim() !== "" ? value.at.trim() : null,
    actor: value.actor ?? null,
    signature: value.signature ?? null,
    signerKeyId: value.signerKeyId ?? null,
    chainHash: value.chainHash ?? null,
    prevChainHash: value.prevChainHash ?? null,
    payloadHash: value.payloadHash ?? null,
    v: value.v ?? 1
  };
}

function buildCursorNotFoundDetails({ sessionId, sinceEventId, events, phase }) {
  return {
    reasonCode: "SESSION_EVENT_CURSOR_NOT_FOUND",
    reason: "cursor was not found in current session event timeline",
    phase,
    sessionId,
    sinceEventId,
    eventCount: events.length,
    firstEventId: events.length > 0 ? events[0].id : null,
    lastEventId: events.length > 0 ? events[events.length - 1].id : null
  };
}

function buildInbox({ events, sinceEventId = null, nextSinceEventId = null }) {
  const headEventCount = events.length;
  const headFirstEventId = headEventCount > 0 ? events[0].id : null;
  const headLastEventId = headEventCount > 0 ? events[headEventCount - 1].id : null;
  return {
    ordering: "SESSION_SEQ_ASC",
    deliveryMode: "resume_then_tail",
    headEventCount,
    headFirstEventId,
    headLastEventId,
    sinceEventId: sinceEventId ?? null,
    nextSinceEventId: nextSinceEventId ?? null
  };
}

function headersFromInbox(inbox) {
  return {
    "x-session-events-ordering": String(inbox.ordering ?? "SESSION_SEQ_ASC"),
    "x-session-events-delivery-mode": String(inbox.deliveryMode ?? "resume_then_tail"),
    "x-session-events-head-event-count": String(Number.isFinite(inbox.headEventCount) ? Math.floor(inbox.headEventCount) : 0),
    "x-session-events-head-first-event-id": String(inbox.headFirstEventId ?? ""),
    "x-session-events-head-last-event-id": String(inbox.headLastEventId ?? ""),
    "x-session-events-since-event-id": String(inbox.sinceEventId ?? ""),
    "x-session-events-next-since-event-id": String(inbox.nextSinceEventId ?? "")
  };
}

function runStreamScenario({ fixture }) {
  assertObject(fixture, "fixture");
  const sessionId = parseCursor(fixture.sessionId);
  if (!sessionId) throw new TypeError("fixture.sessionId is required");
  const acl = fixture.acl && typeof fixture.acl === "object" && !Array.isArray(fixture.acl) ? fixture.acl : null;
  if (acl) {
    const principalId = normalizeEventId(acl.principalId);
    const participants = Array.isArray(acl.participants)
      ? acl.participants.map((row) => normalizeEventId(row)).filter(Boolean)
      : [];
    if (!principalId || participants.length === 0 || !participants.includes(principalId)) {
      return {
        ok: false,
        code: "SESSION_ACCESS_DENIED",
        message: "session access denied",
        details: {
          sessionId,
          principalId,
          participants
        }
      };
    }
  }

  const eventType = parseEventType(fixture.eventType ?? null);
  const sinceEventIdFromQuery = parseCursor(fixture.sinceEventIdQuery ?? null);
  const sinceEventIdFromHeader = parseCursor(fixture.lastEventIdHeader ?? null);
  if (sinceEventIdFromQuery && sinceEventIdFromHeader && sinceEventIdFromQuery !== sinceEventIdFromHeader) {
    return {
      ok: false,
      code: "SESSION_EVENT_CURSOR_CONFLICT",
      message: "ambiguous session event cursor",
      details: {
        sessionId,
        sinceEventId: sinceEventIdFromQuery,
        lastEventId: sinceEventIdFromHeader
      }
    };
  }

  const sinceEventId = sinceEventIdFromQuery ?? sinceEventIdFromHeader;
  const eventsBefore = Array.isArray(fixture.eventsBefore) ? fixture.eventsBefore.map((row) => normalizeEventRecord(row)) : [];
  const appendEvents = Array.isArray(fixture.appendEvents) ? fixture.appendEvents.map((row) => normalizeEventRecord(row)) : [];

  let cursorIndex = -1;
  if (sinceEventId) {
    cursorIndex = eventsBefore.findIndex((row) => row.id === sinceEventId);
    if (cursorIndex < 0) {
      return {
        ok: false,
        code: "SESSION_EVENT_CURSOR_INVALID",
        message: "invalid session event cursor",
        details: buildCursorNotFoundDetails({
          sessionId,
          sinceEventId,
          events: eventsBefore,
          phase: "stream_init"
        })
      };
    }
  }

  const readyHeadEventId = eventsBefore.length > 0 ? eventsBefore[eventsBefore.length - 1].id : sinceEventId;
  const readyInbox = buildInbox({ events: eventsBefore, sinceEventId, nextSinceEventId: readyHeadEventId ?? sinceEventId });
  const headers = headersFromInbox(readyInbox);

  const readyFrame = {
    event: "session.ready",
    id: null,
    data: {
      ok: true,
      sessionId,
      eventType,
      sinceEventId,
      eventCount: eventsBefore.length,
      inbox: readyInbox
    }
  };

  const eventsAfter = eventsBefore.concat(appendEvents);
  let lastResolvedCursor = cursorIndex;
  if (sinceEventId && lastResolvedCursor < 0) {
    lastResolvedCursor = eventsAfter.findIndex((row) => row.id === sinceEventId);
    if (lastResolvedCursor < 0) {
      return {
        ok: false,
        code: "SESSION_EVENT_CURSOR_INVALID",
        message: "session event cursor not found",
        details: buildCursorNotFoundDetails({
          sessionId,
          sinceEventId,
          events: eventsAfter,
          phase: "stream_poll"
        })
      };
    }
  }

  const emittedFrames = [];
  let lastDeliveredEventId = sinceEventId;
  const startIndex = Math.max(0, lastResolvedCursor + 1);
  if (startIndex < eventsAfter.length) {
    for (const row of eventsAfter.slice(startIndex)) {
      if (eventType && row.type !== eventType) continue;
      emittedFrames.push({
        event: "session.event",
        id: row.id,
        data: row
      });
      lastDeliveredEventId = row.id;
    }
  }

  const initialHeadEventId = eventsBefore.length > 0 ? eventsBefore[eventsBefore.length - 1].id : null;
  const finalHeadEventId = eventsAfter.length > 0 ? eventsAfter[eventsAfter.length - 1].id : null;
  if (finalHeadEventId !== initialHeadEventId) {
    const watermarkInbox = buildInbox({
      events: eventsAfter,
      sinceEventId,
      nextSinceEventId: finalHeadEventId ?? sinceEventId
    });
    const watermarkEventId =
      watermarkInbox.nextSinceEventId && watermarkInbox.nextSinceEventId !== lastDeliveredEventId ? watermarkInbox.nextSinceEventId : null;
    emittedFrames.push({
      event: "session.watermark",
      id: watermarkEventId,
      data: {
        schemaVersion: "SessionEventStreamWatermark.v1",
        sessionId,
        phase: "stream_poll",
        eventType,
        inbox: watermarkInbox,
        lastDeliveredEventId
      }
    });
  }

  return {
    ok: true,
    result: {
      headers,
      readyFrame,
      emittedFrames,
      cursor: {
        resolvedSinceEventId: sinceEventId,
        headEventIdBefore: initialHeadEventId,
        headEventIdAfter: finalHeadEventId,
        lastDeliveredEventId,
        nextSinceEventId: finalHeadEventId ?? sinceEventId
      }
    }
  };
}

async function main() {
  const request = await readStdinJson();
  const caseId = typeof request?.caseId === "string" ? request.caseId : null;

  try {
    if (request?.schemaVersion !== "SessionStreamConformanceRequest.v1") {
      throw new TypeError("schemaVersion must be SessionStreamConformanceRequest.v1");
    }
    const outcome = runStreamScenario({ fixture: request.fixture });
    if (!outcome.ok) {
      fail({
        caseId,
        code: outcome.code,
        message: outcome.message,
        details: outcome.details ?? null
      });
    }

    const payload = {
      schemaVersion: "SessionStreamConformanceResponse.v1",
      caseId,
      ok: true,
      runtime: {
        implementation: "nooterra-reference-js",
        adapterSchemaVersion: "SessionStreamConformanceResponse.v1"
      },
      result: outcome.result
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch (err) {
    fail({
      caseId,
      code: "SESSION_STREAM_ADAPTER_RUNTIME_ERROR",
      message: err?.message ?? String(err ?? "unknown error")
    });
  }
}

main().catch((err) => {
  fail({
    caseId: null,
    code: "SESSION_STREAM_ADAPTER_RUNTIME_ERROR",
    message: err?.message ?? String(err ?? "unknown error")
  });
});
