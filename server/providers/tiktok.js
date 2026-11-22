import { config } from '../config.js';
import { runActor } from './apify.js';
import { pick, toNum, toIso, scoreVideo, dedupe } from './util.js';

const VIDEO_ACTOR = 'clockworks/tiktok-scraper';
const TRENDS_ACTOR = 'automation-lab/tiktok-trends-scraper';

export const tiktokStatus = () =>
  config.apifyToken
    ? { connected: true, via: 'Apify · clockworks/tiktok-scraper' }
    : { connected: false, hint: 'Set APIFY_TOKEN in .env to pull trending Malaysian TikToks.' };

function normalizeVideo(it) {
  const music = it.musicMeta || it.music || {};
  const author = it.authorMeta || it.author || {};
  const handle = pick(author, 'name', 'uniqueId', 'username');
  const id = String(pick(it, 'id', 'videoId') ?? '');
  return scoreVideo({
    id: `tt_${id}`,
    platform: 'tiktok',
    url: pick(it, 'webVideoUrl', 'url') || (handle && id ? `https://www.tiktok.com/@${handle}/video/${id}` : null),
    caption: pick(it, 'text', 'desc', 'description') || '',
    author: {
      handle,
      name: pick(author, 'nickName', 'nickname', 'name'),
      avatar: pick(author, 'avatar', 'avatarThumb'),
      verified: !!author.verified,
    },
    thumbnail: pick(it, 'videoMeta.coverUrl', 'videoMeta.originalCoverUrl', 'covers.default', 'cover'),
    durationSec: toNum(pick(it, 'videoMeta.duration', 'duration')),
    postedAt: toIso(pick(it, 'createTimeISO', 'createTime')),
    stats: {
      views: toNum(pick(it, 'playCount', 'stats.playCount')),
      likes: toNum(pick(it, 'diggCount', 'stats.diggCount')),
      comments: toNum(pick(it, 'commentCount', 'stats.commentCount')),
      shares: toNum(pick(it, 'shareCount', 'stats.shareCount')),
    },
    sound: {
      id: pick(music, 'musicId', 'id'),
      title: pick(music, 'musicName', 'title') || 'Unknown sound',
      author: pick(music, 'musicAuthor', 'authorName'),
      original: !!pick(music, 'musicOriginal', 'original'),
      audioUrl: pick(music, 'playUrl'),
      cover: pick(music, 'coverMediumUrl', 'coverThumb'),
      url: pick(music, 'musicId', 'id') ? `https://www.tiktok.com/music/x-${pick(music, 'musicId', 'id')}` : null,
    },
    hashtags: (it.hashtags || []).map((h) => (h.name || h.title || h).toString().toLowerCase()).filter(Boolean),
    region: pick(it, 'locationCreated', 'region'),
  });
}

export async function fetchTikTokVideos() {
  const { searchQueries, hashtags, resultsPerQuery, dateFilter } = config.tiktok;
  const items = await runActor(VIDEO_ACTOR, {
    searchQueries,
    hashtags,
    resultsPerPage: resultsPerQuery,
    searchSection: '/video',
    videoSearchSorting: 'MOST_LIKED',
    videoSearchDateFilter: dateFilter,
    proxyCountryCode: 'MY',
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadAvatars: false,
    shouldDownloadMusicCovers: false,
  });
  const videos = dedupe(items.filter((i) => !i.error).map(normalizeVideo));
  return videos.sort((a, b) => b.score - a.score);
}

/** Official-ish trend lists: Creative Center hashtags (country-ranked) and Explore sounds. */
export async function fetchTikTokTrends() {
  if (!config.tiktok.trendsEnabled) return { hashtags: [], sounds: [] };
  const [tags, sounds] = await Promise.allSettled([
    runActor(TRENDS_ACTOR, { trendType: 'hashtag', countryCode: 'MY', period: 7, maxResults: 30 }),
    runActor(TRENDS_ACTOR, { trendType: 'sound', countryCode: 'MY', period: 7, maxResults: 30 }),
  ]);
  const errors = [tags, sounds].filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (errors.length === 2) throw new Error(errors.join(' | '));

  const hashtagList = (tags.value || []).map((h, i) => ({
    name: String(pick(h, 'hashtag', 'hashtagName', 'name', 'title') || '').replace(/^#/, ''),
    rank: toNum(pick(h, 'rank')) || i + 1,
    posts: toNum(pick(h, 'posts', 'publishCount', 'postCount', 'videoCount')),
    views: toNum(pick(h, 'views', 'videoViews', 'viewCount')),
    stage: pick(h, 'trendStage', 'stage', 'trend'),
    url: pick(h, 'url', 'hashtagUrl'),
  })).filter((h) => h.name);

  const soundList = (sounds.value || []).map((s, i) => ({
    id: pick(s, 'soundId', 'musicId', 'id'),
    title: pick(s, 'title', 'soundTitle', 'musicName', 'name') || 'Unknown sound',
    author: pick(s, 'artist', 'author', 'authorName', 'musicAuthor'),
    original: !!pick(s, 'isOriginal', 'original', 'originalSound'),
    audioUrl: pick(s, 'audioUrl', 'playUrl'),
    cover: pick(s, 'cover', 'coverUrl', 'coverMediumUrl'),
    url: pick(s, 'url', 'soundUrl', 'link'),
    rank: toNum(pick(s, 'rank')) || i + 1,
    durationSec: toNum(pick(s, 'duration')),
  }));

  return { hashtags: hashtagList, sounds: soundList, partialErrors: errors };
}
