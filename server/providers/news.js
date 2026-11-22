import { XMLParser } from 'fast-xml-parser';
import { config } from '../config.js';
import { toIso } from './util.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export const FEEDS = [
  { name: 'Google News MY', url: 'https://news.google.com/rss?hl=en-MY&gl=MY&ceid=MY:en', lang: 'en', aggregator: true },
  { name: 'Google News MY (BM)', url: 'https://news.google.com/rss?hl=ms&gl=MY&ceid=MY:ms', lang: 'ms', aggregator: true },
  { name: 'Free Malaysia Today', url: 'https://cms.freemalaysiatoday.com/feed', lang: 'en' },
  { name: 'Malay Mail', url: 'https://www.malaymail.com/feed/rss/malaysia', lang: 'en' },
  { name: 'New Straits Times', url: 'https://www.nst.com.my/feed', lang: 'en' },
  { name: 'Bernama', url: 'https://www.bernama.com/en/rssfeed.php', lang: 'en' },
];

// Entities are decoded by decode() below; the parser's own expansion trips a limit on Google News.
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', processEntities: false });

const PER_FEED = 25;
// Some feeds (Bernama) have no pubDate, so remember when we first saw each item.
const firstSeen = new Map();
const primedFeeds = new Set();

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };
function decode(s) {
  // Run twice: some feeds double-encode (&amp;#39;).
  for (let i = 0; i < 2; i++) {
    s = s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : m;
      }
      return NAMED[e.toLowerCase()] ?? m;
    });
  }
  return s;
}

const text = (v) => (v == null ? '' : typeof v === 'object' ? v['#text'] ?? '' : String(v));
const strip = (html) =>
  decode(decode(text(html).replace(/<!\[CDATA\[|\]\]>/g, '')).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

function imageOf(item) {
  const media = item['media:content'] || item['media:thumbnail'] || item.enclosure;
  const m = Array.isArray(media) ? media[0] : media;
  if (m?.['@url'] && !/\.(mp3|mp4)$/i.test(m['@url'])) return m['@url'];
  const html = text(item['content:encoded']) || text(item.description);
  return html.match(/<img[^>]+src=["']([^"']+)/i)?.[1] || null;
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${feed.name}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  // Some feeds declare ISO-8859-1 but actually send UTF-8, so try strict UTF-8 first.
  let body;
  try { body = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { body = new TextDecoder('latin1').decode(buf); }
  const xml = parser.parse(body.replace(/Ã‚Â|Â(?=[\s\u00a0])/g, ' '));
  const raw = xml?.rss?.channel?.item ?? xml?.feed?.entry ?? [];
  const items = (Array.isArray(raw) ? raw : [raw]).map((it) => {
    let title = strip(it.title);
    let source = feed.name;
    if (feed.aggregator) {
      // Google News titles look like "Headline - Publisher"
      const pub = text(it.source);
      if (pub) {
        source = pub;
        title = title.replace(new RegExp(`\\s+-\\s+${pub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      }
    }
    if (feed.name === 'Bernama') title = title.replace(/^[A-Za-z ]+\s:\s/, '');
    const link = decode(text(it.link?.['@href'] ?? it.link).trim());
    const published = toIso(text(it.pubDate) || text(it.published) || text(it['dc:date']));
    // On a feed's first fetch we can't know when undated items were published, so leave them undated.
    if (!firstSeen.has(link)) firstSeen.set(link, primedFeeds.has(feed.name) ? new Date().toISOString() : null);
    return {
      id: link || title,
      title,
      summary: feed.aggregator ? '' : strip(it.description).slice(0, 220),
      url: link,
      source,
      feed: feed.name,
      lang: feed.lang,
      image: imageOf(it),
      publishedAt: published || firstSeen.get(link),
    };
  });
  primedFeeds.add(feed.name);
  return items.slice(0, PER_FEED);
}

async function fetchNewsApi() {
  const res = await fetch('https://newsapi.org/v2/top-headlines?country=my&pageSize=50', {
    headers: { 'X-Api-Key': config.newsApiKey },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (body.status !== 'ok') throw new Error(`NewsAPI: ${body.message || res.status}`);
  return body.articles.map((a) => ({
    id: a.url,
    title: a.title?.replace(/\s+-\s+[^-]+$/, '') || '',
    summary: a.description || '',
    url: a.url,
    source: a.source?.name || 'NewsAPI',
    feed: 'NewsAPI',
    lang: 'en',
    image: a.urlToImage,
    publishedAt: toIso(a.publishedAt),
  }));
}

const normTitle = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);

export async function fetchNews() {
  const jobs = FEEDS.map(fetchFeed);
  if (config.newsApiKey) jobs.push(fetchNewsApi());
  const results = await Promise.allSettled(jobs);
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (firstSeen.size > 5000) firstSeen.clear();
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!items.length) throw new Error(errors.join(' | ') || 'No news returned');

  const seen = new Set();
  const cutoff = Date.now() - 2 * 864e5;
  const unique = items
    .filter((i) => i.title && i.url)
    .filter((i) => !i.publishedAt || Date.parse(i.publishedAt) > cutoff)
    .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
    .filter((i) => {
      const k = normTitle(i.title);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 150);
  return { items: unique, partialErrors: errors };
}
