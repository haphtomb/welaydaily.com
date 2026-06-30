# WelayDaily.com

A fully free, automated soccer (football) news site:

- **Scans** the latest football news (Gemini 2.5 Flash with web search grounding)
- **Rewrites** every story from scratch in original wording (copyright-safe)
- **Generates a cartoon illustration** for each story (Gemini 2.5 Flash Image / "Nano Banana" — never photoreal, never a real face)
- **Publishes automatically** on a schedule, with zero servers, using GitHub Actions
- **Shows standings & fixtures** for Premier League, La Liga, Bundesliga, Serie A, Ligue 1, and Champions League (football-data.org free tier)

Total monthly cost: **$0**, as long as you stay inside each free tier (see "Costs & limits" below).

---

## 1. One-time setup (about 15 minutes)

### Step A — Get a free Gemini API key
1. Go to https://aistudio.google.com/apikey
2. Sign in with any Google account (no credit card required)
3. Click "Create API key" → copy it

### Step B — Get a free football-data.org API key
1. Go to https://www.football-data.org/client/register
2. Register with your email (no credit card required)
3. Copy the API token they email you

### Step C — Create a GitHub repository
1. Create a free GitHub account if you don't have one: https://github.com/signup
2. Create a new repository, e.g. `welaydaily`
3. Upload all the files in this project to that repository (drag-and-drop works, or use `git push`)

### Step D — Add your two free API keys as GitHub Secrets
1. In your repo, go to **Settings → Secrets and variables → Actions**
2. Click **New repository secret**, add:
   - Name: `GEMINI_API_KEY` → value: the key from Step A
   - Name: `FOOTBALL_DATA_API_KEY` → value: the key from Step B

### Step E — Turn on GitHub Pages (to host the site itself, also free)
1. In your repo, go to **Settings → Pages**
2. Under "Source", choose **Deploy from a branch**
3. Branch: `main`, folder: `/public`
4. Save — GitHub will give you a URL like `https://yourusername.github.io/welaydaily/`

### Step F — Point your domain at GitHub Pages
1. In Hostinger's hPanel, go to your domain's DNS settings
2. Add a CNAME record: `www` → `yourusername.github.io`
3. Add four A records for the apex domain (`welaydaily.com`) pointing to GitHub's IPs:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
4. Back in GitHub **Settings → Pages**, set your custom domain to `www.welaydaily.com` and enable "Enforce HTTPS"

*(Alternative: skip GitHub Pages entirely and just keep using Hostinger — upload the `public/` folder's `index.html` there instead, and write a small script step that also pushes the latest `data/*.json` files to Hostinger via FTP in the GitHub Action. Ask me if you'd like that version instead — GitHub Pages is simpler to start with.)*

---

## 2. Test it manually first

Before waiting for the schedule, trigger it once by hand:
1. Go to your repo's **Actions** tab
2. Click **WelayDaily Auto-Publish** in the left sidebar
3. Click **Run workflow** → **Run workflow**
4. Watch it run (takes 1–3 minutes) — check the logs for each step
5. Once it finishes, your `data/articles.json` and `data/standings.json` files will be updated automatically, and your live site will show the new content within a minute or two

## 3. How the automatic schedule works

`.github/workflows/publish.yml` runs **every 3 hours** automatically (GitHub Actions cron, free for public repos and free up to 2,000 minutes/month for private repos). Each run:
1. Pulls fresh standings & fixtures from football-data.org
2. Picks 4 random football topics, searches for real current news, rewrites it from scratch, generates a cartoon image for each
3. Commits the new data straight back into the repo
4. Your live site re-reads that data automatically — no manual republishing needed

You can change the frequency by editing the `cron:` line in `.github/workflows/publish.yml` (e.g. `0 */1 * * *` for hourly — just mind the free-tier limits below).

---

## Costs & limits (as of mid-2026 — always double check current limits before relying on them)

| Service | Free tier | What it's used for |
|---|---|---|
| Gemini API (text) | ~10 req/min, ~250-1500 req/day depending on model | scanning & rewriting articles |
| Gemini API (image) | Up to several hundred images/day on free tier | cartoon featured images |
| football-data.org | 10 requests/minute, 12 competitions, forever free | standings & fixtures |
| GitHub Actions | 2,000 free minutes/month (private repos), unlimited on public repos | running the bot on schedule |
| GitHub Pages | Free, unlimited for personal/public sites | hosting the site |

At 4 articles every 3 hours (8 runs/day = ~32 articles/day), you'll stay comfortably inside every free tier. If a provider tightens its limits later (this happens — see the comments in `scripts/publish-agent.mjs`), lower `MAX_ARTICLES_PER_RUN` or the cron frequency.

**Note on MLS / CAF Champions League / AFCON standings:** football-data.org's free tier only covers the 6 competitions listed in `scripts/sync-standings.mjs`. Truly free, reliable data for MLS and African competitions is harder to find — TheSportsDB has some free coverage but is crowd-sourced and less reliable. If those leagues matter a lot to you, that's the one piece worth revisiting once the rest of the pipeline is running.

## Files in this project

```
welaydaily/
├── .github/workflows/publish.yml   ← the cron job that runs everything
├── scripts/
│   ├── publish-agent.mjs           ← scans, rewrites, generates images, publishes, updates sitemap
│   └── sync-standings.mjs          ← pulls standings & fixtures
├── data/
│   ├── articles.json               ← bot-maintained, do not edit by hand
│   └── standings.json              ← bot-maintained, do not edit by hand
├── public/
│   ├── index.html                  ← homepage (reads the data/ files)
│   ├── article.html                ← individual article permalink page (?id=...)
│   ├── about.html                  ← About page (AdSense requirement)
│   ├── privacy.html                ← Privacy Policy (AdSense requirement)
│   ├── contact.html                ← Contact page (AdSense requirement)
│   ├── robots.txt
│   ├── sitemap.xml                 ← auto-regenerated by the bot on every run
│   ├── CNAME                       ← tells GitHub Pages your custom domain
│   └── images/                     ← bot-generated cartoon images land here
└── package.json
```

### About the article permalink pages

Every article card on the homepage links to `article.html?id=<article-id>` — a dedicated, shareable, indexable page per story with its own title tag, meta description, and Open Graph image tags (so links shared on social media show the right headline/image preview). This matters for both SEO and AdSense review, since a single-page feed with no individual content URLs reads as much thinner to both Google Search and AdSense reviewers.
