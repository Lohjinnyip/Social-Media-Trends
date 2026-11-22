import { config } from '../config.js';
import { runActor } from './apify.js';
import { pick, toNum, toIso, scoreVideo, dedupe, hashtagsFrom } from './util.js';

const ACTOR = 'apify/instagram-hashtag-scraper';
const GRAPH = 'https://graph.facebook.com/v21.0';

const useGraph = () => !config.apifyToken && config.instagram.graphToken && config.instagram.graphUserId;

export const instagramStatus = () => {
  if (config.apifyToken) return { connected: true, via: 'Apify · instagram-hashtag-scraper (Reels)' };
  if (useGraph()) return { connected: true, via: 'Meta Graph API · hashtag top media (no music data)' };
  return {
    connected: false,
    hint: 'Set APIFY_TOKEN, or IG_GRAPH_TOKEN + IG_BUSINESS_USER_ID for the Meta Graph API.',
  };
};

function normalizeApify(it) {
  const music = it.musicInfo || it.clipsMusicAttributionInfo || {};
  const original = !!pick(music, 'uses_original_audio', 'usesOriginalAudio');
  return scoreVideo({
    id: `ig_${pick(it, 'id', 'shortCode')}`,
    platform: 'instagram',
    url: pick(it, 'url') || (it.shortCode ? `https://www.instagram.com/reel/${it.shortCode}/` : null),
    caption: it.caption || '',
    author: { handle: pick(it, 'ownerUsername'), name: pick(it, 'ownerFullName', 'ownerUsername') },
    thumbnail: pick(it, 'displayUrl', 'thumbnailUrl', 'images.0'),
    durationSec: toNum(it.videoDuration),
    postedAt: toIso(it.timestamp),
    stats: {
      views: toNum(pick(it, 'videoPlayCount', 'videoViewCount', 'igPlayCount')),
      likes: Math.max(toNum(it.likesCount), 0),
      comments: toNum(it.commentsCount),
      shares: toNum(pick(it, 'sharesCount', 'reshareCount')),
    },
    sound: music && Object.keys(music).length
      ? {
          id: pick(music, 'audio_id', 'audioId'),
          title: original ? 'Original audio' : pick(music, 'song_name', 'songName') || 'Unknown audio',
          author: pick(music, 'artist_name', 'artistName', 'ownerUsername'),
          original,
          url: pick(music, 'audio_id', 'audioId') ? `https://www.instagram.com/reels/audio/${pick(music, 'audio_id', 'audioId')}/` : null,
        }
      : null,
    hashtags: (it.hashtags?.length ? it.hashtags : hashtagsFrom(it.caption)).map((h) => String(h).toLowerCase()),
  });
}

async function graph(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(config.instagram.graphToken)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`Graph API: ${body.error?.message || res.status}`);
  return body;
}

async function fetchViaGraph() {
  const uid = config.instagram.graphUserId;
  const out = [];
  // Instagram allows 30 unique hashtag lookups per 7 days per account — keep the list short.
  for (const tag of config.instagram.hashtags.slice(0, 5)) {
    const { data: [hit] = [] } = await graph(`/ig_hashtag_search?user_id=${uid}&q=${encodeURIComponent(tag)}`);
    if (!hit) continue;
    const { data = [] } = await graph(
      `/${hit.id}/top_media?user_id=${uid}&fields=id,caption,media_type,media_url,thumbnail_url,permalink,like_count,comments_count,timestamp&limit=25`,
    );
    for (const m of data.filter((m) => m.media_type === 'VIDEO')) {
      out.push(scoreVideo({
        id: `ig_${m.id}`,
        platform: 'instagram',
        url: m.permalink,
        caption: m.caption || '',
        author: { handle: null, name: `#${tag}` },
        thumbnail: m.thumbnail_url || m.media_url,
        postedAt: toIso(m.timestamp),
        stats: { views: 0, likes: toNum(m.like_count), comments: toNum(m.comments_count), shares: 0 },
        sound: null,
        hashtags: hashtagsFrom(m.caption),
      }));
    }
  }
  return out;
}

export async function fetchInstagramVideos() {
  let videos;
  if (config.apifyToken) {
    const items = await runActor(ACTOR, {
      hashtags: config.instagram.hashtags,
      resultsType: 'reels',
      resultsLimit: config.instagram.resultsLimit,
    });
    videos = items
      .filter((i) => !i.error && (i.type === 'Video' || i.videoUrl || i.productType === 'clips' || i.videoPlayCount))
      .map(normalizeApify);
  } else if (useGraph()) {
    videos = await fetchViaGraph();
  } else {
    throw new Error('Instagram is not configured');
  }
  return dedupe(videos).sort((a, b) => b.score - a.score);
}
