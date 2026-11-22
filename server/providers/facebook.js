import { config } from '../config.js';
import { runActor } from './apify.js';
import { pick, toNum, toIso, scoreVideo, dedupe, hashtagsFrom } from './util.js';

const ACTOR = 'apify/facebook-posts-scraper';
const GRAPH = 'https://graph.facebook.com/v21.0';

const useGraph = () => !config.apifyToken && config.facebook.graphToken && config.facebook.graphPages.length;

export const facebookStatus = () => {
  if (config.apifyToken) return { connected: true, via: `Apify · facebook-posts-scraper (${config.facebook.pages.length} pages)` };
  if (useGraph()) return { connected: true, via: 'Meta Graph API · page posts' };
  return {
    connected: false,
    hint: 'Set APIFY_TOKEN (and edit FB_PAGES), or FB_GRAPH_TOKEN + FB_GRAPH_PAGES.',
  };
};

function isVideoPost(it) {
  const media = it.media || it.attachments || [];
  return (
    it.isVideo ||
    toNum(pick(it, 'viewsCount', 'videoViewCount', 'playCount')) > 0 ||
    /\/(videos|reel|watch)\//.test(String(pick(it, 'url', 'topLevelUrl') || '')) ||
    media.some((m) => /video/i.test(m.__typename || m.type || '') || m.videoUrl || m.playable_url)
  );
}

function normalizeApify(it) {
  const media = (it.media || [])[0] || {};
  const text = pick(it, 'text', 'message', 'postText') || '';
  return scoreVideo({
    id: `fb_${pick(it, 'postId', 'id', 'url')}`,
    platform: 'facebook',
    url: pick(it, 'url', 'topLevelUrl', 'facebookUrl'),
    caption: text,
    author: { handle: pick(it, 'pageName', 'user.name'), name: pick(it, 'pageName', 'user.name'), avatar: pick(it, 'user.profilePic') },
    thumbnail: pick(media, 'thumbnail', 'photo_image.uri', 'image.uri', 'thumbnailImage.uri') || pick(it, 'thumbnail', 'image'),
    postedAt: toIso(pick(it, 'time', 'timestamp', 'date')),
    stats: {
      views: toNum(pick(it, 'viewsCount', 'videoViewCount', 'playCount')),
      likes: toNum(pick(it, 'likes', 'reactionsCount', 'topReactionsCount')),
      comments: toNum(pick(it, 'comments', 'commentsCount')),
      shares: toNum(pick(it, 'shares', 'sharesCount')),
    },
    sound: null, // Facebook doesn't expose the audio track of a post.
    hashtags: hashtagsFrom(text),
    isVideo: isVideoPost(it),
  });
}

async function fetchViaGraph() {
  const out = [];
  const fields = 'message,permalink_url,created_time,full_picture,shares,attachments{media_type},reactions.summary(true).limit(0),comments.summary(true).limit(0)';
  for (const page of config.facebook.graphPages) {
    const url = `${GRAPH}/${encodeURIComponent(page)}/posts?fields=${fields}&limit=25&access_token=${encodeURIComponent(config.facebook.graphToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(`Graph API (${page}): ${body.error?.message || res.status}`);
    for (const p of body.data || []) {
      const isVideo = (p.attachments?.data || []).some((a) => /video/i.test(a.media_type || ''));
      out.push(scoreVideo({
        id: `fb_${p.id}`,
        platform: 'facebook',
        url: p.permalink_url,
        caption: p.message || '',
        author: { handle: page, name: page },
        thumbnail: p.full_picture,
        postedAt: toIso(p.created_time),
        stats: {
          views: 0,
          likes: toNum(p.reactions?.summary?.total_count),
          comments: toNum(p.comments?.summary?.total_count),
          shares: toNum(p.shares?.count),
        },
        sound: null,
        hashtags: hashtagsFrom(p.message),
        isVideo,
      }));
    }
  }
  return out;
}

export async function fetchFacebookVideos() {
  let posts;
  if (config.apifyToken) {
    const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
    const items = await runActor(ACTOR, {
      startUrls: config.facebook.pages.map((url) => ({ url })),
      resultsLimit: config.facebook.resultsPerPage,
      onlyPostsNewerThan: since,
    });
    posts = items.filter((i) => !i.error).map(normalizeApify);
  } else if (useGraph()) {
    posts = await fetchViaGraph();
  } else {
    throw new Error('Facebook is not configured');
  }
  // Prefer video posts; fall back to all posts if pages published no videos in the window.
  const videos = posts.filter((p) => p.isVideo);
  return dedupe(videos.length ? videos : posts).sort((a, b) => b.score - a.score);
}
