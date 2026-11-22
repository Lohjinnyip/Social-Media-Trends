import express from 'express';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { config } from './config.js';
import { fetchNews } from './providers/news.js';
import { fetchTikTokVideos, fetchTikTokTrends, tiktokStatus } from './providers/tiktok.js';
import { fetchInstagramVideos, instagramStatus } from './providers/instagram.js';
import { fetchFacebookVideos, facebookStatus } from './providers/facebook.js';
import { fetchYouTube, youtubeStatus } from './providers/youtube.js';
import { fetchSearchTrends } from './providers/searchTrends.js';
import { JOB_SOURCES, JOB_FETCHERS, jobSourceStatus, mergeJobs } from './providers/jobs.js';
import { costSummary } from './cost.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_FILE = process.env.CACHE_FILE || path.join(ROOT, 'data', 'cache.json');

// ── Sources ──────────────────────────────────────────────────────────
const SOURCES = {
  news: { run: fetchNews, intervalMs: config.refresh.newsMs, paid: false, enabled: () => true },
  searchTrends: { run: fetchSearchTrends, intervalMs: config.refresh.searchTrendsMs, paid: false, enabled: () => true },
  youtube: { run: fetchYouTube, intervalMs: config.refresh.youtubeMs, paid: false, enabled: () => youtubeStatus().connected },
  tiktok: { run: fetchTikTokVideos, intervalMs: config.refresh.socialMs, paid: true, enabled: () => tiktokStatus().connected },
  instagram: { run: fetchInstagramVideos, intervalMs: config.refresh.socialMs, paid: true, enabled: () => instagramStatus().connected },
  facebook: { run: fetchFacebookVideos, intervalMs: config.refresh.socialMs, paid: true, enabled: () => facebookStatus().connected },
  tiktokTrends: {
    run: fetchTikTokTrends,
    intervalMs: config.refresh.trendsMs,
    paid: true,
    enabled: () => tiktokStatus().connected && config.tiktok.trendsEnabled,
  },
};

// Job sources: Google Jobs (SerpApi free quota) and Apify ones refresh on the slow
// interval; Careerjet is free and unmetered so it can refresh more often.
for (const [name, meta] of Object.entries(JOB_SOURCES)) {
  SOURCES[`jobs_${name}`] = {
    run: JOB_FETCHERS[name],
    intervalMs: name === 'careerjet' ? config.refresh.jobsFreeMs : config.refresh.jobsMs,
    paid: meta.paid || name === 'google',
    enabled: () => jobSourceStatus(name).connected,
  };
}

// data[source] = { payload, updatedAt, error, running, nextAt, lastManualAt }
const data = Object.fromEntries(Object.keys(SOURCES).map((k) => [k, { payload: null, updatedAt: null, error: null }]));

async function loadCache() {
  try {
    const saved = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
    for (const [k, v] of Object.entries(saved)) if (data[k]) Object.assign(data[k], { payload: v.payload, updatedAt: v.updatedAt });
    console.log('Loaded cached data from', path.relative(ROOT, CACHE_FILE));
  } catch {}
}

let saveTimer;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const out = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { payload: v.payload, updatedAt: v.updatedAt }]));
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(out)).catch((e) => console.error('cache save failed', e.message));
  }, 1000);
}

