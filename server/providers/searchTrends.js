import { XMLParser } from 'fast-xml-parser';
import { toIso } from './util.js';

// Google Trends "trending now" for Malaysia — public RSS, free, no key.
const URL_MY = 'https://trends.google.com/trending/rss?geo=MY';
const parser = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true });
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export async function fetchSearchTrends() {
  const res = await fetch(URL_MY, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Google Trends: HTTP ${res.status}`);
  const xml = parser.parse(await res.text());
  return arr(xml?.rss?.channel?.item).map((it) => {
    const query = String(it.title ?? '').trim();
    return {
      query,
      traffic: String(it['ht:approx_traffic'] ?? ''),
      trafficNum: Number(String(it['ht:approx_traffic'] ?? '').replace(/[^\d]/g, '')) || 0,
      startedAt: toIso(it.pubDate),
      picture: it['ht:picture'] || null,
      searchUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=MY`,
      news: arr(it['ht:news_item']).slice(0, 3).map((n) => ({
        title: String(n['ht:news_item_title'] ?? ''),
        url: n['ht:news_item_url'],
        source: n['ht:news_item_source'],
      })),
    };
  })
    .filter((t) => t.query)
    .sort((a, b) => b.trafficNum - a.trafficNum || Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0));
}
