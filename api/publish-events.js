// Vercel serverless function — publish events.json to the GitHub repo.
//
// Called from /admin/events when the operator clicks "Publish Live". The
// function authenticates the request against ADMIN_PASSWORD, validates the
// posted events array, and commits the file to GitHub via the Contents API.
// Once committed, Vercel auto-deploys and the live events.html (which
// fetches /content/events.json) updates within ~30 seconds.
//
// CommonJS — no package.json in the repo, so Vercel treats .js as CJS.
// global fetch is available on Node 18+ (the Vercel runtime default).
//
// Required env vars in Vercel:
//   ADMIN_PASSWORD   The same password used to unlock the admin UI.
//                    The admin UI sends this in the Authorization header
//                    so the server can verify before writing.
//   GH_TOKEN         Fine-grained GitHub Personal Access Token.
//                    Scope: this repo only. Permissions: Contents: Read+Write.
//                    Generate at: https://github.com/settings/tokens?type=beta
//
// Optional env vars:
//   GH_OWNER         GitHub user/org. Defaults to "robertvanliew".
//   GH_REPO          Repo name. Defaults to "takemebackbingo".
//   GH_BRANCH        Branch to commit to. Defaults to "main".
//   GH_PATH          Path of the JSON file. Defaults to "content/events.json".

const DEFAULT_OWNER  = "robertvanliew";
const DEFAULT_REPO   = "takemebackbingo";
const DEFAULT_BRANCH = "main";
const DEFAULT_PATH   = "content/events.json";

const ALLOWED_KEYS = new Set([
  "id","title","kicker","status","section","startDate","endDate",
  "dateLabel","timeLabel","venue","venueAddr","street","city","region","postal",
  "dj","host","music","afterParty","priceLabel","price",
  "flyer","flyerAlt","copy","simpletix","eventbrite","posh","fb"
]);

const ALLOWED_STATUS  = new Set(["onsale", "soldout", "past"]);
const ALLOWED_SECTION = new Set(["upcoming", "past"]);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ---------- Auth ----------
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res.status(500).json({ ok: false, error: "Server not configured: ADMIN_PASSWORD missing." });
  }
  const auth = req.headers.authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }

  // ---------- Parse + validate ----------
  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch {
      return res.status(400).json({ ok: false, error: "Invalid JSON body." });
    }
  }
  if (!payload || !Array.isArray(payload.events)) {
    return res.status(400).json({ ok: false, error: "Body must be { events: [...] }." });
  }
  const events = payload.events;

  // Soft validation — keep only known keys, enforce required + enum fields.
  const cleaned = [];
  const seenIds = new Set();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || typeof e !== "object") {
      return res.status(400).json({ ok: false, error: `Event #${i + 1} is not an object.` });
    }
    if (!e.id || typeof e.id !== "string") {
      return res.status(400).json({ ok: false, error: `Event #${i + 1} missing "id".` });
    }
    if (!/^[a-z0-9-]+$/.test(e.id)) {
      return res.status(400).json({ ok: false, error: `Event id "${e.id}" must be lowercase letters, numbers, and hyphens only.` });
    }
    if (seenIds.has(e.id)) {
      return res.status(400).json({ ok: false, error: `Duplicate id "${e.id}".` });
    }
    seenIds.add(e.id);
    if (!e.title) {
      return res.status(400).json({ ok: false, error: `Event "${e.id}" missing title.` });
    }
    if (!ALLOWED_STATUS.has(e.status)) {
      return res.status(400).json({ ok: false, error: `Event "${e.id}" has invalid status.` });
    }
    if (!ALLOWED_SECTION.has(e.section)) {
      return res.status(400).json({ ok: false, error: `Event "${e.id}" has invalid section.` });
    }

    const out = {};
    for (const k of ALLOWED_KEYS) {
      out[k] = typeof e[k] === "string" ? e[k] : (e[k] == null ? "" : String(e[k]));
    }
    cleaned.push(out);
  }

  // ---------- Commit to GitHub ----------
  const ghToken  = process.env.GH_TOKEN;
  const owner    = process.env.GH_OWNER  || DEFAULT_OWNER;
  const repo     = process.env.GH_REPO   || DEFAULT_REPO;
  const branch   = process.env.GH_BRANCH || DEFAULT_BRANCH;
  const filePath = process.env.GH_PATH   || DEFAULT_PATH;
  if (!ghToken) {
    return res.status(500).json({ ok: false, error: "Server not configured: GH_TOKEN missing." });
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const ghHeaders = {
    "Authorization": `Bearer ${ghToken}`,
    "Accept":        "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent":    "tmb-events-admin"
  };

  // 1. Fetch the current file's SHA (required to update).
  let currentSha = null;
  try {
    const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
    if (getRes.status === 200) {
      const data = await getRes.json();
      currentSha = data.sha;
    } else if (getRes.status !== 404) {
      const body = await getRes.text();
      return res.status(502).json({ ok: false, error: `GitHub read failed (${getRes.status}): ${body.slice(0, 200)}` });
    }
    // 404 means the file does not yet exist — that's fine, we'll create it.
  } catch (err) {
    return res.status(502).json({ ok: false, error: `GitHub read error: ${err.message}` });
  }

  // 2. PUT the new content (base64-encoded).
  const newContent = JSON.stringify(cleaned, null, 2) + "\n";
  const newContentB64 = Buffer.from(newContent, "utf-8").toString("base64");
  const message = `admin: publish events (${cleaned.length} event${cleaned.length === 1 ? "" : "s"})`;

  const putBody = { message, content: newContentB64, branch };
  if (currentSha) putBody.sha = currentSha;

  try {
    const putRes = await fetch(apiBase, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(putBody)
    });
    if (!putRes.ok) {
      const body = await putRes.text();
      return res.status(502).json({ ok: false, error: `GitHub write failed (${putRes.status}): ${body.slice(0, 300)}` });
    }
    const result = await putRes.json();
    return res.status(200).json({
      ok: true,
      count: cleaned.length,
      commit: result.commit && result.commit.sha ? result.commit.sha.slice(0, 7) : null,
      message: "Published. Vercel will rebuild the site in ~30 seconds."
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: `GitHub write error: ${err.message}` });
  }
};

// Constant-time string comparison so an attacker can't time-test the
// admin password byte by byte. Returns false if lengths differ.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
