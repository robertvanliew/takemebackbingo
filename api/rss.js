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

const EVENTS_URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/content/events.json`;
const POSTS_URL  = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/content/posts.json`;

module.exports = async (req, res) => {
  try {
    // Load both feeds in parallel. If posts.json doesn't exist yet, treat
    // it as empty so RSS still ships events.
    const [events, posts] = await Promise.all([loadJson(EVENTS_URL, "events.json"), loadJson(POSTS_URL, "posts.json", true)]);
    const items = buildItems(events, posts);
    const xml = renderFeed(items);
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.status(200).send(xml);
  } catch (err) {
    res.status(500).setHeader("Content-Type", "text/plain").send(`RSS generation failed: ${err.message}`);
  }
};

async function loadJson(url, label, tolerate404 = false) {
  const r = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
  if (r.status === 404 && tolerate404) return [];
  if (!r.ok) throw new Error(`Could not load ${label} (HTTP ${r.status})`);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error(`${label} is not an array`);
  return list;
}

function buildItems(events, posts) {
  // Blog posts get their own item type so the renderer can format them
  // differently (headline is post.title; guid is the post URL, not
  // the events anchor). Events keep the existing shape.
  const postItems  = posts.map(p => ({ kind: "post",  ...p }));
  const eventItems = orderEvents(events).map(e => ({ kind: "event", ...e }));
  // Sort combined feed by "date the reader cares about most":
  //   - posts sort by publishedAt DESC
  //   - events sort by startDate DESC
  // Interleave: newest content wins the top slot regardless of type.
  const combined = [...postItems, ...eventItems];
  combined.sort((a, b) => rankDate(b) - rankDate(a));
  return combined.slice(0, 20);
}

function orderEvents(events) {
  const upcoming = events.filter(e => e.section === "upcoming");
  const past     = events.filter(e => e.section === "past");
  upcoming.sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0));
  past.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));
  return [...upcoming, ...past];
}

function rankDate(item) {
  if (item.kind === "post")  return new Date(item.publishedAt || 0).getTime();
  if (item.kind === "event") return new Date(item.startDate    || 0).getTime();
  return 0;
}

function renderFeed(feedItems) {
  const now = new Date().toUTCString();
  const items = feedItems.map(renderItem).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Take Me Back Bingo</title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Hip-hop and R&#38;B live music bingo events, throwback nights, dance battles, and prizes across NJ and NY.</description>
    <language>en-us</language>
    <copyright>&#169; ${new Date().getUTCFullYear()} High Class Experience LLC. All rights reserved.</copyright>
    <lastBuildDate>${now}</lastBuildDate>
    <ttl>60</ttl>
    <image>
      <url>${SITE}/logos/logo.png</url>
      <title>Take Me Back Bingo</title>
      <link>${SITE}/</link>
    </image>
${items}
  </channel>
</rss>`;
}

function renderItem(item) {
  if (item.kind === "post") return renderPostItem(item);
  return renderEventItem(item);
}

function renderEventItem(e) {
  const url = `${SITE}/events#${e.id}`;
  const title = `${e.title}${e.dateLabel ? " — " + e.dateLabel : ""}`;
  const pub = e.startDate ? new Date(e.startDate).toUTCString() : new Date().toUTCString();
  const description = buildEventDescription(e);
  const imageUrl = e.flyer ? `${SITE}/${e.flyer.replace(/^\//, "")}` : `${SITE}/logos/logo.png`;
  return `    <item>
      <title>${xml(title)}</title>
      <link>${xml(url)}</link>
      <guid isPermaLink="true">${xml(url)}</guid>
      <pubDate>${xml(pub)}</pubDate>
      <dc:creator>Take Me Back Bingo</dc:creator>
      <category>Event</category>
      <description>${xml(description)}</description>
      <content:encoded><![CDATA[<p><img src="${imageUrl}" alt="${xml(e.flyerAlt || e.title)}" /></p><p>${htmlSafe(description)}</p>${e.simpletix ? `<p><a href="${xml(e.simpletix)}">Buy tickets</a></p>` : ""}]]></content:encoded>
      <enclosure url="${xml(imageUrl)}" type="image/jpeg" length="0" />
      <media:content url="${xml(imageUrl)}" medium="image" />
    </item>`;
}

function renderPostItem(p) {
  const url = `${SITE}/${(p.path || "blog/" + p.slug).replace(/^\//, "")}`;
  const pub = p.publishedAt ? new Date(p.publishedAt).toUTCString() : new Date().toUTCString();
  const imageUrl = p.coverImage ? `${SITE}/${p.coverImage.replace(/^\//, "")}` : `${SITE}/logos/logo.png`;
  const excerpt = p.excerpt || "";
  const category = (p.tags && p.tags[0]) || "Blog";
  return `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(url)}</link>
      <guid isPermaLink="true">${xml(url)}</guid>
      <pubDate>${xml(pub)}</pubDate>
      <dc:creator>${xml(p.author || "Take Me Back Bingo")}</dc:creator>
      <category>${xml(category)}</category>
      <description>${xml(excerpt)}</description>
      <content:encoded><![CDATA[<p><img src="${imageUrl}" alt="${xml(p.coverImageAlt || p.title)}" /></p><p>${htmlSafe(excerpt)}</p><p><a href="${xml(url)}">Read the full post →</a></p>]]></content:encoded>
      <enclosure url="${xml(imageUrl)}" type="image/jpeg" length="0" />
      <media:content url="${xml(imageUrl)}" medium="image" />
    </item>`;
}

function buildEventDescription(e) {
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