async function refresh(name) {
  const src = SOURCES[name];
  const d = data[name];
  if (d.running || !src.enabled()) return;
  d.running = true;
  broadcast();
  const t0 = Date.now();
  try {
    const result = await src.run();
    d.payload = result;
    d.updatedAt = new Date().toISOString();
    d.error = result?.partialErrors?.length ? `Some feeds failed: ${result.partialErrors.join(' | ')}` : null;
    console.log(`[${name}] refreshed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    saveCache();
  } catch (e) {
    d.error = e.message;
    console.error(`[${name}] ${e.message}`);
  } finally {
    d.running = false;
    d.nextAt = new Date(Date.now() + src.intervalMs).toISOString();
    broadcast();
  }
}

function schedule() {
  for (const [name, src] of Object.entries(SOURCES)) {
    if (!src.enabled()) continue;
    const age = data[name].updatedAt ? Date.now() - Date.parse(data[name].updatedAt) : Infinity;
    // Paid sources: don't re-scrape on every restart if the cache is still fresh.
    const firstIn = !src.paid || age >= src.intervalMs ? 0 : src.intervalMs - age;
    data[name].nextAt = new Date(Date.now() + firstIn).toISOString();
    setTimeout(() => {
      refresh(name);
      setInterval(() => refresh(name), src.intervalMs);
    }, firstIn);
  }
}

// ── Aggregation ──────────────────────────────────────────────────────
const videosOf = (name) => {
  const p = data[name].payload;
  return Array.isArray(p) ? p : Array.isArray(p?.videos) ? p.videos : [];
};

function aggregateSounds() {
  // Licensed music is merged across platforms by title + artist; "original sounds"
  // (voiceovers, SFX, remixes) are unique per platform so they key by platform + id.
  const norm = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const keyFor = (s, platform) => (s.original ? `${platform}:${s.id || norm(s.title)}` : `${norm(s.title)}|${norm(s.author)}`);
  const map = new Map();
  const byId = new Map(); // "platform:id" → key, so trend rows find their video-derived entry

  for (const v of [...videosOf('tiktok'), ...videosOf('instagram')]) {
    const s = v.sound;
    if (!s?.title) continue;
    const key = keyFor(s, v.platform);
    const e = map.get(key) || { ...s, key, platforms: [], videos: 0, totalViews: 0, examples: [] };
    if (!e.platforms.includes(v.platform)) e.platforms.push(v.platform);
    if (v.platform === 'tiktok') { e.url = s.url || e.url; e.audioUrl ||= s.audioUrl; e.cover ||= s.cover; }
    e.url ||= s.url;
    e.videos += 1;
    e.totalViews += v.stats.views;
    if (e.examples.length < 3) e.examples.push({ url: v.url, thumbnail: v.thumbnail, author: v.author?.handle });
    map.set(key, e);
    if (s.id) byId.set(`${v.platform}:${s.id}`, key);
  }
  for (const t of data.tiktokTrends.payload?.sounds || []) {
    const key = (t.id && byId.get(`tiktok:${t.id}`)) || keyFor(t, 'tiktok');
    const e = map.get(key) || { ...t, key, platforms: ['tiktok'], videos: 0, totalViews: 0, examples: [] };
    e.trendRank = t.rank;
    e.audioUrl ||= t.audioUrl;
    e.cover ||= t.cover;
    e.url ||= t.url;
    map.set(key, e);
  }
  for (const m of data.youtube.payload?.music || []) {
    map.set(`youtube:${m.id}`, { ...m, key: `youtube:${m.id}`, platforms: ['youtube'], videos: 0, totalViews: m.views, examples: [], ytRank: m.rank });
  }
  return [...map.values()]
    .map((s) => ({ ...s, kind: s.original ? 'original' : 'music' }))
    .sort((a, b) => b.videos - a.videos || (a.trendRank ?? 999) - (b.trendRank ?? 999) || (a.ytRank ?? 999) - (b.ytRank ?? 999))
    .slice(0, 80);
}

function aggregateHashtags() {
  const skip = new Set(['fyp', 'foryou', 'foryoupage', 'fypシ', 'viral', 'fy', 'xyzbca', 'trending', 'reels', 'tiktok']);
  const map = new Map();
  for (const v of ['tiktok', 'instagram', 'facebook', 'youtube'].flatMap(videosOf)) {
    for (const h of new Set(v.hashtags)) {
      if (skip.has(h)) continue;
      const e = map.get(h) || { name: h, videos: 0, views: 0 };
      e.videos += 1;
      e.views += v.stats.views;
      map.set(h, e);
    }
  }
  return [...map.values()].sort((a, b) => b.videos - a.videos || b.views - a.views).slice(0, 40);
}

function snapshot() {
  return {
    serverTime: new Date().toISOString(),
    providers: {
      tiktok: tiktokStatus(),
      instagram: instagramStatus(),
      facebook: facebookStatus(),
      youtube: youtubeStatus(),
      ...Object.fromEntries(Object.keys(JOB_SOURCES).map((n) => [`jobs_${n}`, jobSourceStatus(n)])),
      searchTrends: { connected: true, via: 'Google Trends RSS · Malaysia (free)' },
      news: { connected: true, via: `RSS feeds${config.newsApiKey ? ' + NewsAPI' : ''}` },
    },
    sources: Object.fromEntries(
      Object.entries(data).map(([k, d]) => [
        k,
        { updatedAt: d.updatedAt, nextAt: d.nextAt || null, running: !!d.running, error: d.error, enabled: SOURCES[k].enabled() },
      ]),
    ),
    news: data.news.payload?.items || [],
    videos: { tiktok: videosOf('tiktok'), instagram: videosOf('instagram'), facebook: videosOf('facebook'), youtube: videosOf('youtube') },
    searchTrends: data.searchTrends.payload || [],
    jobs: mergeJobs(Object.keys(JOB_SOURCES).map((n) => (Array.isArray(data[`jobs_${n}`].payload) ? data[`jobs_${n}`].payload : []))),
    jobQueries: config.jobs.queries,
    trends: { hashtags: data.tiktokTrends.payload?.hashtags || [] },
    sounds: aggregateSounds(),
    hashtags: aggregateHashtags(),
  };
}

// ── Live push (Server-Sent Events) ───────────────────────────────────
const clients = new Set();
let broadcastTimer;
function broadcast() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    const msg = `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) res.write(msg);
  }, 200);
}

