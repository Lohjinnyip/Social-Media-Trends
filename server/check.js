// `npm run check` — verifies every key in .env without running any paid scrape.
import { config } from './config.js';
import { FEEDS } from './providers/news.js';
import { estimateCost, costSummary } from './cost.js';

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const skip = (m) => console.log(`  – ${m}`);

async function json(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { res, body: await res.json().catch(() => ({})) };
}

console.log('\nApify (TikTok, Instagram, Facebook)');
if (!config.apifyToken) {
  skip('APIFY_TOKEN not set');
} else {
  const auth = { headers: { Authorization: `Bearer ${config.apifyToken}` } };
  const { res, body } = await json('https://api.apify.com/v2/users/me', auth);
  if (!res.ok) bad(`token rejected: ${body.error?.message || res.status}`);
  else {
    ok(`signed in as ${body.data.username} (${body.data.plan?.id || 'plan unknown'})`);
    const { body: lim } = await json('https://api.apify.com/v2/users/me/limits', auth);
    const used = lim.data?.current?.monthlyUsageUsd;
    const max = lim.data?.limits?.maxMonthlyUsageUsd;
    if (used != null && max != null) ok(`usage this month: $${used.toFixed(2)} of $${max.toFixed(2)}`);
  }
}

console.log('\nEstimated Apify cost with your current .env');
const est = estimateCost('free');
for (const [k, v] of Object.entries(est.perRun)) {
  if (v) console.log(`    ${k.padEnd(13)} $${v.toFixed(3)} per refresh × ${est.runsPerDay[k].toFixed(1)}/day`);
}
console.log(`    → ${costSummary()}`);
console.log('    (worst case: assumes every search returns its full result count)');

console.log('\nYouTube (free)');
if (!config.youtube.apiKey) skip('YOUTUBE_API_KEY not set');
else {
  const { res, body } = await json(`https://www.googleapis.com/youtube/v3/videos?part=id&chart=mostPopular&regionCode=MY&maxResults=1&key=${encodeURIComponent(config.youtube.apiKey)}`);
  res.ok ? ok('API key valid, Malaysia trending chart reachable') : bad(`YouTube: ${body.error?.message || res.status}`);
}

console.log('\nMeta Graph API (optional)');
for (const [label, token] of [['Instagram', config.instagram.graphToken], ['Facebook', config.facebook.graphToken]]) {
  if (!token) { skip(`${label} token not set`); continue; }
  const { res, body } = await json(`https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(token)}`);
  res.ok ? ok(`${label} token valid (${body.name || body.id})`) : bad(`${label} token: ${body.error?.message || res.status}`);
}
if (config.instagram.graphToken && !config.instagram.graphUserId) bad('IG_BUSINESS_USER_ID is required with IG_GRAPH_TOKEN');

console.log('\nNews');
const feedResults = await Promise.all(
  FEEDS.map(async (f) => {
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
      return [f.name, r.ok];
    } catch { return [f.name, false]; }
  }),
);
for (const [name, up] of feedResults) (up ? ok : bad)(`${name} RSS`);
try {
  const r = await fetch('https://trends.google.com/trending/rss?geo=MY', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
  (r.ok ? ok : bad)('Google Trends Malaysia RSS');
} catch { bad('Google Trends Malaysia RSS'); }
if (!config.newsApiKey) skip('NEWSAPI_KEY not set (optional)');
else {
  const { body } = await json('https://newsapi.org/v2/top-headlines?country=my&pageSize=1', { headers: { 'X-Api-Key': config.newsApiKey } });
  body.status === 'ok' ? ok('NewsAPI key valid') : bad(`NewsAPI: ${body.message}`);
}
console.log();
