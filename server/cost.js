import { config } from './config.js';

// Apify per-event prices in USD (Free plan / Starter plan = "Bronze" store tier),
// read from each actor's pricing on 2026-11-22. Check apify.com if they change.
const P = {
  free: {
    ttResult: 0.0037, ttAddon: 0.0013, start: 0.001,
    igResult: 0.0026, fbPost: 0.005,
    trendsStart: 0.05, trendsExplore: 0.0062, trendsCC: 0.002,
  },
  starter: {
    ttResult: 0.003, ttAddon: 0.001, start: 0.001,
    igResult: 0.0023, fbPost: 0.004,
    trendsStart: 0.05, trendsExplore: 0.0062, trendsCC: 0.002,
  },
};

/** Worst-case estimate (every query returns its full result count). */
export function estimateCost(plan = 'free') {
  const p = P[plan];
  const { tiktok, instagram, facebook, refresh } = config;

  const ttResults = (tiktok.searchQueries.length + tiktok.hashtags.length) * tiktok.resultsPerQuery;
  const ttAddons = 1 /* scrape as if in Malaysia */
    + (tiktok.dateFilter !== 'ALL_TIME' ? 1 : 0)
    + (tiktok.sort !== 'MOST_RELEVANT' ? 1 : 0);
  const perRun = {
    tiktok: ttResults * (p.ttResult + ttAddons * p.ttAddon) + p.start,
    instagram: instagram.hashtags.length * instagram.resultsLimit * p.igResult,
    facebook: facebook.pages.length * facebook.resultsPerPage * p.fbPost + p.start,
    tiktokTrends: tiktok.trendsEnabled ? 30 * p.trendsCC + p.trendsStart + 15 * p.trendsExplore : 0,
  };
  const runsPerDay = {
    tiktok: 1440 / (refresh.socialMs / 60_000),
    instagram: 1440 / (refresh.socialMs / 60_000),
    facebook: 1440 / (refresh.socialMs / 60_000),
    tiktokTrends: 1440 / (refresh.trendsMs / 60_000),
  };
  const perDay = Object.keys(perRun).reduce((sum, k) => sum + perRun[k] * runsPerDay[k], 0);
  return { perRun, runsPerDay, perDay, perMonth: perDay * 30 };
}

export function costSummary() {
  const f = estimateCost('free');
  const s = estimateCost('starter');
  return `~$${f.perDay.toFixed(2)}/day (~$${f.perMonth.toFixed(0)}/month) at Free-plan prices, `
    + `~$${s.perDay.toFixed(2)}/day (~$${s.perMonth.toFixed(0)}/month) at Starter prices`;
}
