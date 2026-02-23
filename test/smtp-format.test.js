import test from "node:test";
import assert from "node:assert/strict";

import { dotStuffSmtpData, extractSmtpEnvelopeAddress, formatSmtpMessage } from "../services/magic-link/src/smtp.js";

test("formatSmtpMessage: emits CRLF headers + body and ends with CRLF", () => {
  const msg = formatSmtpMessage({
    from: "noreply@example.test",
    to: "user@example.test",
    subject: "Subject line",
    text: "a\nb\r\nc\rd\n"
  });

  assert.ok(msg.includes("From: noreply@example.test\r\n"));
  assert.ok(msg.includes("To: user@example.test\r\n"));
  assert.ok(msg.includes("Subject: Subject line\r\n"));
  assert.ok(msg.includes("Date: "));
  assert.ok(msg.includes("Message-ID: <"));
  assert.ok(msg.includes("\r\n\r\na\r\nb\r\nc\r\nd\r\n"));
  assert.ok(msg.endsWith("\r\n"));
});

test("dotStuffSmtpData: prefixes lines that start with '.'", () => {
  const input = "h\r\n.hello\r\n..two\r\nnormal\r\n";
  const out = dotStuffSmtpData(input);
  assert.equal(out, "h\r\n..hello\r\n...two\r\nnormal\r\n");
});

test("extractSmtpEnvelopeAddress: accepts plain and display-name forms", () => {
  assert.equal(extractSmtpEnvelopeAddress("ops@example.test"), "ops@example.test");
  assert.equal(extractSmtpEnvelopeAddress("Settld Ops <ops@example.test>"), "ops@example.test");
});

test("extractSmtpEnvelopeAddress: rejects invalid values", () => {
  assert.throws(() => extractSmtpEnvelopeAddress("Settld Ops"), /smtp address must be an email address/);
});
