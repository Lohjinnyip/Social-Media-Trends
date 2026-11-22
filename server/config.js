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
    socialMs: num(env.SOCIAL_REFRESH_MINUTES, 30) * 60_000,
    trendsMs: num(env.TRENDS_REFRESH_MINUTES, 60) * 60_000,
    // Manual "refresh now" for paid sources is throttled to this.
    manualSocialMinMs: 2 * 60_000,
  },

  apifyToken: env.APIFY_TOKEN?.trim() || '',

  tiktok: {
    searchQueries: list(env.TIKTOK_SEARCH_QUERIES, 'viral malaysia,trending malaysia,malaysia'),
    hashtags: list(env.TIKTOK_HASHTAGS, 'malaysia,viralmalaysia,fypmalaysia'),
    resultsPerQuery: num(env.TIKTOK_RESULTS_PER_QUERY, 15),
    dateFilter: env.TIKTOK_DATE_FILTER || 'PAST_24_HOURS',
    trendsEnabled: bool(env.TIKTOK_TRENDS_ENABLED, true),
  },

  instagram: {
    hashtags: list(env.IG_HASHTAGS, 'malaysia,viralmalaysia,malaysiaviral'),
    resultsLimit: num(env.IG_RESULTS_LIMIT, 20),
    graphToken: env.IG_GRAPH_TOKEN?.trim() || '',
    graphUserId: env.IG_BUSINESS_USER_ID?.trim() || '',
  },

  facebook: {
    pages: list(env.FB_PAGES, 'https://www.facebook.com/thestaronline,https://www.facebook.com/malaysiakini'),
    resultsPerPage: num(env.FB_RESULTS_PER_PAGE, 10),
    graphToken: env.FB_GRAPH_TOKEN?.trim() || '',
    graphPages: list(env.FB_GRAPH_PAGES, ''),
  },

  newsApiKey: env.NEWSAPI_KEY?.trim() || '',
};
