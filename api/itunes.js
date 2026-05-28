// Vercel serverless function — proxies the iTunes Search API.
//
// Why this exists: the play-page game resolves each song to a 30s preview by
// querying Apple's iTunes Search API. Calling itunes.apple.com directly from
// the browser is a CROSS-SITE request, which iOS Safari blocks (Cross-Site
// Tracking Prevention / Private Browsing) even though desktop Chrome allows
// it. Result on iPhone: every lookup failed and the booth showed
// "Preview unavailable - skipping". Routing through our own origin
// (/api/itunes) makes it a SAME-ORIGIN request the browser always permits;
// the server-side fetch to Apple has no such restriction.
//
// CommonJS on purpose: this project has no package.json with "type":"module",
// so Vercel runs .js functions as CommonJS. (global fetch is available on the
// Node 18+ runtime Vercel uses.)

module.exports = async (req, res) => {
  const term = req.query && req.query.term ? String(req.query.term) : '';
  if (!term) {
    res.status(400).json({ error: 'missing term' });
    return;
  }

  const url =
    'https://itunes.apple.com/search?term=' +
    encodeURIComponent(term) +
    '&media=music&entity=song&limit=10';

  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      res.status(502).json({ error: 'itunes ' + r.status });
      return;
    }
    const data = await r.json();
    // Edge-cache so repeat lookups are instant and we stay under Apple's limits.
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=86400, stale-while-revalidate=604800'
    );
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: 'fetch failed' });
  }
};
