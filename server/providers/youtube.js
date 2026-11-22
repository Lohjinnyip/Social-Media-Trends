import { config } from '../config.js';
import { toNum, toIso, scoreVideo, hashtagsFrom } from './util.js';

// YouTube Data API v3 — official, free (10,000 quota units/day; each call here costs 1).
const API = 'https://www.googleapis.com/youtube/v3/videos';
const MUSIC_CATEGORY = '10';

export const youtubeStatus = () =>
  config.youtube.apiKey
    ? { connected: true, via: 'YouTube Data API · official Malaysia trending chart (free)' }
    : { connected: false, hint: 'Set YOUTUBE_API_KEY in .env (free, see README).' };

/** "PT1M5S" → 65 */
function isoDuration(s = '') {
  const m = s.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function chart(params) {
  const qs = new URLSearchParams({
    part: 'snippet,statistics,contentDetails',
    chart: 'mostPopular',
    regionCode: 'MY',
    maxResults: '50',
    key: config.youtube.apiKey,
    ...params,
  });
  const res = await fetch(`${API}?${qs}`, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`YouTube API: ${body.error?.message || res.status}`);
  return body.items || [];
}

function normalize(it, rank) {
  const sn = it.snippet || {};
  const st = it.statistics || {};
  const durationSec = isoDuration(it.contentDetails?.duration);
  // Shorts can be up to 3 min, but so are many music videos, so above 60s require a #shorts tag.
  const shortsTag = /#shorts?\b/i.test(`${sn.title} ${sn.description} ${(sn.tags || []).join(' ')}`);
  const isShort = durationSec > 0 && (durationSec <= 60 || (durationSec <= 180 && shortsTag));
  const th = sn.thumbnails || {};
  return scoreVideo({
    id: `yt_${it.id}`,
    platform: 'youtube',
    url: isShort ? `https://www.youtube.com/shorts/${it.id}` : `https://www.youtube.com/watch?v=${it.id}`,
    caption: sn.title || '',
    author: { handle: sn.channelTitle, name: sn.channelTitle },
    // maxres has no letterbox bars but doesn't exist for every video; medium (16:9) is the fallback.
    thumbnail: (th.maxres || th.medium || th.high || th.default)?.url,
    thumbnailFallback: (th.medium || th.high || th.default)?.url,
    durationSec,
    isShort,
    chartRank: rank + 1,
    postedAt: toIso(sn.publishedAt),
    stats: {
      views: toNum(st.viewCount),
      likes: toNum(st.likeCount),
      comments: toNum(st.commentCount),
      shares: 0,
    },
    sound: null,
    hashtags: [...new Set([...(sn.tags || []).slice(0, 8), ...hashtagsFrom(`${sn.title} ${sn.description}`)].map((t) => String(t).toLowerCase().replace(/\s+/g, '')))],
  });
}

export async function fetchYouTube() {
  const [all, music] = await Promise.all([
    chart({}),
    chart({ videoCategoryId: MUSIC_CATEGORY, maxResults: '25' }).catch(() => []),
  ]);
  return {
    videos: all.map(normalize),
    // Trending music videos in Malaysia — fed into the Sounds & music panel.
    music: music.map((it, i) => ({
      id: it.id,
      title: it.snippet?.title || '',
      author: it.snippet?.channelTitle,
      original: false,
      cover: (it.snippet?.thumbnails?.medium || it.snippet?.thumbnails?.high || it.snippet?.thumbnails?.default)?.url,
      url: `https://www.youtube.com/watch?v=${it.id}`,
      rank: i + 1,
      views: toNum(it.statistics?.viewCount),
    })),
  };
}
