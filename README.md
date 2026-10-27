# CricZone API (local-first starter)

A Node.js API wrapper for CricZone, plus a small demo frontend. It keeps your provider key on the server, provides your own `/api/...` endpoints, caches upstream responses, limits requests to your local API, and serves stale cached data temporarily if the provider fails.

## Important reality check

This is your own API service, but the score data still comes from a provider. A completely free API key does **not** guarantee unlimited, Cricinfo-level, real-time ball-by-ball data.

OpenCricket's current free Starter plan lists 5,000 requests/month and includes live scores/fixtures, match summaries, scorecards, competitions, teams, players and search. The current pricing page lists full deliveries and the live match centre as Developer-tier features. So this starter gives full scorecards and reference data on Starter, while `/api/matches/:id/deliveries` requires a provider plan that permits that endpoint. It will return the provider's clear error rather than fabricate commentary.

Provider details and quotas can change:
- https://opencricketapi.com/
- https://opencricketapi.com/pricing
- https://opencricketapi.com/openapi.json
- https://cricsheet.org/licensing/

Historical Cricsheet data is licensed under ODC-BY 1.0 for most JSON data and needs attribution. Live feed rights are different; review the provider terms before making a public/commercial site.

## Requirements

- Windows 10/11
- Node.js 20 or newer (Node 24 is fine)
- An OpenCricket API key: https://opencricketapi.com/

## Run on Windows

1. Extract the ZIP to a folder, for example `C:\\CricZone-API`.
2. Open that folder in VS Code.
3. Open Terminal → New Terminal.
4. Install dependencies:

   ```powershell
   npm install
   ```

5. Create your local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

6. Open `.env`, replace `put_your_key_here` with your provider key, and save. Never put this key in `public/app.js` or your website's HTML.
7. Start the API:

   ```powershell
   npm run dev
   ```

8. Open:
   - Demo website: http://localhost:3000
   - Health check: http://localhost:3000/api/health
   - Live scores: http://localhost:3000/api/live?state=in
   - Upcoming today: http://localhost:3000/api/live?state=pre
   - All matches today: http://localhost:3000/api/live?state=all
   - Competitions: http://localhost:3000/api/competitions
   - Search: http://localhost:3000/api/search?q=pakistan
   - Match list: http://localhost:3000/api/matches?limit=20

If the server says the key is not configured, verify `.env` exists in the project root and restart the server. The demo reads OpenCricket's `teams[].score` field from live match responses. If you get HTTP 401, check the key. If you get HTTP 403 on deliveries, the endpoint is not included in the provider plan. HTTP 429 means a provider limit/quota was reached.

## API endpoints

| Your endpoint | Purpose | Provider tier note |
|---|---|---|
| `GET /api/health` | Service status and cache statistics | Local |
| `GET /api/live?state=in` | In-progress scores | Starter |
| `GET /api/matches?limit=20` | Fixtures/results with filters | Starter |
| `GET /api/matches/:id` | Match summary | Starter |
| `GET /api/matches/:id/scorecard` | Full scorecard | Starter |
| `GET /api/matches/:id/deliveries?innings=1` | Ball-by-ball archive | Developer or higher |
| `GET /api/competitions` | Competitions and seasons | Starter |
| `GET /api/competitions/:id/standings` | Points table | Starter |
| `GET /api/competitions/:id/leaders` | Season leaderboards | Starter |
| `GET /api/teams/:id` | Team profile | Starter |
| `GET /api/players/:id` | Player profile | Starter |
| `GET /api/search?q=kohli` | Search players, teams, competitions, venues | Starter |

IDs come from provider responses; do not guess them. The wrapper passes through the provider's JSON structure and source metadata so your frontend can use the real schema.

## Caching and monthly quota

The free Starter plan currently lists 5,000 requests per month. The default live cache TTL is 900 seconds (15 minutes). If the browser polls your own API every 30 seconds, it generally reuses the cached result rather than spending a provider request each time.

One live query expiring every 15 minutes can use roughly 2,880 provider calls over a 30-day month if continuously requested. That leaves only about 2,120 calls for all other uncached endpoints. Do not lower the TTL to 20 seconds on the free plan: that could consume about 43,200 live calls/month. If you need frequent live updates, obtain a suitable quota/plan or use a source whose licence and limits permit your usage.

Cache settings in `.env`:
- `CACHE_LIVE_SECONDS=900`
- `CACHE_MATCHES_SECONDS=900`
- `CACHE_REFERENCE_SECONDS=21600`
- `CACHE_SCORECARD_SECONDS=3600`
- `CACHE_DELIVERIES_SECONDS=86400`

A stale cache may be served if a refresh fails. The response then includes a `_criczone.stale` flag. Do not treat stale data as current.

## Connect your existing CricZone frontend

From a page served by this Express app, use:

```js
const response = await fetch("/api/live?state=in");
if (!response.ok) throw new Error("Cricket API failed");
const payload = await response.json();
console.log(payload);
```

Inspect the real JSON response in the browser first and map its actual fields into your match cards. Provider schemas can have nested structures; do not assume every API's team/score fields are identical.

If your frontend is running separately, set `CORS_ORIGINS` in `.env`, for example:

```env
CORS_ORIGINS=http://127.0.0.1:5500,http://localhost:5500
```

Restart the server after changing `.env`.

## Deploy later

1. Push this project to a private GitHub repository (never commit `.env`).
2. Choose a Node.js host that supports environment variables and outbound HTTPS.
3. Set `OPENCRICKET_API_KEY`, `OPENCRICKET_BASE_URL`, `CACHE_LIVE_SECONDS`, and `CORS_ORIGINS` in the host's environment settings.
4. Set `NODE_ENV=production`.
5. Use the host's assigned HTTPS URL as your frontend API base URL.
6. Confirm the provider's terms permit your intended public use and attribution.
7. Note: in-memory cache is lost on restart and is not shared across multiple server instances. For scale, use a persistent shared cache (for example Redis) and a quota-aware refresh worker.

## Security notes before public launch

- Never expose the provider key in frontend JavaScript.
- Restrict `CORS_ORIGINS` to your real frontend domain.
- Protect or remove `DELETE /api/cache` before public deployment; it is intended only as a local development helper.
- Add authentication/admin controls if you add endpoints that modify data.
- Respect upstream provider rate limits and attribution terms.
- Free hosting has usage limits and can sleep; no free hosting plan is guaranteed forever.

## What is and is not included

Included: REST endpoints, provider key protection, TTL cache, request coalescing, stale-on-error fallback, local rate limiting, a demo UI, and Windows setup instructions.

Not included: a licensed proprietary live data feed, independently collected live score data, WebSockets from the upstream provider, persistent distributed cache, or guaranteed 20-second live commentary on the free plan. The demo UI polls your own API; the upstream refresh is controlled by cache expiry and provider quota.
