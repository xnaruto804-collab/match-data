import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cachedUpstream, clearCacheStats, getCacheStats } from "./services/cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE = (
  process.env.OPENCRICKET_BASE_URL || "https://opencricketapi.com"
).replace(/\/$/, "");
const API_KEY = process.env.OPENCRICKET_API_KEY || "";

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));

const origins = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    // Allow tools/curl and local development when no allow-list is configured.
    if (!origin || origins.length === 0 || origins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  }
}));

app.use("/api", rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "local_rate_limit", message: "Too many requests. Please wait a minute." } }
}));

const seconds = (name, fallback) => Math.max(1, Number(process.env[name] || fallback));
const TTL = {
  live: seconds("CACHE_LIVE_SECONDS", 900),
  matches: seconds("CACHE_MATCHES_SECONDS", 900),
  reference: seconds("CACHE_REFERENCE_SECONDS", 21600),
  scorecard: seconds("CACHE_SCORECARD_SECONDS", 3600),
  deliveries: seconds("CACHE_DELIVERIES_SECONDS", 86400)
};

function validId(id) {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(id);
}
function pickQuery(query, allowed) {
  const out = {};
  for (const key of allowed) {
    const value = query[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
  }
  return out;
}
function withQuery(url, query) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}
async function source(pathname, query = {}, ttl = TTL.reference) {
  if (!API_KEY || API_KEY === "put_your_key_here") {
    const error = new Error("OpenCricket API key is missing. Copy .env.example to .env and add your key.");
    error.status = 503;
    error.code = "api_key_not_configured";
    throw error;
  }
  const url = withQuery(`${BASE}${pathname}`, query);
  return cachedUpstream(url, ttl, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body?.error?.message || body?.message || `Upstream returned HTTP ${response.status}`);
        error.status = response.status === 429 ? 429 : (response.status >= 500 ? 502 : response.status);
        error.code = body?.error?.code || "upstream_error";
        error.retryAfter = response.headers.get("retry-after");
        throw error;
      }
      return body;
    } catch (error) {
      if (error.name === "AbortError") {
        const timeout = new Error("Cricket data provider timed out.");
        timeout.status = 504;
        timeout.code = "upstream_timeout";
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "CricZone API",
    provider: "OpenCricket API",
    keyConfigured: Boolean(API_KEY && API_KEY !== "put_your_key_here"),
    cache: getCacheStats(),
    note: "Live scores and fixtures are upstream data. Availability and refresh speed depend on the provider plan."
  });
});

app.get("/api/cache", (_req, res) => res.json({ cache: getCacheStats() }));

app.get("/api/live", async (req, res, next) => {
  try {
    const q = pickQuery(req.query, ["state", "competition"]);
    if (q.state && !["in", "pre", "post", "all"].includes(q.state)) {
      return res.status(400).json({ error: { code: "invalid_state", message: "state must be in, pre, post, or all" } });
    }
    res.json(await source("/v1/live", q, TTL.live));
  } catch (e) { next(e); }
});

app.get("/api/matches", async (req, res, next) => {
  try {
    const q = pickQuery(req.query, ["competition", "season", "team", "venue", "format", "gender", "from", "to", "limit", "cursor"]);
    res.json(await source("/v1/matches", q, TTL.matches));
  } catch (e) { next(e); }
});

app.get("/api/matches/:id", async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ error: { code: "invalid_id", message: "Invalid match ID" } });
    res.json(await source(`/v1/matches/${encodeURIComponent(req.params.id)}`, {}, TTL.scorecard));
  } catch (e) { next(e); }
});

app.get("/api/matches/:id/scorecard", async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ error: { code: "invalid_id", message: "Invalid match ID" } });
    const q = pickQuery(req.query, ["innings"]);
    res.json(await source(`/v1/matches/${encodeURIComponent(req.params.id)}/scorecard`, q, TTL.scorecard));
  } catch (e) { next(e); }
});

app.get("/api/matches/:id/deliveries", async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ error: { code: "invalid_id", message: "Invalid match ID" } });
    const q = pickQuery(req.query, ["innings", "over_from", "over_to", "cursor"]);
    res.json(await source(`/v1/matches/${encodeURIComponent(req.params.id)}/deliveries`, q, TTL.deliveries));
  } catch (e) { next(e); }
});

app.get("/api/competitions", async (req, res, next) => {
  try {
    const q = pickQuery(req.query, ["format", "gender", "group"]);
    res.json(await source("/v1/competitions", q, TTL.reference));
  } catch (e) { next(e); }
});

app.get("/api/competitions/:id/standings", async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ error: { code: "invalid_id", message: "Invalid competition ID" } });
    res.json(await source(`/v1/competitions/${encodeURIComponent(req.params.id)}/standings`, pickQuery(req.query, ["season"]), TTL.reference));
  } catch (e) { next(e); }
});

app.get("/api/competitions/:id/leaders", async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ error: { code: "invalid_id", message: "Invalid competition ID" } });
    res.json(await source(`/v1/competitions/${encodeURIComponent(req.params.id)}/leaders`, pickQuery(req.query, ["season", "category"]), TTL.reference));
  } catch (e) { next(e); }
});

app.get("/api/teams/:id", async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ error: { code: "invalid_id", message: "Invalid team ID" } });
    res.json(await source(`/v1/teams/${encodeURIComponent(req.params.id)}`, {}, TTL.reference));
  } catch (e) { next(e); }
});

app.get("/api/players/:id", async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ error: { code: "invalid_id", message: "Invalid player ID" } });
    res.json(await source(`/v1/players/${encodeURIComponent(req.params.id)}`, {}, TTL.reference));
  } catch (e) { next(e); }
});

app.get("/api/search", async (req, res, next) => {
  try {
    const q = pickQuery(req.query, ["q", "type", "limit"]);
    if (!q.q || q.q.length < 2) return res.status(400).json({ error: { code: "query_required", message: "Provide ?q= with at least 2 characters" } });
    res.json(await source("/v1/search", q, TTL.reference));
  } catch (e) { next(e); }
});

// Serve the included demo. Your own existing frontend can instead call /api/*.
app.use(express.static(path.resolve(__dirname, "../public")));

app.use((req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Endpoint not found" } });
});

app.use((err, _req, res, _next) => {
  const status = Number(err.status) || 502;
  if (err.retryAfter) res.set("Retry-After", String(err.retryAfter));
  console.error(`[CricZone API] ${err.code || "error"}: ${err.message}`);
  res.status(status).json({
    error: {
      code: err.code || "api_error",
      message: err.message || "Unexpected API error"
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CricZone API running on port ${PORT}`);
  console.log(
    `API key configured: ${Boolean(
      API_KEY && API_KEY !== "put_your_key_here"
    )}`
  );
  console.log(`Live cache TTL: ${TTL.live}s`);
});
