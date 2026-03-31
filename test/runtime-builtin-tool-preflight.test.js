import test from "node:test";
import assert from "node:assert/strict";

import { preflightBuiltinTool } from "../services/runtime/builtin-tools.js";

test("scheduler builtin preflight: blocks malformed email recipients and header injection", async () => {
  const badRecipient = await preflightBuiltinTool("send_email", {
    to: "alice@example.com,bob@example.com",
    subject: "Hi",
    body: "Hello",
  });
  assert.equal(badRecipient.ok, false);

  const injectedSubject = await preflightBuiltinTool("send_email", {
    to: "alice@example.com",
    subject: "Hi\r\nBcc: attacker@example.com",
    body: "Hello",
  });
  assert.equal(injectedSubject.ok, false);
});

test("scheduler builtin preflight: blocks malformed Twilio destinations", async () => {
  const sms = await preflightBuiltinTool("send_sms", {
    to: "555-111-2222",
    body: "Hello",
  });
  assert.equal(sms.ok, false);

  const call = await preflightBuiltinTool("make_phone_call", {
    to: "+14155550100",
    message: "",
  });
  assert.equal(call.ok, false);
});

test("scheduler builtin preflight: normalizes spend arguments and validates due dates", async () => {
  const payment = await preflightBuiltinTool("make_payment", {
    amount_usd: "25.50",
    recipient: " Stripe ",
    description: " API usage ",
  });
  assert.equal(payment.ok, true);
  assert.equal(payment.normalizedArgs.amount_usd, 25.5);
  assert.equal(payment.normalizedArgs.recipient, "Stripe");
  assert.equal(payment.normalizedArgs.description, "API usage");

  const badRequest = await preflightBuiltinTool("request_payment", {
    amount_usd: 100,
    from: "Client",
    description: "Invoice",
    due_date: "03/30/2026",
  });
  assert.equal(badRequest.ok, false);
});
