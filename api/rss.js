// Vercel serverless function — generate an RSS 2.0 feed from events.json.
//
// Served at /rss.xml (via a vercel.json rewrite). Chrome mobile picks this
// up as the site's default feed for the built-in Follow feature: users
// tap "Follow" in Chrome's menu and this site's new content starts
// appearing in their Google Discover "Following" tab.
//
// The feed is regenerated on every request. Content changes ship the
// moment the admin's Publish Live button rebuilds the site; RSS readers
// see the update on their next poll (usually 15-60 minutes).
//
// CommonJS (no package.json in the repo). global fetch is Node 18+.

const OWNER   = process.env.GH_OWNER  || "robertvanliew";
const REPO    = process.env.GH_REPO   || "takemebackbingo";
const BRANCH  = process.env.GH_BRANCH || "main";
const SITE    = "https://takemebackbingo.com";

const RAW_URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/content/events.json`;

module.exports = async (req, res) => {
  try {
    const events = await loadEvents();
    const items = buildItems(events);
    const xml = renderFeed(items);
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.status(200).send(xml);
  } catch (err) {
    res.status(500).setHeader("Content-Type", "text/plain").send(`RSS generation failed: ${err.message}`);
  }
};

async function loadEvents() {
  // We fetch the raw file from GitHub so this stays fresh even if Vercel
  // is serving cached deploys. The content is public; no auth needed.
  const r = await fetch(RAW_URL + "?t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error(`Could not load events.json (HTTP ${r.status})`);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error("events.json is not an array");
  return list;
}

function buildItems(events) {
  // Show upcoming events first (soonest first), then past (most recent first).
  const upcoming = events.filter(e => e.section === "upcoming");
  const past     = events.filter(e => e.section === "past");
  upcoming.sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0));
  past.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));
  // Cap total items — RSS readers rarely care about anything past 20.
  return [...upcoming, ...past].slice(0, 20);
}

function renderFeed(events) {
  const now = new Date().toUTCString();
  const items = events.map(renderItem).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Take Me Back Bingo Nights</title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Hip-hop and R&#38;B live music bingo events, throwback nights, dance battles, and prizes across NJ and NY.</description>
    <language>en-us</language>
    <copyright>&#169; ${new Date().getUTCFullYear()} High Class Experience LLC. All rights reserved.</copyright>
    <lastBuildDate>${now}</lastBuildDate>
    <ttl>60</ttl>
    <image>
      <url>${SITE}/logos/logo.png</url>
      <title>Take Me Back Bingo Nights</title>
      <link>${SITE}/</link>
    </image>
${items}
  </channel>
</rss>`;
}

function renderItem(e) {
  const url = `${SITE}/events#${e.id}`;
  const title = `${e.title}${e.dateLabel ? " — " + e.dateLabel : ""}`;
  const pub = e.startDate ? new Date(e.startDate).toUTCString() : new Date().toUTCString();
  const description = buildDescription(e);
  const imageUrl = e.flyer ? `${SITE}/${e.flyer.replace(/^\//, "")}` : `${SITE}/logos/logo.png`;
  return `    <item>
      <title>${xml(title)}</title>
      <link>${xml(url)}</link>
      <guid isPermaLink="true">${xml(url)}</guid>
      <pubDate>${xml(pub)}</pubDate>
      <dc:creator>Take Me Back Bingo Nights</dc:creator>
      <description>${xml(description)}</description>
      <content:encoded><![CDATA[<p><img src="${imageUrl}" alt="${xml(e.flyerAlt || e.title)}" /></p><p>${htmlSafe(description)}</p>${e.simpletix ? `<p><a href="${xml(e.simpletix)}">Buy tickets</a></p>` : ""}]]></content:encoded>
      <enclosure url="${xml(imageUrl)}" type="image/jpeg" length="0" />
      <media:content url="${xml(imageUrl)}" medium="image" />
    </item>`;
}

function buildDescription(e) {
  const parts = [];
  if (e.dateLabel)  parts.push(e.dateLabel);
  if (e.venueAddr)  parts.push(e.venueAddr);
  if (e.timeLabel)  parts.push(e.timeLabel);
  if (e.priceLabel) parts.push(e.priceLabel);
  const header = parts.join(" · ");
  const body = (e.copy || "").trim();
  return [header, body].filter(Boolean).join(" — ");
}

function xml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlSafe(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
