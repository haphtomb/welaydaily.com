#!/usr/bin/env node
/**
 * WELAYDAILY PROFILE BUILDER
 * ---------------------------------------------------------------
 * Builds player and club profile pages using real structured data,
 * combined with AI-written narrative context and AI-generated
 * cartoon illustrations. Designed to run WEEKLY (not every 3 hours
 * like the news bot) since profile data doesn't change often and
 * this respects API-Football's 100 requests/day free tier.
 *
 * Pipeline per player/club:
 *   1. FETCH   -> API-Football: search by name, get stats/career/squad
 *   2. IMAGE   -> TheSportsDB: fetch real photo/badge as visual reference
 *   3. WRITE   -> Gemini writes a grounded narrative bio using the
 *                 real stats (not generic filler — actual numbers)
 *   4. ILLUSTRATE -> OpenAI generates a cartoon illustration per profile
 *   5. PUBLISH -> Writes docs/data/players.json and docs/data/clubs.json
 *
 * Requires secrets: GEMINI_API_KEY_PROFILES, OPENAI_API_KEY, API_FOOTBALL_KEY
 *
 * NOTE: This uses a SEPARATE Gemini API key/account (GEMINI_API_KEY_PROFILES)
 * from the one the news bot uses (GEMINI_API_KEY). Gemini's free tier has a
 * very low daily request cap (~20/day for gemini-2.5-flash at time of writing),
 * which the news bot alone can approach on its own 8-runs/day schedule. Sharing
 * one key between both bots causes both to silently fail with 429 quota
 * errors. Keeping them on separate free-tier accounts avoids this entirely.
 * ---------------------------------------------------------------
 */

import fs from "node:fs/promises";
import path from "node:path";
import { CURATED_PLAYERS, CURATED_CLUBS } from "./profile-seed-data.mjs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY_PROFILES;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY_PROFILES secret. This should be a SEPARATE Gemini API key/account from the news bot's GEMINI_API_KEY, to avoid sharing the free tier's ~20 requests/day cap between both bots. Get one free at https://aistudio.google.com/apikey using a different Google account.");
  process.exit(1);
}
if (!API_FOOTBALL_KEY) {
  console.error("Missing API_FOOTBALL_KEY secret. Get one free at https://dashboard.api-football.com");
  process.exit(1);
}

const TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const AF_BASE = "https://v3.football.api-sports.io";
const SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/123";

const DATA_DIR = path.join(process.cwd(), "docs", "data");
const IMAGES_DIR = path.join(process.cwd(), "docs", "images", "profiles");
// API-Football's FREE TIER only has access to seasons 2022–2024 — it does
// NOT include the current 2025-26 season. Using season: 2025 causes every
// single request to fail with "Free plans do not have access to this
// season, try from 2022 to 2024." Using the most recent free-tier-covered
// season (2024) as a real, honest trade-off: profiles show last completed
// season's stats rather than the live current campaign. This is disclosed
// to readers via the "stats as of" language in the profile pages.
const CURRENT_SEASON = 2024;

// Gemini's free tier has a low requests-per-minute limit. Spacing calls
// out this much protects against 429 quota errors when building 30
// profiles in one run (each profile = 1 Gemini call for the narrative).
const GEMINI_PACING_MS = 8000;

// Simple request counter so a single run never blows past the free
// 100/day quota even if something loops unexpectedly.
let apiFootballCallsThisRun = 0;
const MAX_AF_CALLS_PER_RUN = 90; // leave headroom below the 100/day cap

async function afFetch(endpoint) {
  if (apiFootballCallsThisRun >= MAX_AF_CALLS_PER_RUN) {
    throw new Error("API-Football call budget for this run exhausted — stopping early to protect quota.");
  }
  apiFootballCallsThisRun++;
  const res = await fetch(`${AF_BASE}${endpoint}`, {
    headers: { "x-apisports-key": API_FOOTBALL_KEY },
  });
  if (!res.ok) {
    throw new Error(`API-Football error (${res.status}) on ${endpoint}`);
  }
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`API-Football returned errors on ${endpoint}: ${JSON.stringify(data.errors)}`);
  }
  return data.response;
}

