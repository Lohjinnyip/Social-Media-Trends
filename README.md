# Malaysia Social Pulse

A live dashboard showing:

- **Trending videos in Malaysia** from TikTok, Instagram (Reels) and Facebook, ranked by how fast they are gaining views.
- **The music and sounds used** in those videos: licensed tracks and original sounds (voiceovers, SFX, remixes), how many trending videos use each one, and audio previews where TikTok provides them.
- **Trending hashtags**: TikTok Creative Center's official Malaysia ranking, plus hashtags found in the current trending videos.
- **Latest Malaysian news** from Google News MY (English and Bahasa Malaysia), Free Malaysia Today, Malay Mail, New Straits Times and Bernama.

All data refreshes automatically on the server and is pushed to open browsers in real time. You never need to reload the page.

## Quick start

```bash
npm install
cp .env.example .env    # then add your APIFY_TOKEN
npm run check           # verifies your keys (no paid scrapes)
npm start               # http://localhost:3000
```

News works immediately with no keys. Social panels show setup instructions until a provider is configured.

## Where the data comes from

TikTok, Instagram and Facebook have **no official API that returns "trending videos in a country"**:

| Platform | Official API reality | What this app uses |
|---|---|---|
| TikTok | Research API is limited to approved academics. Display API only returns your own videos. | Apify `clockworks/tiktok-scraper`: searches Malaysian queries and hashtags from a Malaysian proxy for the last 24h, sorted by likes. Returns full music metadata. Apify `automation-lab/tiktok-trends-scraper` adds Creative Center Malaysia hashtags and Explore sounds. |
| Instagram | Graph API hashtag search needs a Business account and returns no music info. Limited to 30 hashtags per week. | Apify `apify/instagram-hashtag-scraper` in Reels mode, which includes song and artist. Graph API is supported as a fallback. |
| Facebook | Graph API only reads pages you manage, unless your app has *Page Public Content Access*. | Apify `apify/facebook-posts-scraper` over a configurable list of Malaysian pages (`FB_PAGES`). Graph API is supported as a fallback. |
| News | — | Free RSS feeds. A `NEWSAPI_KEY` is optional. |

One Apify token covers all three platforms: sign up at [console.apify.com](https://console.apify.com) and copy it from *Settings → API & Integrations*.

### Cost control

Apify charges per run/result. The defaults keep usage modest:

- Social sources refresh every **30 min** (`SOCIAL_REFRESH_MINUTES`) and TikTok trend lists every **60 min** (`TRENDS_REFRESH_MINUTES`).
- Results are cached in `data/cache.json`. Restarting the server does **not** re-scrape if the cache is still fresh.
- A manual "↻ refresh" on a paid source is throttled to once every 2 min.
- Tune volume with `TIKTOK_RESULTS_PER_QUERY`, `IG_RESULTS_LIMIT` and `FB_RESULTS_PER_PAGE`.

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
    news.js           Malaysian RSS feeds (+ optional NewsAPI)
    util.js           Normalisation + trend scoring
public/               Dashboard (vanilla JS, no build step)
```

### API

- `GET /api/state`: current snapshot (videos, sounds, hashtags, news, source status).
- `GET /api/stream`: Server-Sent Events. Emits `state` whenever anything changes.
- `POST /api/refresh/:source`: `news`, `tiktok`, `instagram`, `facebook`, `tiktokTrends` or `all`.
- `GET /api/media?url=`: relays TikTok/Instagram/Facebook CDN thumbnails and audio, which block hotlinking. Restricted to those CDN hosts only.