// ── HTTP ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/state', (_req, res) => res.json(snapshot()));

app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

app.post('/api/refresh/:source', (req, res) => {
  const names = req.params.source === 'all' ? Object.keys(SOURCES) : [req.params.source];
  const started = [];
  const skipped = [];
  for (const name of names) {
    const src = SOURCES[name];
    if (!src) return res.status(404).json({ error: `Unknown source ${name}` });
    const d = data[name];
    if (!src.enabled() || d.running) { skipped.push(name); continue; }
    if (src.paid && d.lastManualAt && Date.now() - d.lastManualAt < config.refresh.manualSocialMinMs) {
      skipped.push(name);
      continue;
    }
    if (src.paid) d.lastManualAt = Date.now();
    refresh(name);
    started.push(name);
  }
  res.json({ started, skipped });
});

// Thumbnails/audio from these CDNs refuse hotlinking, so we relay them.
// Restricted to known media hosts so this can't be used as an open proxy.
const MEDIA_HOSTS = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibyteimg.com', 'muscdn.com', 'tiktokv.com', 'byteoversea.com', 'cdninstagram.com', 'fbcdn.net'];
const allowedHost = (h) => MEDIA_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));

app.get('/api/media', async (req, res) => {
  try {
    let target = new URL(String(req.query.url || ''));
    for (let hop = 0; hop < 4; hop++) {
      if (target.protocol !== 'https:' || !allowedHost(target.hostname)) return res.status(403).end();
      const upstream = await fetch(target, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0', ...(req.headers.range ? { Range: req.headers.range } : {}) },
        signal: AbortSignal.timeout(20_000),
      });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
        target = new URL(upstream.headers.get('location'), target);
        continue;
      }
      if (!upstream.ok || !upstream.body) return res.status(upstream.status || 502).end();
      res.status(upstream.status);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = upstream.headers.get(h);
        if (v) res.set(h, v);
      }
      res.set('Cache-Control', 'public, max-age=3600');
      return Readable.fromWeb(upstream.body).pipe(res);
    }
    res.status(508).end();
  } catch {
    if (!res.headersSent) res.status(400).end();
  }
});

await loadCache();
schedule();
app.listen(config.port, () => {
  console.log(`\nMalaysia Social Pulse → http://localhost:${config.port}`);
  for (const [k, s] of Object.entries(snapshot().providers)) console.log(`  ${k.padEnd(10)} ${s.connected ? '✓ ' + s.via : '✗ ' + s.hint}`);
  if (config.apifyToken) console.log(`\n  Apify cost estimate: ${costSummary()}`);
  console.log();
});
