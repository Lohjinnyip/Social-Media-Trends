# Malaysia Social Pulse

A live dashboard showing:

- **Trending videos in Malaysia** from TikTok, Instagram (Reels) and Facebook, ranked by how fast they are gaining views.
- **The music and sounds used** in those videos: licensed tracks and original sounds (voiceovers, SFX, remixes), how many trending videos use each one, and audio previews where TikTok provides them.
- **YouTube's official Malaysia trending chart**, including Shorts, plus Malaysia's trending music videos. Free.
- **Trending hashtags**: TikTok Creative Center's official Malaysia ranking, plus hashtags found in the current trending videos.
- **Trending Google searches in Malaysia**. Free, no key.
- **Latest Malaysian news** from Google News MY (English and Bahasa Malaysia), Free Malaysia Today, Malay Mail, New Straits Times and Bernama.

All data refreshes automatically on the server and is pushed to open browsers in real time. You never need to reload the page.

## Quick start

```bash
npm install
cp .env.example .env    # then add your APIFY_TOKEN
npm run check           # verifies your keys (no paid scrapes)
npm start               # http://localhost:3000
```

News and Google Trends work immediately with no keys. Other panels show setup instructions until a provider is configured.

## Free vs paid sources

| Source | Cost | Key needed |
|---|---|---|
| Malaysian news (RSS) | Free | No |
| Google Trends: trending searches in Malaysia | Free | No |
| YouTube: official Malaysia trending chart + trending music | Free (10,000 quota units/day, about 100 used) | `YOUTUBE_API_KEY` |
| TikTok / Instagram / Facebook via Apify | Paid per result; Free plan gives $5/month | `APIFY_TOKEN` |

### Get a free YouTube API key (about 5 minutes)

1. Go to https://console.cloud.google.com/ and sign in with any Google account.
2. Create a project: click the project picker at the top → **New project** → name it, e.g., `social-pulse` → **Create**.
3. Enable the API: open https://console.cloud.google.com/apis/library/youtube.googleapis.com and click **Enable**.
4. Create the key: **APIs & Services → Credentials → Create credentials → API key**. Copy it.
5. Recommended: click the key → **API restrictions → Restrict key → YouTube Data API v3** → Save.
6. Put it in `.env` as `YOUTUBE_API_KEY=...`, then run `npm run check` and `npm start`.

No billing account or card is needed. If you go over the free quota, requests just fail until the next day.

### Free TikTok?

There is no free, official TikTok API for trending videos. TikTok's Research API is limited to approved academics, and its Display API only returns your own videos. Running a hidden browser to scrape TikTok is against TikTok's terms, so it isn't included. Free alternatives:

- The dashboard links to TikTok's **Creative Center trends** page. It's free and lists Malaysia's trending hashtags, songs, videos and creators when you open it in your browser.
- YouTube Shorts and YouTube's trending music cover much of the same short-video and music trends.
- Apify's Free plan ($5/month) can run TikTok on its own. Set a long `SOCIAL_REFRESH_MINUTES` and use `npm run check` to see the cost.

## Where the data comes from

TikTok, Instagram and Facebook have **no official API that returns "trending videos in a country"**:

| Platform | Official API reality | What this app uses |
|---|---|---|
| TikTok | Research API is limited to approved academics. Display API only returns your own videos. | Apify `clockworks/tiktok-scraper`: searches Malaysian queries and hashtags from a Malaysian proxy for the last 24h, sorted by likes. Returns full music metadata. Apify `automation-lab/tiktok-trends-scraper` adds Creative Center Malaysia hashtags and Explore sounds. |
| Instagram | Graph API hashtag search needs a Business account and returns no music info. Limited to 30 hashtags per week. | Apify `apify/instagram-hashtag-scraper` in Reels mode, which includes song and artist. Graph API is supported as a fallback. |
| Facebook | Graph API only reads pages you manage, unless your app has *Page Public Content Access*. | Apify `apify/facebook-posts-scraper` over a configurable list of Malaysian pages (`FB_PAGES`). Graph API is supported as a fallback. |
| News | — | Free RSS feeds. A `NEWSAPI_KEY` is optional. |

