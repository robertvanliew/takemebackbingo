// Vercel serverless function — upload an event flyer to /flyers/ in the repo.
//
// Called from /admin/events when the operator picks a file in the Flyer
// upload field. The client downsizes the image first (max 1600px wide,
// JPEG 0.85) so we don't ship multi-megabyte originals to GitHub.
//
// CommonJS for the same reason as the other endpoints.
//
// Required env vars (same as publish-events):
//   ADMIN_PASSWORD, GH_TOKEN
// Optional:
//   GH_OWNER (default robertvanliew), GH_REPO (default takemebackbingo),
//   GH_BRANCH (default main)

const DEFAULT_OWNER  = "robertvanliew";
const DEFAULT_REPO   = "takemebackbingo";
const DEFAULT_BRANCH = "main";

const ALLOWED_EXT = { jpg: "jpg", jpeg: "jpeg", png: "png", webp: "webp" };
const MAX_BYTES = 4 * 1024 * 1024; // 4MB after client-side compression — generous

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Auth
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(500).json({ ok: false, error: "Server not configured: ADMIN_PASSWORD missing." });
  const auth = req.headers.authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }

  // Body: { filename: "summer-jam.jpg", dataBase64: "iVBORw0KG..." }
  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch {
      return res.status(400).json({ ok: false, error: "Invalid JSON body." });
    }
  }
  if (!payload || typeof payload.filename !== "string" || typeof payload.dataBase64 !== "string") {
    return res.status(400).json({ ok: false, error: "Body must be { filename, dataBase64 }." });
  }

  const cleanName = sanitizeFilename(payload.filename);
  if (!cleanName) return res.status(400).json({ ok: false, error: "Filename has no valid extension. Use jpg/jpeg/png/webp." });

  // Decode + size guard
  const buf = Buffer.from(payload.dataBase64, "base64");
  if (buf.length === 0) return res.status(400).json({ ok: false, error: "Empty file." });
  if (buf.length > MAX_BYTES) return res.status(413).json({ ok: false, error: `File too large (${(buf.length/1024/1024).toFixed(1)} MB > 4 MB).` });

  // GitHub commit
  const ghToken = process.env.GH_TOKEN;
  const owner   = process.env.GH_OWNER  || DEFAULT_OWNER;
  const repo    = process.env.GH_REPO   || DEFAULT_REPO;
  const branch  = process.env.GH_BRANCH || DEFAULT_BRANCH;
  if (!ghToken) return res.status(500).json({ ok: false, error: "Server not configured: GH_TOKEN missing." });

  const filePath = `flyers/${cleanName}`;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const ghHeaders = {
    "Authorization": `Bearer ${ghToken}`,
    "Accept":        "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent":    "tmb-events-admin"
  };

  // Look up existing file SHA (PUT requires it if the file exists)
  let currentSha = null;
  try {
    const r = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
    if (r.status === 200) {
      const data = await r.json();
      currentSha = data.sha;
    } else if (r.status !== 404) {
      const body = await r.text();
      return res.status(502).json({ ok: false, error: `GitHub read failed (${r.status}): ${body.slice(0, 200)}` });
    }
  } catch (err) {
    return res.status(502).json({ ok: false, error: `GitHub read error: ${err.message}` });
  }

  const putBody = {
    message: `admin: upload flyer ${cleanName}`,
    content: payload.dataBase64,
    branch
  };
  if (currentSha) putBody.sha = currentSha;

  try {
    const r = await fetch(apiBase, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(putBody)
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(502).json({ ok: false, error: `GitHub write failed (${r.status}): ${body.slice(0, 300)}` });
    }
    return res.status(200).json({
      ok: true,
      path: filePath,
      message: "Uploaded. Live after the next Vercel rebuild (~30s)."
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: `GitHub write error: ${err.message}` });
  }
};

function sanitizeFilename(name) {
  const base = name.split(/[\\/]/).pop().trim();
  const m = base.match(/^(.+?)\.([a-zA-Z0-9]+)$/);
  if (!m) return null;
  const ext = m[2].toLowerCase();
  if (!ALLOWED_EXT[ext]) return null;
  const stem = m[1]
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "flyer";
  return `${stem}.${ALLOWED_EXT[ext]}`;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
