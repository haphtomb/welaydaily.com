#!/usr/bin/env node
/**
 * WELAYDAILY STANDINGS & FIXTURES SYNC
 * ---------------------------------------------------------------
 * Pulls standings + upcoming/recent fixtures from football-data.org's
 * free tier (12 competitions, 10 requests/minute, free forever, no card).
 *
 * Get a free API token at: https://www.football-data.org/client/register
 * Add it as the GitHub secret: FOOTBALL_DATA_API_KEY
 *
 * Free-tier competitions include (codes used by the API):
 *   PL  - Premier League
 *   PD  - La Liga
 *   BL1 - Bundesliga
 *   SA  - Serie A
 *   FL1 - Ligue 1
 *   CL  - UEFA Champions League
 *   WC  - FIFA World Cup
 * (MLS and CAF competitions are NOT in football-data.org's free tier —
 *  see the README for how those tables are sourced/maintained instead.)
 * ---------------------------------------------------------------
 */

import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
if (!API_KEY) {
  console.error("Missing FOOTBALL_DATA_API_KEY environment variable / secret.");
  console.error("Get a free key at https://www.football-data.org/client/register");
  process.exit(1);
}

const BASE = "https://api.football-data.org/v4";
const DATA_DIR = path.join(process.cwd(), "docs", "data");

// Competitions available on football-data.org's free tier
const COMPETITIONS = [
  { code: "PL", name: "Premier League" },
  { code: "PD", name: "La Liga" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA", name: "Serie A" },
  { code: "FL1", name: "Ligue 1" },
  { code: "CL", name: "Champions League" },
];

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "X-Auth-Token": API_KEY } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`football-data.org error (${res.status}) for ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchStandings(code) {
  const data = await fetchJson(`${BASE}/competitions/${code}/standings`);
  const table = data.standings?.find(s => s.type === "TOTAL")?.table ?? [];
  return table.map(row => ({
    position: row.position,
    team: row.team.name,
    crest: row.team.crest,
    played: row.playedGames,
    won: row.won,
    draw: row.draw,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDifference: row.goalDifference,
    points: row.points,
    form: row.form ? row.form.split(",") : [],
  }));
}

async function fetchFixtures(code) {
  const data = await fetchJson(`${BASE}/competitions/${code}/matches?status=SCHEDULED,LIVE,IN_PLAY,PAUSED,FINISHED`);
  return (data.matches ?? []).slice(-20).map(m => ({
    id: m.id,
    utcDate: m.utcDate,
    status: m.status,
    matchday: m.matchday,
    home: m.homeTeam.name,
    away: m.awayTeam.name,
    homeScore: m.score.fullTime.home,
    awayScore: m.score.fullTime.away,
  }));
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const result = { updatedAt: new Date().toISOString(), competitions: {} };

  for (const comp of COMPETITIONS) {
    try {
      console.log(`Fetching standings for ${comp.name}...`);
      const standings = await fetchStandings(comp.code);
      await new Promise(r => setTimeout(r, 6500)); // respect 10 req/min free limit

      console.log(`Fetching fixtures for ${comp.name}...`);
      const fixtures = await fetchFixtures(comp.code);
      await new Promise(r => setTimeout(r, 6500));

      result.competitions[comp.code] = { name: comp.name, standings, fixtures };
      console.log(`✓ ${comp.name}: ${standings.length} teams, ${fixtures.length} fixtures`);
    } catch (err) {
      console.error(`✗ Failed for ${comp.name}: ${err.message}`);
    }
  }

  await fs.writeFile(
    path.join(DATA_DIR, "standings.json"),
    JSON.stringify(result, null, 2)
  );
  console.log("\n✓ standings.json updated.");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
