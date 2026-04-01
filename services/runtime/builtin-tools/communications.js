import { BUILTIN_TOOL_POLICIES } from './catalog.js';
import {
  isAbortLikeError,
  isValidE164PhoneNumber,
  isValidEmailAddress,
  normalizeString,
} from './shared.js';

function getTwilioConfig() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  };
}

function getResendConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.RESEND_FROM || 'workers@nooterra.ai',
  };
}

function twilioConfigured() {
  const config = getTwilioConfig();
  return config.accountSid && config.authToken && config.phoneNumber;
}

function twilioAuthHeader() {
  const config = getTwilioConfig();
  const creds = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
  return `Basic ${creds}`;
}

function xmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function sendSms({ to, body }) {
  if (!twilioConfigured()) {
    return { error: 'Twilio not configured' };
  }
  const twilio = getTwilioConfig();

  const normalizedTo = normalizeString(to);
  const normalizedBody = typeof body === 'string' ? body : '';
  if (!isValidE164PhoneNumber(normalizedTo)) {
    return { error: 'Invalid destination phone number' };
  }
  if (!normalizedBody.trim()) {
    return { error: 'Message body is required' };
  }
  if (normalizedBody.length > BUILTIN_TOOL_POLICIES.send_sms.maxBodyChars) {
    return { error: `Message body exceeds ${BUILTIN_TOOL_POLICIES.send_sms.maxBodyChars} characters` };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`;
  const formBody = new URLSearchParams({ To: normalizedTo, From: twilio.phoneNumber, Body: normalizedBody });

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: twilioAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    if (isAbortLikeError(err)) throw new Error('Twilio SMS timed out');
    throw err;
  }

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Twilio SMS failed (${resp.status}): ${err}`);
  }

  let message;
  try {
    message = await resp.json();
  } catch {
    throw new Error('Twilio SMS returned invalid JSON');
  }
  if (!normalizeString(message?.sid)) {
    throw new Error('Twilio SMS response missing sid');
  }
  return { ok: true, sid: normalizeString(message.sid), to: normalizedTo, status: normalizeString(message?.status) || 'queued' };
}

export async function makePhoneCall({ to, message, voice = 'alice' }) {
  if (!twilioConfigured()) {
    return { error: 'Twilio not configured' };
  }
  const twilio = getTwilioConfig();

  const normalizedTo = normalizeString(to);
  const normalizedMessage = typeof message === 'string' ? message : '';
  if (!isValidE164PhoneNumber(normalizedTo)) {
    return { error: 'Invalid destination phone number' };
  }
  if (!normalizedMessage.trim()) {
    return { error: 'Call message is required' };
  }
  if (normalizedMessage.length > BUILTIN_TOOL_POLICIES.make_phone_call.maxMessageChars) {
    return { error: `Call message exceeds ${BUILTIN_TOOL_POLICIES.make_phone_call.maxMessageChars} characters` };
  }
  if (!['alice', 'man', 'woman'].includes(voice)) {
    return { error: 'Invalid voice selection' };
  }

  const twiml = `<Response><Say voice="${xmlEscape(voice)}">${xmlEscape(normalizedMessage)}</Say></Response>`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Calls.json`;
  const formBody = new URLSearchParams({ To: normalizedTo, From: twilio.phoneNumber, Twiml: twiml });

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: twilioAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    if (isAbortLikeError(err)) throw new Error('Twilio phone call timed out');
    throw err;
  }

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Twilio Call failed (${resp.status}): ${err}`);
  }

  let call;
  try {
    call = await resp.json();
  } catch {
    throw new Error('Twilio Call returned invalid JSON');
  }
  if (!normalizeString(call?.sid)) {
    throw new Error('Twilio Call response missing sid');
  }
  return { ok: true, sid: normalizeString(call.sid), to: normalizedTo, status: normalizeString(call?.status) || 'queued' };
}

export async function sendEmail({ to, subject, body, html = false }) {
  const resend = getResendConfig();
  if (!resend.apiKey) {
    return { error: 'Email not configured — set RESEND_API_KEY' };
  }

  const normalizedTo = normalizeString(to);
  const normalizedSubject = typeof subject === 'string' ? subject : '';
  const normalizedBody = typeof body === 'string' ? body : '';
  if (!isValidEmailAddress(normalizedTo)) {
    return { error: 'Invalid recipient email address' };
  }
  if (!normalizedSubject.trim() || /[\r\n]/.test(normalizedSubject)) {
    return { error: 'Invalid email subject' };
  }
  if (!normalizedBody.trim()) {
    return { error: 'Email body is required' };
  }

  const payload = {
    from: resend.from,
    to: normalizedTo,
    subject: normalizedSubject,
  };

  if (html) payload.html = normalizedBody;
  else payload.text = normalizedBody;

  let resp;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    if (isAbortLikeError(err)) throw new Error('Resend email request timed out');
    throw err;
  }

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Resend email failed (${resp.status}): ${err}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error('Resend email returned invalid JSON');
  }
  if (!normalizeString(data?.id)) {
    throw new Error('Resend email response missing id');
  }
  return { ok: true, id: normalizeString(data.id), to: normalizedTo, subject: normalizedSubject };
}
