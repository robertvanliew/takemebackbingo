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

  // ---------- Parse ----------
  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch {
      return res.status(400).json({ ok: false, error: "Invalid JSON body." });
    }
  }
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ ok: false, error: "Body must be JSON." });
  }

  // The endpoint accepts three modes:
  //   { events: [...] }     -> full replace (publish all)
  //   { event: {...} }      -> upsert one event by id, keep the rest
  //   { deleteId: "..." }   -> remove one event by id, keep the rest
  const isFullSync = Array.isArray(payload.events);
  const isSingleUpsert = payload.event && typeof payload.event === "object" && !Array.isArray(payload.event);
  const isSingleDelete = typeof payload.deleteId === "string" && payload.deleteId.length > 0;

  if (!isFullSync && !isSingleUpsert && !isSingleDelete) {
    return res.status(400).json({ ok: false, error: "Body must be { events: [...] }, { event: {...} }, or { deleteId: ... }." });
  }

  // ---------- GitHub setup ----------
  const ghToken  = process.env.GH_TOKEN;
  const owner    = process.env.GH_OWNER  || DEFAULT_OWNER;
  const repo     = process.env.GH_REPO   || DEFAULT_REPO;
  const branch   = process.env.GH_BRANCH || DEFAULT_BRANCH;
  const filePath = process.env.GH_PATH   || DEFAULT_PATH;
  if (!ghToken) {
    return res.status(500).json({ ok: false, error: "Server not configured: GH_TOKEN missing." });
  }
  const apiBaseFile = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const ghHeadersBase = {
    "Authorization": `Bearer ${ghToken}`,
    "Accept":        "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent":    "tmb-events-admin"
  };

  // ---------- Build the resulting array based on the request mode ----------
  let cleaned;
  let commitMessage;

  try {
    if (isFullSync) {
      // Validate every event, fail fast on bad input.
      cleaned = [];
      const seenIds = new Set();
      payload.events.forEach((e, i) => {
        const v = validateEvent(e, i, seenIds);
        seenIds.add(v.id);
        cleaned.push(v);
      });
      commitMessage = `admin: publish events (${cleaned.length} event${cleaned.length === 1 ? "" : "s"})`;
    } else if (isSingleUpsert) {
      const single = validateEvent(payload.event, 0, new Set());
      const current = await fetchCurrentEvents(apiBaseFile, ghHeadersBase, branch);
      const idx = current.list.findIndex(e => e && e.id === single.id);
      if (idx >= 0) {
        current.list[idx] = single;
        commitMessage = `admin: update event "${single.title}"`;
      } else {
        current.list.push(single);
        commitMessage = `admin: add event "${single.title}"`;
      }
      cleaned = current.list;
    } else if (isSingleDelete) {
      const id = payload.deleteId;
      if (!/^[a-z0-9-]+$/.test(id)) {
        return res.status(400).json({ ok: false, error: `Invalid deleteId "${id}".` });
      }
      const current = await fetchCurrentEvents(apiBaseFile, ghHeadersBase, branch);
      const idx = current.list.findIndex(e => e && e.id === id);
      if (idx < 0) {
        return res.status(404).json({ ok: false, error: `No event found with id "${id}".` });
      }
      const removed = current.list[idx];
      current.list.splice(idx, 1);
      cleaned = current.list;
      commitMessage = `admin: delete event "${removed.title || id}"`;
    }
  } catch (err) {
    if (err && err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
    return res.status(400).json({ ok: false, error: err.message || "Validation failed." });
  }

  // ---------- Fetch current SHA (required for PUT to update an existing file) ----------
  // For single-upsert/delete we already fetched the file inside fetchCurrentEvents.
  // For full sync we still need the SHA to update; a fresh fetch keeps the API
  // contract simple — GitHub will only accept the PUT if the SHA matches.
  let currentSha = null;
  try {
    const getRes = await fetch(`${apiBaseFile}?ref=${encodeURIComponent(branch)}`, { headers: ghHeadersBase });
    if (getRes.status === 200) {
      const data = await getRes.json();
      currentSha = data.sha;
    } else if (getRes.status !== 404) {
      const body = await getRes.text();
      return res.status(502).json({ ok: false, error: `GitHub read failed (${getRes.status}): ${body.slice(0, 200)}` });
    }
    // 404 = file not yet committed; PUT will create it.
  } catch (err) {
    return res.status(502).json({ ok: false, error: `GitHub read error: ${err.message}` });
  }

  // ---------- Commit ----------
  const newContent = JSON.stringify(cleaned, null, 2) + "\n";
  const newContentB64 = Buffer.from(newContent, "utf-8").toString("base64");
  const putBody = { message: commitMessage, content: newContentB64, branch };
  if (currentSha) putBody.sha = currentSha;

  try {
    const putRes = await fetch(apiBaseFile, {
      method: "PUT",
      headers: { ...ghHeadersBase, "Content-Type": "application/json" },
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

/* =====================================================================
   Helpers
   ===================================================================== */

// Throws { statusCode, message } on bad input. Returns a cleaned event
// object with only the allow-listed keys, all coerced to strings.
function validateEvent(e, i, seenIds) {
  const tag = `Event #${i + 1}`;
  if (!e || typeof e !== "object" || Array.isArray(e)) {
    throw bad(400, `${tag} is not an object.`);
  }
  if (!e.id || typeof e.id !== "string") {
    throw bad(400, `${tag} missing "id".`);
  }
  if (!/^[a-z0-9-]+$/.test(e.id)) {
    throw bad(400, `Event id "${e.id}" must be lowercase letters, numbers, and hyphens only.`);
  }
  if (seenIds.has(e.id)) {
    throw bad(400, `Duplicate id "${e.id}".`);
  }
  if (!e.title) {
    throw bad(400, `Event "${e.id}" missing title.`);
  }
  if (!ALLOWED_STATUS.has(e.status)) {
    throw bad(400, `Event "${e.id}" has invalid status (must be onsale, soldout, or past).`);
  }
  if (!ALLOWED_SECTION.has(e.section)) {
    throw bad(400, `Event "${e.id}" has invalid section (must be upcoming or past).`);
  }
  const out = {};
  for (const k of ALLOWED_KEYS) {
    out[k] = typeof e[k] === "string" ? e[k] : (e[k] == null ? "" : String(e[k]));
  }
  return out;
}

// Fetches the current events.json from the repo. Returns { list, sha }.
// If the file doesn't exist yet, returns { list: [], sha: null }.
async function fetchCurrentEvents(apiBase, headers, branch) {
  const r = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers });
  if (r.status === 404) return { list: [], sha: null };
  if (!r.ok) {
    const body = await r.text();
    throw bad(502, `GitHub read failed (${r.status}): ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  const decoded = Buffer.from(data.content || "", "base64").toString("utf-8");
  let list;
  try {
    list = JSON.parse(decoded);
  } catch (err) {
    throw bad(500, `Current events.json on the server is not valid JSON. Fix or restore the file before publishing single changes.`);
  }
  if (!Array.isArray(list)) {
    throw bad(500, `Current events.json is not an array.`);
  }
  return { list, sha: data.sha };
}

function bad(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

// Constant-time string comparison so an attacker can't time-test the
// admin password byte by byte. Returns false if lengths differ.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
