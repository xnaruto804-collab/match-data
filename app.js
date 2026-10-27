const $ = (s) => document.querySelector(s);
const matchesEl = $("#matches");
const statusEl = $(".status");
let refreshTimer;

function pick(obj, ...paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((v, k) => v?.[k], obj);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}
function listFrom(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["matches", "live", "results", "data", "items"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  return [];
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function score(team) {
  if (!team) return "—";
  if (typeof team === "string") return escapeHtml(team);
  const total = pick(team, "score", "runs", "total", "inningsScore");
  const wickets = pick(team, "wickets", "outs");
  const overs = pick(team, "overs", "oversText");
  if (total === null) return escapeHtml(pick(team, "name", "shortName", "abbreviation") || "—");
  return `${escapeHtml(total)}${wickets !== null ? "/" + escapeHtml(wickets) : ""}${overs ? ` <span class="abbr">(${escapeHtml(overs)})</span>` : ""}`;
}
function teamName(team) {
  if (!team) return "TBC";
  return escapeHtml(typeof team === "string" ? team : pick(team, "shortName", "abbreviation", "name", "teamName") || "TBC");
}
function card(match) {
  const teams = pick(match, "teams") || [];
  const t1 = pick(match, "team1", "homeTeam", "firstTeam") || teams[0] || match?.innings?.[0]?.team;
  const t2 = pick(match, "team2", "awayTeam", "secondTeam") || teams[1] || match?.innings?.[1]?.team;
  // OpenCricket live responses put each team's display score inside teams[].score.
  // Fall back to the team object itself so score() can render its score field.
  const s1 = pick(match, "team1Score", "score1", "score.home", "scores.0", "innings.0") || t1;
  const s2 = pick(match, "team2Score", "score2", "score.away", "scores.1", "innings.1") || t2;
  const competition = pick(match, "competition.name", "competitionName", "series", "tournament") || "Cricket";
  const venue = pick(match, "venue.name", "venue", "ground") || "";
  const status = pick(match, "status", "state", "matchStatus", "statusText") || "Match update";
  const note = pick(match, "summary", "description", "result", "statusText") || "Follow match details and scorecard.";
  const id = pick(match, "id", "matchId", "match_id") || "";
  const safeId = /^[a-zA-Z0-9_-]+$/.test(String(id)) ? String(id) : "";
  return `<article class="match-card">
    <div class="match-meta"><span class="live">● ${escapeHtml(String(status).toUpperCase())}</span><span>${escapeHtml(competition)}${venue ? " • " + escapeHtml(venue) : ""}</span></div>
    <div class="team"><span>${teamName(t1)}</span><strong>${score(s1)}</strong></div>
    <div class="team"><span>${teamName(t2)}</span><strong>${score(s2)}</strong></div>
    <p class="match-desc">${escapeHtml(note)}</p>
    <div class="card-links">${safeId ? `<a href="/api/matches/${encodeURIComponent(safeId)}/scorecard" target="_blank" rel="noreferrer">Scorecard ↗</a>` : ""}<a href="/api/matches" target="_blank" rel="noreferrer">Matches API ↗</a></div>
  </article>`;
}
async function load() {
  matchesEl.innerHTML = '<div class="empty">Loading cricket data…</div>';
  try {
    const state = $("#state").value;
    const [healthResponse, matchResponse] = await Promise.all([
      fetch("/api/health"),
      fetch(`/api/live?state=${encodeURIComponent(state)}`)
    ]);
    const health = await healthResponse.json();
    const payload = await matchResponse.json();
    if (!matchResponse.ok) throw new Error(payload?.error?.message || "Could not load matches");
    const matches = listFrom(payload);
    matchesEl.innerHTML = matches.length
      ? matches.map(card).join("")
      : '<div class="empty">No matches were returned for this filter. Try “All today” or “Upcoming today”. If this persists, check the API provider dashboard and server logs.</div>';
    statusEl.classList.toggle("ok", health.ok && matchResponse.ok);
    statusEl.classList.remove("error");
    $("#statusText").textContent = health.keyConfigured ? "API connected" : "API server running — key not configured";
    $("#updated").textContent = `Checked ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    matchesEl.innerHTML = `<div class="empty error-card"><strong>Could not load cricket data.</strong><p>${escapeHtml(error.message)}</p><p class="small">Add your OpenCricket key to .env, restart the server, then refresh.</p></div>`;
    statusEl.classList.add("error");
    statusEl.classList.remove("ok");
    $("#statusText").textContent = "Data unavailable";
  }
}
$("#refresh").addEventListener("click", load);
$("#state").addEventListener("change", load);
$("#copyEndpoint").addEventListener("click", async () => {
  const url = `${location.origin}/api/live?state=${encodeURIComponent($("#state").value)}`;
  try {
    await navigator.clipboard.writeText(url);
    $("#copyEndpoint").textContent = "Copied";
    setTimeout(() => $("#copyEndpoint").textContent = "Copy URL", 1200);
  } catch { window.prompt("Copy this API URL:", url); }
});
load();
// The browser polls YOUR cached API, not the provider directly.
// The server-side cache TTL protects your upstream monthly quota.
refreshTimer = setInterval(load, 30000);
