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
 * Requires secrets: GEMINI_API_KEY, OPENAI_API_KEY, API_FOOTBALL_KEY
 * ---------------------------------------------------------------
 */

import fs from "node:fs/promises";
import path from "node:path";
import { CURATED_PLAYERS, CURATED_CLUBS } from "./profile-seed-data.mjs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY secret.");
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
const CURRENT_SEASON = 2025; // API-Football uses the year the season STARTS (2025-26 season = 2025)

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
1. Current status/team and a career overview grounded in the real stats above
2. Key achievements or notable characteristics, using the real numbers provided
3. A closing paragraph on their current form or standing this season

Rules:
- Only state facts consistent with the data given — do not invent trophies, transfer fees, or stats not in the data
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

async function buildPlayerProfile(seed) {
  console.log(`\n→ Building player profile: ${seed.name || seed.searchName}`);

  const searchResults = await afFetch(`/players?search=${encodeURIComponent(seed.searchName)}`);
  if (!searchResults || searchResults.length === 0) {
    console.warn(`  ⚠ No API-Football match found for "${seed.searchName}" — skipping`);
    return null;
  }

  // Take the first/best match. API-Football returns the player plus
  // their statistics array (one entry per competition/team for the season).
  const match = searchResults[0];
  const player = match.player;
  const statsEntries = match.statistics || [];

  // Prefer the entry with the most minutes played (their primary team/competition)
  const primaryStats = statsEntries.reduce((best, cur) => {
    const bestMin = best?.games?.minutes || 0;
    const curMin = cur?.games?.minutes || 0;
    return curMin > bestMin ? cur : best;
  }, statsEntries[0]);

  const team = primaryStats?.team?.name || "Unknown club";
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
- Current club (this season): ${team}
- Position: ${position}
- Appearances this season: ${appearances}
- Goals this season: ${goals}
- Assists this season: ${assists}
- Average match rating this season: ${rating}
`.trim();

  const narrative = await writeNarrative("player", seed.searchName, statsSummary);

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

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });

  console.log(`WelayDaily profile builder started — ${new Date().toISOString()}`);
  console.log(`Building ${CURATED_PLAYERS.length} player profiles and ${CURATED_CLUBS.length} club profiles.`);
  console.log(`API-Football call budget for this run: ${MAX_AF_CALLS_PER_RUN}`);

  const players = [];
  for (const seed of CURATED_PLAYERS) {
    try {
      const profile = await buildPlayerProfile(seed);
      if (profile) {
        players.push(profile);
        console.log(`  ✓ Built: ${profile.name}`);
      }
    } catch (err) {
      console.error(`  ✗ Failed on ${seed.searchName}: ${err.message}`);
      if (err.message.includes("budget for this run exhausted")) break;
    }
    await new Promise(r => setTimeout(r, 1500)); // gentle pacing
  }

  const clubs = [];
  for (const seed of CURATED_CLUBS) {
    try {
      const profile = await buildClubProfile(seed);
      if (profile) {
        clubs.push(profile);
        console.log(`  ✓ Built: ${profile.name}`);
      }
    } catch (err) {
      console.error(`  ✗ Failed on ${seed.searchName}: ${err.message}`);
      if (err.message.includes("budget for this run exhausted")) break;
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  await fs.writeFile(
    path.join(DATA_DIR, "players.json"),
    JSON.stringify({ players, updatedAt: new Date().toISOString() }, null, 2)
  );
  await fs.writeFile(
    path.join(DATA_DIR, "clubs.json"),
    JSON.stringify({ clubs, updatedAt: new Date().toISOString() }, null, 2)
  );

  console.log(`\n✓ Wrote ${players.length} player profiles and ${clubs.length} club profiles.`);
  console.log(`Total API-Football calls used this run: ${apiFootballCallsThisRun}`);
}

main().catch(err => {
  console.error("Fatal profile builder error:", err);
  process.exit(1);
});
