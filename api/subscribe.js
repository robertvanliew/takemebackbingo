// Vercel serverless function — newsletter signup.
//
// Same-origin POST from the footer newsletter form (/api/subscribe), so no
// CORS. CommonJS on purpose: this project has no deployed package.json, so
// Vercel runs .js functions as CommonJS. (global fetch is available on
// Node 18+.)
//
// What it does:
//   1. Validate the email server-side
//   2. Add the contact to the Resend Audience (RESEND_AUDIENCE_ID)
//   3. Send a short welcome email via Resend
//   4. Return JSON so the inline [data-newsletter-status] handler can show
//      success/error inline without changing the markup
//
// Required env vars in Vercel:
//   RESEND_API_KEY        Resend API key (secret) — needs contacts:write + emails:send
//   RESEND_AUDIENCE_ID    The Resend Audience ID created in the dashboard
//
// Optional env vars:
//   NEWSLETTER_FROM       e.g. "Take Me Back Bingo <hello@takemebackbingo.com>"
//                         Must be on a domain you've verified in Resend.
//                         Defaults to "Take Me Back Bingo <onboarding@resend.dev>"
//                         which only works for sending to your own verified
//                         account email — fine for testing, not production.
//   NEWSLETTER_REPLY_TO   e.g. "info@takemebackbingo.com" (optional)
//
// The inquiry/booking forms stay on Formspree. Do NOT route them through here.

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      if (typeof req.body === 'object') return resolve(req.body);
      try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve({}); }
    }
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const WELCOME_SUBJECT = "You're on the list — dates drop soon.";

function welcomeHtml() {
  // Plain, on-brand. No images, no tracking pixels. Keep it short.
  return [
    '<!doctype html>',
    '<html><body style="margin:0;padding:0;background:#141111;color:#F2EADB;font-family:Helvetica,Arial,sans-serif;">',
    '<div style="max-width:520px;margin:0 auto;padding:32px 24px;">',
    '<h1 style="font-size:22px;letter-spacing:-.01em;margin:0 0 16px;color:#F2EADB;">You’re on the list.</h1>',
    '<p style="font-size:16px;line-height:1.55;margin:0 0 14px;color:#A89C8A;">',
    'Thanks for signing up to Take Me Back Bingo. We’re finalizing the next ',
    'round of dates right now — you’ll be among the first to know when they drop.',
    '</p>',
    '<p style="font-size:16px;line-height:1.55;margin:0 0 14px;color:#A89C8A;">',
    'Want to book a private night before then? Hit reply or text 732.646.7073.',
    '</p>',
    '<p style="font-size:13px;line-height:1.55;margin:24px 0 0;color:#A89C8A;opacity:.7;">',
    'Take Me Back Bingo · Bingo for people who love music.',
    '</p>',
    '</div></body></html>',
  ].join('');
}

function welcomeText() {
  return [
    "You're on the list.",
    '',
    "Thanks for signing up to Take Me Back Bingo. We're finalizing the next round",
    "of dates right now — you'll be among the first to know when they drop.",
    '',
    "Want to book a private night before then? Hit reply or text 732.646.7073.",
    '',
    'Take Me Back Bingo · Bingo for people who love music.',
  ].join('\n');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const body = await readBody(req);
  const email = (body.email || '').toString().trim().toLowerCase();
  const firstName = (body.firstName || '').toString().trim();

  // Server-side validation — never trust the client.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    res.status(400).json({ error: 'invalid email' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    console.error('subscribe: missing RESEND_API_KEY or RESEND_AUDIENCE_ID');
    res.status(500).json({ error: 'server not configured' });
    return;
  }

  const from = process.env.NEWSLETTER_FROM
    || 'Take Me Back Bingo <onboarding@resend.dev>'; // TODO: set NEWSLETTER_FROM
  const replyTo = process.env.NEWSLETTER_REPLY_TO || undefined;

  // --- 1. Add contact to the Resend Audience ---
  // Resend treats a re-add of the same email as success (it just updates the
  // existing contact), so we don't need to dedupe up front.
  try {
    const addRes = await fetch(
      'https://api.resend.com/audiences/' + encodeURIComponent(audienceId) + '/contacts',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          first_name: firstName || undefined,
          unsubscribed: false,
        }),
      }
    );

    // 200 / 201 are both success. Resend may also return a 200 with an
    // existing contact id — that's fine.
    if (!addRes.ok && addRes.status !== 422 /* already exists */) {
      const detail = await addRes.text().catch(() => '');
      console.error('subscribe: resend add-contact failed', {
        status: addRes.status,
        detail: detail.slice(0, 500),
      });
      res.status(502).json({ error: 'resend ' + addRes.status });
      return;
    }
  } catch (e) {
    console.error('subscribe: resend add-contact threw', e && e.message);
    res.status(502).json({ error: 'resend unreachable' });
    return;
  }

  // --- 2. Send the welcome email (best-effort; don't block signup on this) ---
  try {
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from,
        to: [email],
        subject: WELCOME_SUBJECT,
        html: welcomeHtml(),
        text: welcomeText(),
        reply_to: replyTo,
      }),
    });
    if (!sendRes.ok) {
      // Don't fail the request — the contact is on the list, the welcome
      // email is a nice-to-have. Log so we can diagnose in Vercel logs.
      const detail = await sendRes.text().catch(() => '');
      console.warn('subscribe: welcome send failed', {
        status: sendRes.status,
        detail: detail.slice(0, 500),
      });
    }
  } catch (e) {
    console.warn('subscribe: welcome send threw', e && e.message);
  }

  res.status(200).json({ ok: true });
};
