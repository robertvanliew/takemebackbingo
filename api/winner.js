// Vercel serverless function - captures a bingo winner's email and adds them
// to the Brevo "Bingo Winners" contact list, which triggers the 24h/47h
// THROWBACK10 follow-up automation built in Brevo.
//
// Same-origin POST from the play-page win screen (/api/winner), so no CORS.
// CommonJS on purpose: this project has no deployed package.json, so Vercel
// runs .js functions as CommonJS. (global fetch is available on Node 18+.)
//
// Required env var in Vercel:  BREVO_API_KEY  (Brevo v3 API key - secret)
// Optional env var:           BREVO_WINNERS_LIST_ID  (defaults to 3)

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const body = await readBody(req);
  const email = (body.email || '').toString().trim();
  const firstName = (body.firstName || '').toString().trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: 'invalid email' });
    return;
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'server not configured' });
    return;
  }
  const listId = Number(process.env.BREVO_WINNERS_LIST_ID || 3);

  try {
    const r = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email: email,
        attributes: firstName ? { FIRSTNAME: firstName } : undefined,
        listIds: [listId],
        updateEnabled: true, // existing contact -> update + add to list (204) instead of erroring
      }),
    });

    // 201 = created, 204 = updated; both are success.
    if (r.ok || r.status === 204) {
      res.status(200).json({ ok: true });
      return;
    }
    const detail = await r.text().catch(() => '');
    // Surface Brevo's error in Vercel logs so we can diagnose without DevTools.
    console.error('brevo create contact failed', {
      status: r.status,
      listId: listId,
      detail: detail.slice(0, 500),
    });
    res.status(502).json({ error: 'brevo ' + r.status, detail: detail.slice(0, 200) });
  } catch (e) {
    res.status(502).json({ error: 'fetch failed' });
  }
};
