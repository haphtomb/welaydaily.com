#!/usr/bin/env node
/**
 * WELAYDAILY AUTO-PUBLISH AGENT
 * ---------------------------------------------------------------
 * Runs on a schedule via GitHub Actions (see .github/workflows/publish.yml).
 *
 * Pipeline:
 *   1. SCAN    -> Gemini 2.5 Flash + Google Search grounding finds latest soccer news
 *   2. REWRITE -> Gemini paraphrases fully into original wording (copyright-safe)
 *   3. IMAGE   -> Gemini 2.5 Flash Image ("Nano Banana") generates a cartoon illustration
 *   4. PUBLISH -> Article + image saved into /data/articles.json + /docs/images/
 *
 * Requires one secret: GEMINI_API_KEY (free, from https://aistudio.google.com/apikey)
 * Everything else (GitHub Actions, GitHub Pages/raw hosting) is free.
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
const IMAGE_MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const DATA_DIR = path.join(process.cwd(), "data");
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
  "image_prompt": "A vivid, detailed description (40-70 words) of a CARTOON/ILLUSTRATED scene depicting this story for an AI image generator — e.g. stylized cartoon players, stadium, crest colors, action pose. Explicitly describe it as a colorful editorial cartoon illustration, NOT photorealistic, NOT depicting any real recognizable face -- generic stylized athletes only.",
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
// Step 3: Generate a cartoonized AI image for the story
// ---------------------------------------------------------------

async function generateCartoonImage(imagePrompt, outFilePath) {
  const url = `${API_BASE}/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const fullPrompt = `Create a vibrant, flat-color editorial cartoon illustration (NOT photorealistic) for a football/soccer news article. Style: bold outlines, simplified stylized characters, dynamic sports-poster composition, energetic color palette of greens and dark tones, no readable logos or real team crests, no real recognizable faces — generic stylized athletes only. Scene: ${imagePrompt}`;

  const body = {
    contents: [{ parts: [{ text: fullPrompt }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini image API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find(p => p.inlineData?.data);
  if (!imgPart) throw new Error("No image data returned from Gemini image model");

  const buffer = Buffer.from(imgPart.inlineData.data, "base64");
  await fs.writeFile(outFilePath, buffer);
  return true;
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

  // Before publishing anything new, try regenerating images for older
  // articles that are still stuck on the placeholder (e.g. from a prior
  // run that hit a Gemini image quota error). Keeps the backlog shrinking
  // automatically once quota recovers, with zero manual intervention.
  await retryPendingImages(existing.articles);

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
      const imageFile = `${id}.png`;
      const imagePath = path.join(IMAGES_DIR, imageFile);

      console.log(`  ✓ Article written: "${article.headline}"`);
      console.log(`  → Generating cartoon image...`);

      let imageRelPath = "images/placeholder.svg"; // fallback shown until real art is generated
      try {
        await generateCartoonImage(article.image_prompt || article.summary, imagePath);
        imageRelPath = `images/${imageFile}`;
        console.log(`  ✓ Image generated: ${imageFile}`);
      } catch (imgErr) {
        console.warn(`  ⚠ Image generation failed, using placeholder for now: ${imgErr.message}`);
      }

      newArticles.push({
        id,
        headline: article.headline,
        league: article.league || "Football",
        summary: article.summary,
        body: article.body,
        tags: article.tags || [],
        image: imageRelPath,
        imagePending: imageRelPath === "images/placeholder.svg",
        imagePrompt: article.image_prompt || article.summary, // kept so a retry pass can regenerate later
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
// Retry image generation for already-published articles that are
// still showing the placeholder (mutates the array in place).
// ---------------------------------------------------------------

async function retryPendingImages(articles) {
  const pending = articles.filter(a => a.imagePending);
  if (pending.length === 0) return;

  console.log(`\nRetrying images for ${pending.length} article(s) still on placeholder...`);

  // Cap retries per run so this can't eat the whole image quota before
  // new articles get a chance.
  const RETRY_LIMIT = 5;
  let attempted = 0;

  for (const article of pending) {
    if (attempted >= RETRY_LIMIT) break;
    attempted++;

    const imageFile = `${article.id}.png`;
    const imagePath = path.join(IMAGES_DIR, imageFile);

    try {
      console.log(`  → Retrying image for: "${article.headline}"`);
      await generateCartoonImage(article.imagePrompt || article.summary, imagePath);
      article.image = `images/${imageFile}`;
      article.imagePending = false;
      console.log(`  ✓ Image generated on retry: ${imageFile}`);
    } catch (err) {
      console.warn(`  ⚠ Still failing: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 4000));
  }
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