async function sportsDbFetch(endpoint) {
  try {
    const res = await fetch(`${SPORTSDB_BASE}${endpoint}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // TheSportsDB is a bonus enrichment source — never fatal if it fails
  }
}

// ---------------------------------------------------------------
// Gemini: write a grounded narrative bio from real stats
// ---------------------------------------------------------------

async function writeNarrative(kind, name, statsSummary) {
  const url = `${GEMINI_API_BASE}/${TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = `You are a football encyclopedia writer for WelayDaily, a football news and stats site.

Write a substantive, factual profile summary for this ${kind === "player" ? "player" : "club"}: ${name}

Here is real, verified statistical data to ground your writing — use these actual numbers, don't invent different ones:
${statsSummary}

Write 3 short paragraphs (about 180-220 words total):
1. Overview and club/team context grounded in the real stats above
2. Key achievements or notable characteristics, using the real numbers provided
3. A closing paragraph summarizing their standing based on the ${CURRENT_SEASON}-${CURRENT_SEASON + 1} season data provided

Rules:
- Only state facts consistent with the data given — do not invent trophies, transfer fees, or stats not in the data
- Do NOT describe the ${CURRENT_SEASON}-${CURRENT_SEASON + 1} season data as "current" or "this season" — refer to it as "the ${CURRENT_SEASON}-${CURRENT_SEASON + 1} season" specifically, since it may not be the most recent completed season
- Write in an engaging but factual encyclopedia tone, not hype-filled marketing copy
- If the data provided is sparse, write a shorter but still accurate profile rather than padding with speculation

Respond ONLY with valid JSON (no markdown fences):
{
  "summary": "One-sentence, punchy overview (under 25 words)",
  "bio": "The 3-paragraph profile, paragraphs separated by \\n\\n",
  "scene_description": "A 40-60 word description of a cartoon illustration scene for this ${kind} — action pose, kit colors, stadium setting if a player; or crest colors, stadium exterior, fan atmosphere if a club. No real face likeness for players — generic athletic cartoon figure in the right kit colors."
}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.5 },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n") ?? "";
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in Gemini narrative response");
  return JSON.parse(clean.slice(start, end + 1));
}

// ---------------------------------------------------------------
// OpenAI: cartoon illustration per profile
// ---------------------------------------------------------------

async function generateProfileImage(sceneDescription, outPath) {
  if (!OPENAI_API_KEY) return null; // graceful: no image if key absent

  const prompt =
    `Create a bold, dynamic graphic-design style sports illustration. ` +
    `Style: vibrant flat-color comic illustration combined with sports poster energy, ` +
    `bold composition, saturated colors. ` +
    `Scene: ${sceneDescription}. ` +
    `Real kit colors, crests (simplified/stylized, not exact logo reproduction), and stadium ` +
    `atmosphere are welcome for authenticity. Any people shown must be stylized cartoon figures, ` +
    `not photorealistic portraits of real individuals. ` +
    `Format: square or portrait-friendly composition, energetic and professional.`;

  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "low",
      }),
    });
    if (!res.ok) throw new Error(`OpenAI error (${res.status})`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data in OpenAI response");
    await fs.writeFile(outPath, Buffer.from(b64, "base64"));
    return true;
  } catch (err) {
    console.warn(`  ⚠ Image generation failed: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------
// Player profile builder
// ---------------------------------------------------------------
//
// API-Football's /players endpoint requires either a team+season or
// league+season combination — pure name-only search is rejected with
// a "League or Team field is required" error. So the real lookup path
// is two calls: resolve the player's club to a team ID (reusing the
// same /teams?search= endpoint that already works for club profiles),
// then pull that team's full squad stats via /players?team=X&season=Y
// and find our target by name within the response.
//
// This means each CURATED_PLAYERS entry needs a `club` hint (the
// current club to search within) — see profile-seed-data.mjs.

function normalizeNameForMatch(name) {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z\s]/g, "")
    .replace(/\bjr\b|\bjunior\b/g, "junior") // normalize "Jr."/"Jr"/"Junior" variants
    .trim();
}

// Word-overlap based matching: robust against full legal names
// (e.g. API returns "Vinícius José Paixão de Oliveira Júnior" for
// the player commonly known as "Vinicius Junior"). We check whether
// enough of the search name's significant words appear in the
// candidate's full name or known/common name, rather than requiring
// an exact substring match either direction.
function namesLikelyMatch(searchName, firstname, lastname, knownName) {
  const targetWords = normalizeNameForMatch(searchName).split(/\s+/).filter(w => w.length > 1);
  const full = normalizeNameForMatch(`${firstname || ""} ${lastname || ""}`);
  const known = normalizeNameForMatch(knownName || "");
  const haystack = `${full} ${known}`;

  if (targetWords.length === 0) return false;

  // Single-word search names (e.g. "Rodri", "Pedri") — require exact
  // whole-word presence, not just substring, to avoid false positives.
  if (targetWords.length === 1) {
    const haystackWords = haystack.split(/\s+/);
    return haystackWords.includes(targetWords[0]) || known === targetWords[0];
  }

  // Multi-word search names — require ALL significant words to appear
  // somewhere in the combined haystack (order-independent).
  return targetWords.every(w => haystack.includes(w));
}

async function buildPlayerProfile(seed) {
  console.log(`\n→ Building player profile: ${seed.searchName}`);

  if (!seed.club) {
    console.warn(`  ⚠ No club hint provided for "${seed.searchName}" — skipping (see profile-seed-data.mjs)`);
    return null;
  }

  // Step 1: resolve the club name to a team ID
  const teamResults = await afFetch(`/teams?search=${encodeURIComponent(seed.club)}`);
  if (!teamResults || teamResults.length === 0) {
    console.warn(`  ⚠ Could not resolve club "${seed.club}" for player "${seed.searchName}" — skipping`);
    return null;
  }
  const teamId = teamResults[0].team.id;

  // Step 2: pull that team's full squad + stats for the season, then
  // find our target player by (normalized, accent-insensitive) name match.
  const squadResults = await afFetch(`/players?team=${teamId}&season=${CURRENT_SEASON}`);
  if (!squadResults || squadResults.length === 0) {
    console.warn(`  ⚠ No squad data returned for team ID ${teamId} (${seed.club}) — skipping "${seed.searchName}"`);
    return null;
  }

  const match = squadResults.find(entry =>
    namesLikelyMatch(seed.searchName, entry.player.firstname, entry.player.lastname, entry.player.name)
  );

  if (!match) {
    // Fallback: try a scoped name search combined with the team ID, which
    // API-Football documents as a valid parameter combination. This can
    // succeed in cases where the plain squad listing is incomplete or
    // paginated in a way that misses the player.
    try {
      const searchResults = await afFetch(`/players?search=${encodeURIComponent(seed.searchName.split(" ").pop())}&team=${teamId}&season=${CURRENT_SEASON}`);
      const fallbackMatch = (searchResults || []).find(entry =>
        namesLikelyMatch(seed.searchName, entry.player.firstname, entry.player.lastname, entry.player.name)
      );
      if (fallbackMatch) {
        return finalizePlayerProfile(seed, fallbackMatch);
      }
    } catch (fallbackErr) {
      console.warn(`  ⚠ Fallback search also failed: ${fallbackErr.message}`);
    }

    const actualNames = squadResults.slice(0, 25).map(e => e.player.name || `${e.player.firstname || ""} ${e.player.lastname || ""}`.trim()).join(", ");
    console.warn(`  ⚠ "${seed.searchName}" not found in ${seed.club}'s ${CURRENT_SEASON} squad response — skipping`);
    console.warn(`    (squad returned ${squadResults.length} entries; first ~25 names: ${actualNames})`);
    return null;
  }

  return finalizePlayerProfile(seed, match);
}

// Extracted so both the primary squad-lookup path and the search+team
// fallback path can share identical downstream processing (stats
// extraction, narrative writing, image generation).
async function finalizePlayerProfile(seed, match) {

  const player = match.player;
  const statsEntries = match.statistics || [];
  const primaryStats = statsEntries.reduce((best, cur) => {
    const bestMin = best?.games?.minutes || 0;
    const curMin = cur?.games?.minutes || 0;
    return curMin > bestMin ? cur : best;
  }, statsEntries[0]);

  const team = primaryStats?.team?.name || seed.club;
  const position = primaryStats?.games?.position || "Unknown position";
  const appearances = primaryStats?.games?.appearences ?? "N/A";
  const goals = primaryStats?.goals?.total ?? "N/A";
  const assists = primaryStats?.goals?.assists ?? "N/A";
  const rating = primaryStats?.games?.rating ? Number(primaryStats.games.rating).toFixed(2) : "N/A";
  const nationality = player.nationality || "Unknown";
  const age = player.age ?? "Unknown";
  const height = player.height || "N/A";

  const statsSummary = `
- Full name: ${player.firstname || ""} ${player.lastname || ""}
- Nationality: ${nationality}
- Age: ${age}
- Height: ${height}
- Club (${CURRENT_SEASON}-${CURRENT_SEASON + 1} season): ${team}
- Position: ${position}
- Appearances (${CURRENT_SEASON}-${CURRENT_SEASON + 1} season): ${appearances}
- Goals (${CURRENT_SEASON}-${CURRENT_SEASON + 1} season): ${goals}
- Assists (${CURRENT_SEASON}-${CURRENT_SEASON + 1} season): ${assists}
- Average match rating (${CURRENT_SEASON}-${CURRENT_SEASON + 1} season): ${rating}
`.trim();

  const narrative = await writeNarrative("player", seed.searchName, statsSummary);
  await new Promise(r => setTimeout(r, GEMINI_PACING_MS)); // spread out Gemini calls to respect free-tier RPM

  // Bonus: try to enrich with a real photo/thumbnail from TheSportsDB
  const sportsDbData = await sportsDbFetch(`/searchplayers.php?p=${encodeURIComponent(seed.searchName)}`);
  const sportsDbPlayer = sportsDbData?.player?.[0];
  const realPhotoUrl = sportsDbPlayer?.strThumb || sportsDbPlayer?.strCutout || null;

  const imageFile = `${seed.slug}.png`;
  const imagePath = path.join(IMAGES_DIR, imageFile);
  const imageGenerated = await generateProfileImage(narrative.scene_description, imagePath);

  return {
    slug: seed.slug,
    name: seed.searchName,
    photoUrl: player.photo || realPhotoUrl || null,
    illustration: imageGenerated ? `images/profiles/${imageFile}` : null,
    nationality,
    age,
    height,
    currentClub: team,
    position,
    stats: { appearances, goals, assists, rating },
    statsSeasonLabel: `${CURRENT_SEASON}-${CURRENT_SEASON + 1}`,
    summary: narrative.summary,
    bio: narrative.bio,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------
// Club profile builder
// ---------------------------------------------------------------

async function buildClubProfile(seed) {
  console.log(`\n→ Building club profile: ${seed.name || seed.searchName}`);

  const teamResults = await afFetch(`/teams?search=${encodeURIComponent(seed.searchName)}`);
  if (!teamResults || teamResults.length === 0) {
    console.warn(`  ⚠ No API-Football match found for "${seed.searchName}" — skipping`);
    return null;
  }

  const match = teamResults[0];
  const team = match.team;
  const venue = match.venue;

  const statsSummary = `
- Club name: ${team.name}
- Founded: ${team.founded || "Unknown"}
- Country: ${team.country || "Unknown"}
- Home stadium: ${venue?.name || "Unknown"} (capacity: ${venue?.capacity ?? "Unknown"})
- Stadium city: ${venue?.city || "Unknown"}
`.trim();

  const narrative = await writeNarrative("club", seed.searchName, statsSummary);
  await new Promise(r => setTimeout(r, GEMINI_PACING_MS)); // spread out Gemini calls to respect free-tier RPM

  const imageFile = `${seed.slug}.png`;
  const imagePath = path.join(IMAGES_DIR, imageFile);
  const imageGenerated = await generateProfileImage(narrative.scene_description, imagePath);

  return {
    slug: seed.slug,
    name: team.name,
    crestUrl: team.logo || null,
    illustration: imageGenerated ? `images/profiles/${imageFile}` : null,
    founded: team.founded || null,
    country: team.country || null,
    stadium: venue?.name || null,
    stadiumCapacity: venue?.capacity ?? null,
    stadiumCity: venue?.city || null,
    summary: narrative.summary,
    bio: narrative.bio,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------
//
// RESUME LOGIC: because Gemini's free tier only allows ~20 requests/day
// (see build-profiles.yml notes), building all 30 profiles (20 players +
// 10 clubs) in one run isn't always possible. Rather than requiring
// manual batching, this script loads whatever profiles already exist,
// skips anyone already built (unless older than REBUILD_AFTER_DAYS),
// and only works on what's still missing. Just re-running the same
// workflow on subsequent days will naturally fill in the rest.

const REBUILD_AFTER_DAYS = 30; // refresh a profile's data/narrative after this long

async function readJsonSafe(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isStale(profile) {
  if (!profile?.updatedAt) return true;
  const ageMs = Date.now() - new Date(profile.updatedAt).getTime();
  return ageMs > REBUILD_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });

  const existingPlayersData = await readJsonSafe(path.join(DATA_DIR, "players.json"), { players: [] });
  const existingClubsData = await readJsonSafe(path.join(DATA_DIR, "clubs.json"), { clubs: [] });

  const existingPlayersBySlug = new Map(existingPlayersData.players.map(p => [p.slug, p]));
  const existingClubsBySlug = new Map(existingClubsData.clubs.map(c => [c.slug, c]));

  let playersToBuild = CURATED_PLAYERS.filter(seed => {
    const existing = existingPlayersBySlug.get(seed.slug);
    return !existing || isStale(existing);
  });
  let clubsToBuild = CURATED_CLUBS.filter(seed => {
    const existing = existingClubsBySlug.get(seed.slug);
    return !existing || isStale(existing);
  });

  // Optional debug limit — set TEST_LIMIT=3 (or any small number) as a
  // workflow_dispatch input / repo variable to safely verify a fix works
  // on just a couple of profiles before burning a full quota budget on
  // a run that might still have a bug. Leave unset for normal full runs.
  const testLimit = Number(process.env.TEST_LIMIT || 0);
  if (testLimit > 0) {
    playersToBuild = playersToBuild.slice(0, testLimit);
    clubsToBuild = clubsToBuild.slice(0, testLimit);
    console.log(`⚠ TEST_LIMIT=${testLimit} active — only attempting ${playersToBuild.length} players and ${clubsToBuild.length} clubs this run.`);
  }

  console.log(`WelayDaily profile builder started — ${new Date().toISOString()}`);
  console.log(`${existingPlayersBySlug.size}/${CURATED_PLAYERS.length} players already built, ${playersToBuild.length} to build/refresh this run.`);
  console.log(`${existingClubsBySlug.size}/${CURATED_CLUBS.length} clubs already built, ${clubsToBuild.length} to build/refresh this run.`);
  console.log(`API-Football call budget for this run: ${MAX_AF_CALLS_PER_RUN}`);

  let builtCount = 0;

  for (const seed of playersToBuild) {
    try {
      const profile = await buildPlayerProfile(seed);
      if (profile) {
        existingPlayersBySlug.set(seed.slug, profile); // overwrite/insert
        builtCount++;
        console.log(`  ✓ Built: ${profile.name}`);
      }
    } catch (err) {
      console.error(`  ✗ Failed on ${seed.searchName}: ${err.message}`);
      if (err.message.includes("budget for this run exhausted") || err.message.includes("429")) {
        console.log("  → Stopping early (quota limit hit). Remaining profiles will build on the next scheduled run.");
        break;
      }
    }
    await new Promise(r => setTimeout(r, 1500)); // gentle pacing
  }

  for (const seed of clubsToBuild) {
    try {
      const profile = await buildClubProfile(seed);
      if (profile) {
        existingClubsBySlug.set(seed.slug, profile);
        builtCount++;
        console.log(`  ✓ Built: ${profile.name}`);
      }
    } catch (err) {
      console.error(`  ✗ Failed on ${seed.searchName}: ${err.message}`);
      if (err.message.includes("budget for this run exhausted") || err.message.includes("429")) {
        console.log("  → Stopping early (quota limit hit). Remaining profiles will build on the next scheduled run.");
        break;
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  // Preserve original CURATED_PLAYERS/CURATED_CLUBS order in the output
  // files, rather than however Map insertion order happens to land.
  const players = CURATED_PLAYERS
    .map(seed => existingPlayersBySlug.get(seed.slug))
    .filter(Boolean);
  const clubs = CURATED_CLUBS
    .map(seed => existingClubsBySlug.get(seed.slug))
    .filter(Boolean);

  await fs.writeFile(
    path.join(DATA_DIR, "players.json"),
    JSON.stringify({ players, updatedAt: new Date().toISOString() }, null, 2)
  );
  await fs.writeFile(
    path.join(DATA_DIR, "clubs.json"),
    JSON.stringify({ clubs, updatedAt: new Date().toISOString() }, null, 2)
  );

  console.log(`\n✓ This run built/refreshed ${builtCount} profile(s).`);
  console.log(`✓ Total stored: ${players.length}/${CURATED_PLAYERS.length} players, ${clubs.length}/${CURATED_CLUBS.length} clubs.`);
  console.log(`Total API-Football calls used this run: ${apiFootballCallsThisRun}`);

  if (players.length < CURATED_PLAYERS.length || clubs.length < CURATED_CLUBS.length) {
    console.log(`→ Not all profiles are built yet. Re-run this workflow again (manually or wait for next Sunday) to continue filling in the rest.`);
  }
}

main().catch(err => {
  console.error("Fatal profile builder error:", err);
  process.exit(1);
});
