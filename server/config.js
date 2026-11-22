const env = process.env;

const list = (v, fallback = '') =>
  (v ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const bool = (v, fallback) => (v == null || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: num(env.PORT, 3000),

  refresh: {
    newsMs: num(env.NEWS_REFRESH_MINUTES, 3) * 60_000,
    socialMs: num(env.SOCIAL_REFRESH_MINUTES, 720) * 60_000,
    trendsMs: num(env.TRENDS_REFRESH_MINUTES, 1440) * 60_000,
    youtubeMs: num(env.YOUTUBE_REFRESH_MINUTES, 30) * 60_000,
    searchTrendsMs: num(env.SEARCH_TRENDS_REFRESH_MINUTES, 10) * 60_000,
    // Manual "refresh now" for paid sources is throttled to this.
    manualSocialMinMs: 2 * 60_000,
  },

  apifyToken: env.APIFY_TOKEN?.trim() || '',

  tiktok: {
    searchQueries: list(env.TIKTOK_SEARCH_QUERIES, 'viral malaysia,trending malaysia,malaysia'),
    hashtags: list(env.TIKTOK_HASHTAGS, 'viralmalaysia,fypmalaysia'),
    resultsPerQuery: num(env.TIKTOK_RESULTS_PER_QUERY, 10),
    // MOST_LIKED / LATEST cost an extra $0.0013 per result; we re-rank by trend score anyway.
    sort: env.TIKTOK_SORT || 'MOST_RELEVANT',
    dateFilter: env.TIKTOK_DATE_FILTER || 'PAST_24_HOURS',
    trendsEnabled: bool(env.TIKTOK_TRENDS_ENABLED, true),
  },

  instagram: {
    hashtags: list(env.IG_HASHTAGS, 'viralmalaysia,malaysiaviral,reelsmalaysia'),
    resultsLimit: num(env.IG_RESULTS_LIMIT, 10),
    graphToken: env.IG_GRAPH_TOKEN?.trim() || '',
    graphUserId: env.IG_BUSINESS_USER_ID?.trim() || '',
  },

  facebook: {
    pages: list(env.FB_PAGES, 'https://www.facebook.com/thestaronline,https://www.facebook.com/malaysiakini'),
    resultsPerPage: num(env.FB_RESULTS_PER_PAGE, 5),
    graphToken: env.FB_GRAPH_TOKEN?.trim() || '',
    graphPages: list(env.FB_GRAPH_PAGES, ''),
  },

  youtube: {
    apiKey: env.YOUTUBE_API_KEY?.trim() || '',
  },

  newsApiKey: env.NEWSAPI_KEY?.trim() || '',
};
