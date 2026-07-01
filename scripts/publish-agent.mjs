#!/usr/bin/env node
/**
 * WELAYDAILY AUTO-PUBLISH AGENT
 * ---------------------------------------------------------------
 * Runs on a schedule via GitHub Actions (see .github/workflows/publish.yml).
 *
 * Pipeline:
 *   1. SCAN    -> Gemini 2.5 Flash + Google Search grounding finds latest soccer news
 *   2. REWRITE -> Gemini paraphrases fully into original wording (copyright-safe)
 *   3. IMAGE   -> A unique, on-brand cartoon-style SVG graphic is generated locally
 *                 for each story (no external image API, no quota, no cost, ever)
 *   4. PUBLISH -> Article + image saved into /docs/data/articles.json + /docs/images/
 *
 * Requires one secret: GEMINI_API_KEY (free, from https://aistudio.google.com/apikey)
 * Everything else (GitHub Actions, GitHub Pages/raw hosting, image generation) is free
 * with zero quota risk.
 * ---------------------------------------------------------------
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY environment variable / secret. Get one free at https://aistudio.google.com/apikey");
  process.exit(1);
}

const TEXT_MODEL = "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Note: OPENAI_API_KEY is optional — if absent the bot falls back to SVG graphics.
// Set it as a GitHub secret named OPENAI_API_KEY to enable real AI cartoon images.

const DATA_DIR = path.join(process.cwd(), "docs", "data");
const IMAGES_DIR = path.join(process.cwd(), "docs", "images");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");

// How many fresh stories to attempt per run. Keep modest to respect free-tier limits.
const MAX_ARTICLES_PER_RUN = Number(process.env.MAX_ARTICLES_PER_RUN || 4);

const TOPICS = [
  "latest soccer football transfer news today",
  "Premier League match results and reaction today",
  "Champions League news today",
  "La Liga news today",
  "African football CAF news today",
  "MLS soccer news today",
  "World Cup 2026 qualifiers news today",
];

// ---------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------

function pickTopics(n) {
  const shuffled = [...TOPICS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

async function readJsonSafe(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function hashOf(str) {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------
// Step 1 + 2: Scan latest news AND rewrite it, in one grounded call
// ---------------------------------------------------------------

async function scanAndRewrite(topic) {
  const url = `${API_BASE}/${TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = `You are a football (soccer) news journalist for WelayDaily, an independent football news website.

Using current web search results, find one specific, real, recent news story about: "${topic}"

Then write a completely original article in your own words based on what you find. CRITICAL RULES:
- Never copy sentences or phrases verbatim from any source — full paraphrase only
- Do not quote anyone directly with quotation marks
- Write naturally, like a sports journalist, not like a summary of an article
- Be specific: real team names, real player names, real scorelines/facts as reported
- If you cannot find a genuinely current/real story for this topic, respond with {"skip": true} and nothing else

Respond ONLY with valid JSON (no markdown fences, no commentary) in this exact shape:
{
  "headline": "Punchy 8-14 word headline",
  "league": "One of: Premier League, La Liga, Champions League, Bundesliga, Serie A, Ligue 1, MLS, CAF Champions League, AFCON, World Cup Qualifiers, Transfer News, Other",
  "summary": "Two-sentence engaging summary, fully original wording",
  "body": "Three short paragraphs separated by \\n\\n, ~150 words total, fully original wording",
  "scene_description": "A vivid 40-60 word description of the story's key visual moment for an AI image generator. Be specific: mention the national team colors or kit colors involved, the type of moment (goal celebration, trophy lift, penalty save, transfer announcement, crowd reaction), the stadium or city if known, the scoreline if applicable, and the emotional tone. Example: 'Mexican players in green kits celebrate wildly on the pitch, scoreboard reading MEX 2-0 ECU, packed stadium with Mexican flags waving, confetti falling under stadium lights, jubilant crowd atmosphere'.",
  "tags": ["2-4 short topical tags"]
}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.7 },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini text API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n") ?? "";
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in Gemini response: " + clean.slice(0, 200));

  const parsed = JSON.parse(clean.slice(start, end + 1));
  return parsed;
}

// ---------------------------------------------------------------
// Step 3: Generate a unique, on-brand cartoon-style SVG graphic
// for the story locally (no external API, no quota, no cost).
// ---------------------------------------------------------------

// League-themed color pairs + emoji icon, used to vary each article's
// generated graphic so the site doesn't look repetitive.
const LEAGUE_THEMES = {
  "Premier League":        { colors: ["#37003C", "#00B050"], icon: "⚽" },
  "La Liga":               { colors: ["#EE1B23", "#0A1A0F"], icon: "⚽" },
  "Bundesliga":            { colors: ["#D20515", "#0A1A0F"], icon: "⚽" },
  "Serie A":               { colors: ["#024494", "#0A1A0F"], icon: "⚽" },
  "Ligue 1":               { colors: ["#091C3E", "#00B050"], icon: "⚽" },
  "Champions League":      { colors: ["#0A1A4A", "#00B050"], icon: "🏆" },
  "MLS":                   { colors: ["#0E1A3C", "#00B050"], icon: "⭐" },
  "CAF Champions League":  { colors: ["#7A1B1B", "#0A1A0F"], icon: "🌍" },
  "AFCON":                 { colors: ["#1B5E20", "#0A1A0F"], icon: "🌍" },
  "World Cup Qualifiers":  { colors: ["#0A1A4A", "#F5C518"], icon: "🌍" },
  "Transfer News":         { colors: ["#0A1A0F", "#00B050"], icon: "🔄" },
};
const DEFAULT_THEME = { colors: ["#0A1A0F", "#163A22"], icon: "⚽" };

// Deterministic-ish small variation so even same-league articles don't
// look identical (rotates accent angle / pattern based on the headline).
function hashToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function buildArticleSvg(headline, league) {
  const theme = LEAGUE_THEMES[league] || DEFAULT_THEME;
  const [colorA, colorB] = theme.colors;
  const seed = hashToInt(headline || league || "welaydaily");
  const angle = 20 + (seed % 50); // 20-70 degree gradient variation
  const ringOpacity = (0.06 + (seed % 5) * 0.01).toFixed(2);

  return `<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${colorA}"/>
      <stop offset="100%" stop-color="${colorB}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#00B050" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#00B050" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#glow)"/>

  <circle cx="640" cy="320" r="190" fill="none" stroke="#ffffff" stroke-opacity="${ringOpacity}" stroke-width="3"/>
  <circle cx="640" cy="320" r="130" fill="none" stroke="#ffffff" stroke-opacity="${ringOpacity}" stroke-width="2"/>
  <line x1="0" y1="320" x2="1280" y2="320" stroke="#ffffff" stroke-opacity="0.05" stroke-width="2"/>
  <line x1="640" y1="0" x2="640" y2="640" stroke="#ffffff" stroke-opacity="0.05" stroke-width="2"/>

  <g transform="translate(640,300)">
    <circle r="70" fill="rgba(255,255,255,0.08)"/>
    <text x="0" y="28" text-anchor="middle" font-size="80">${theme.icon}</text>
  </g>

  <text x="640" y="450" text-anchor="middle" font-family="'Bebas Neue', sans-serif" font-size="52" letter-spacing="4" fill="#F5F5F0">
    WELAY<tspan fill="#00B050">DAILY</tspan>
  </text>

  <rect x="490" y="490" width="300" height="26" rx="13" fill="rgba(0,0,0,0.5)"/>
  <text x="640" y="508" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" letter-spacing="2" fill="#00B050">
    ${(league || "FOOTBALL").toUpperCase()}
  </text>
</svg>
`;
}

async function generateCartoonImage(article, outFilePath) {
  // Try OpenAI gpt-image-1-mini first — real AI cartoon scene per story.
  // Falls back to branded SVG graphic instantly if OpenAI is unavailable/quota hit.
  if (OPENAI_API_KEY) {
    try {
      const sceneDesc = article.scene_description || article.summary || article.headline;
      const league = article.league || "Football";

      // Rich prompt strategy:
      // - Public domain elements (flags, national colors, scorelines, stadium architecture,
      //   team kit colors) are INCLUDED — these aren't copyrightable
      // - People/faces are cartoonized to avoid likeness rights
      // - Club crests/logos are stylized/simplified (not exact reproductions)
      // - Overall style: bold graphic design poster, not generic stock art
      const imagePrompt =
        `Create a bold, dramatic editorial sports graphic for a football news website. ` +
        `Style: vibrant graphic design poster combining flat-color comic book illustration ` +
        `with sports magazine energy — think dynamic composition, bold typography feel, ` +
        `vivid saturated colors, strong visual hierarchy. ` +
        `\n\nStory scene: ${sceneDesc}. League context: ${league}. ` +
        `\n\nVisual guidelines: ` +
        `Include real national flags, team kit colors, scoreboard text, stadium architecture, ` +
        `crowd atmosphere, confetti, and match facts where relevant — these add authenticity. ` +
        `Players and coaches must be stylized cartoon/illustrated figures — expressive faces ` +
        `allowed but NOT photorealistic portraits of real individuals. ` +
        `Club badges/crests should be simplified geometric interpretations, not exact logo reproductions. ` +
        `Background: packed stadium atmosphere with dramatic lighting. ` +
        `Format: wide 16:9 landscape, cinematic and energetic. ` +
        `Output a single cohesive image — no text overlays, no split panels.`;

      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: imagePrompt,
          n: 1,
          size: "1536x1024",   // landscape, closest to 16:9
          quality: "low",      // $0.011/image at low quality — cheapest option
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI image API error (${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = await res.json();
      const b64 = data?.data?.[0]?.b64_json;
      if (!b64) throw new Error("No image data in OpenAI response");

      // Save as PNG — change file extension accordingly
      const pngPath = outFilePath.replace(/\.svg$/, ".png");
      await fs.writeFile(pngPath, Buffer.from(b64, "base64"));
      console.log(`  ✓ AI cartoon image generated via OpenAI`);
      return pngPath; // caller uses this to determine the final filename
    } catch (err) {
      console.warn(`  ⚠ OpenAI image failed, using SVG fallback: ${err.message}`);
    }
  }

  // SVG fallback — always works, zero cost, league-themed branded graphic
  const svg = buildArticleSvg(article.headline, article.league);
  await fs.writeFile(outFilePath, svg, "utf-8");
  console.log(`  ✓ SVG fallback graphic generated`);
  return outFilePath;
}

// ---------------------------------------------------------------
// Step 4: Publish — merge into articles.json, write image
// ---------------------------------------------------------------

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });

  const existing = await readJsonSafe(ARTICLES_FILE, { articles: [] });
  const existingHeadlines = new Set(existing.articles.map(a => a.headline));

  const topics = pickTopics(MAX_ARTICLES_PER_RUN);
  console.log(`WelayDaily agent run started — ${new Date().toISOString()}`);
  console.log(`Topics this run: ${topics.join(" | ")}`);

  const newArticles = [];

  for (const topic of topics) {
    try {
      console.log(`\n→ Scanning + rewriting: "${topic}"`);
      const article = await scanAndRewrite(topic);

      if (article.skip) {
        console.log("  (skipped — no current story found for this topic)");
        continue;
      }
      if (!article.headline || existingHeadlines.has(article.headline)) {
        console.log("  (skipped — duplicate or missing headline)");
        continue;
      }

      const id = `${slugify(article.headline)}-${hashOf(article.headline + Date.now())}`;
      const svgPath = path.join(IMAGES_DIR, `${id}.svg`); // default; OpenAI returns PNG

      console.log(`  ✓ Article written: "${article.headline}"`);
      console.log(`  → Generating cartoon image...`);

      const savedPath = await generateCartoonImage(article, svgPath);
      const imageFilename = path.basename(savedPath); // e.g. "slug-abc.png" or "slug-abc.svg"

      newArticles.push({
        id,
        headline: article.headline,
        league: article.league || "Football",
        summary: article.summary,
        body: article.body,
        tags: article.tags || [],
        image: `images/${imageFilename}`,
        publishedAt: new Date().toISOString(),
      });

      existingHeadlines.add(article.headline);

      // Gentle pacing to stay well within free-tier rate limits
      await new Promise(r => setTimeout(r, 4000));
    } catch (err) {
      console.error(`  ✗ Failed on topic "${topic}": ${err.message}`);
    }
  }

  const merged = {
    articles: [...newArticles, ...existing.articles].slice(0, 60), // keep latest 60
    lastRun: new Date().toISOString(),
  };

  await fs.writeFile(ARTICLES_FILE, JSON.stringify(merged, null, 2));
  console.log(`\n✓ Published ${newArticles.length} new article(s). Total stored: ${merged.articles.length}`);

  await regenerateSitemap(merged.articles);
}

// ---------------------------------------------------------------
// Keep sitemap.xml in sync with published articles (helps Google
// actually discover and index individual article pages)
// ---------------------------------------------------------------

async function regenerateSitemap(articles) {
  const SITE = "https://www.welaydaily.com";
  const staticUrls = [
    { loc: `${SITE}/`, changefreq: "hourly", priority: "1.0" },
    { loc: `${SITE}/about.html`, changefreq: "monthly", priority: "0.5" },
    { loc: `${SITE}/privacy.html`, changefreq: "monthly", priority: "0.3" },
    { loc: `${SITE}/contact.html`, changefreq: "monthly", priority: "0.3" },
  ];

  const articleUrls = articles.map(a => ({
    loc: `${SITE}/article.html?id=${encodeURIComponent(a.id)}`,
    changefreq: "never",
    priority: "0.7",
    lastmod: a.publishedAt ? a.publishedAt.slice(0, 10) : undefined,
  }));

  const allUrls = [...staticUrls, ...articleUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allUrls
    .map(
      u => `  <url>\n    <loc>${u.loc}</loc>\n${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ""}    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join("\n")}\n</urlset>\n`;

  const sitemapPath = path.join(process.cwd(), "docs", "sitemap.xml");
  await fs.writeFile(sitemapPath, xml);
  console.log(`✓ sitemap.xml updated (${allUrls.length} URLs)`);
}

main().catch(err => {
  console.error("Fatal agent error:", err);
  process.exit(1);
});