One Apify token covers all three platforms: sign up at [console.apify.com](https://console.apify.com) and copy it from *Settings → API & Integrations*.

### Cost

Apify charges **per result** (prices read 2026-11-22). Rates on the Free plan / Starter plan:

| Actor | Price per result |
|---|---|
| TikTok videos (`clockworks/tiktok-scraper`) | $0.0037 / $0.003, plus $0.0013 / $0.001 for each add-on. This app uses two: the Malaysia location and the 24h date filter. |
| TikTok trends (`automation-lab/tiktok-trends-scraper`) | $0.05 per sound run + $0.0062 per sound, $0.002 per Creative Center hashtag |
| Instagram Reels (`apify/instagram-hashtag-scraper`) | $0.0026 / $0.0023 |
| Facebook posts (`apify/facebook-posts-scraper`) | $0.005 / $0.004 |

Estimated monthly cost with the default result counts, worst case:

| Social refresh every | Free-plan prices | Starter prices |
|---|---|---|
| 30 min | ~$650 | ~$525 |
| 3 h | ~$113 | ~$93 |
| 6 h | ~$59 | ~$49 |
| **12 h (default)** | **~$33** | **~$28** |
| 24 h | ~$19 | ~$17 |

`npm run check` prints the estimate for your exact `.env`, and the server logs it on startup. Other ways to keep cost down:

- Results are cached in `data/cache.json`, so restarting the server does **not** re-scrape while the cache is fresh.
- A manual "↻ refresh" on a paid source is throttled to once every 2 min. Each click costs one refresh.
- Lower `TIKTOK_RESULTS_PER_QUERY`, `IG_RESULTS_LIMIT`, `FB_RESULTS_PER_PAGE`, or the number of queries, hashtags and pages.
- Set a monthly usage limit in Apify (*Settings → Usage & Billing*) as a hard cap.

News is free and refreshes every **3 min** (`NEWS_REFRESH_MINUTES`).

## How "trending" is calculated

Each video gets a score of weighted engagement (views + 8×likes + 15×comments + 25×shares) divided by `(hours since posted + 2)^1.3`. A video posted 2 hours ago with 300K views ranks above a 3-day-old video with 2M. The 🔥 figure on each card is views per hour. You can also sort by most views, most likes or newest.

## About "sound effects"

No platform exposes sound effects as a separate field. Each video has one audio track: either a **licensed song** or an **original sound**. Original sounds are what creators use for SFX, voiceovers and remixes. The *Original / SFX* filter in the Sounds panel shows those. Click a sound to open its TikTok or Instagram audio page and see every video using it.

## Configuration

Every setting is documented in [`.env.example`](.env.example). The most useful ones to tweak:

- `TIKTOK_SEARCH_QUERIES` / `TIKTOK_HASHTAGS`: what "Malaysian content" means for TikTok.
- `IG_HASHTAGS`: Instagram hashtags to pull Reels from.
- `FB_PAGES`: Facebook pages to watch. Viral/media pages work best.

## Project layout

```
server/
  index.js            Express server: scheduler, cache, SSE live stream, media proxy
  config.js           Reads .env
  providers/
    apify.js          Starts an Apify actor and waits for its dataset
    tiktok.js         Trending videos + Creative Center trends
    instagram.js      Reels via Apify, or Meta Graph API fallback
    facebook.js       Page videos via Apify, or Meta Graph API fallback
    youtube.js        YouTube Data API: Malaysia trending chart + music
    searchTrends.js   Google Trends "trending now" RSS for Malaysia
    news.js           Malaysian RSS feeds (+ optional NewsAPI)
    util.js           Normalisation + trend scoring
public/               Dashboard (vanilla JS, no build step)
```

### API

- `GET /api/state`: current snapshot (videos, sounds, hashtags, news, source status).
- `GET /api/stream`: Server-Sent Events. Emits `state` whenever anything changes.
- `POST /api/refresh/:source`: `news`, `searchTrends`, `youtube`, `tiktok`, `instagram`, `facebook`, `tiktokTrends` or `all`.
- `GET /api/media?url=`: relays TikTok/Instagram/Facebook CDN thumbnails and audio, which block hotlinking. Restricted to those CDN hosts only.
