import test from "node:test";
import assert from "node:assert/strict";

import { sendResendMail } from "../services/magic-link/src/email-resend.js";

test("sendResendMail: sends expected payload", async () => {
  let called = 0;
  let captured = null;
  const fetchImpl = async (url, init) => {
    called += 1;
    captured = { url, init };
    return new Response(JSON.stringify({ id: "email_123" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const out = await sendResendMail({
    apiKey: "re_test_123",
    from: "onboarding@nooterra.work",
    to: "user@example.com",
    subject: "Test",
    text: "Hello",
    fetchImpl
  });
  assert.equal(called, 1);
  assert.equal(out.ok, true);
  assert.equal(out.id, "email_123");
  assert.equal(captured.url, "https://api.resend.com/emails");
  assert.equal(captured.init.method, "POST");
});

test("sendResendMail: surfaces upstream error", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ message: "invalid api key" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });

  await assert.rejects(
    () =>
      sendResendMail({
        apiKey: "bad",
        from: "onboarding@nooterra.work",
        to: "user@example.com",
        subject: "Test",
        text: "Hello",
        fetchImpl
      }),
    /resend send failed \(401\): invalid api key/
  );
});

