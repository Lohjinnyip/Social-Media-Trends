import { config } from './config.js';

// Apify per-event prices in USD (Free plan / Starter plan = "Bronze" store tier),
// read from each actor's pricing on 2026-11-22. Check apify.com if they change.
const P = {
  free: {
    ttResult: 0.0037, ttAddon: 0.0013, start: 0.001,
    igResult: 0.0026, fbPost: 0.005,
    trendsStart: 0.05, trendsExplore: 0.0062, trendsCC: 0.002,
    jsJob: 0.002, jsStart: 0.01, liJob: 0.002, inJob: 0.0001,
  },
  starter: {
    ttResult: 0.003, ttAddon: 0.001, start: 0.001,
    igResult: 0.0023, fbPost: 0.004,
    trendsStart: 0.05, trendsExplore: 0.0062, trendsCC: 0.002,
    jsJob: 0.002, jsStart: 0.01, liJob: 0.002, inJob: 0.0001,
  },
};

/** Worst-case estimate (every query returns its full result count). */
export function estimateCost(plan = 'free') {
  const p = P[plan];
  const { tiktok, instagram, facebook, refresh, jobs } = config;

  const ttResults = (tiktok.searchQueries.length + tiktok.hashtags.length) * tiktok.resultsPerQuery;
  const ttAddons = 1 /* scrape as if in Malaysia */
    + (tiktok.dateFilter !== 'ALL_TIME' ? 1 : 0)
    + (tiktok.sort !== 'MOST_RELEVANT' ? 1 : 0);
  const perRun = {
    tiktok: ttResults * (p.ttResult + ttAddons * p.ttAddon) + p.start,
    instagram: instagram.hashtags.length * instagram.resultsLimit * p.igResult,
    facebook: facebook.pages.length * facebook.resultsPerPage * p.fbPost + p.start,
    tiktokTrends: tiktok.trendsEnabled ? 30 * p.trendsCC + p.trendsStart + 15 * p.trendsExplore : 0,
    jobs_jobstreet: jobs.sources.includes('jobstreet') ? jobs.queries.length * (jobs.resultsPerQuery * p.jsJob + p.jsStart) : 0,
    jobs_linkedin: jobs.sources.includes('linkedin') ? jobs.queries.length * jobs.resultsPerQuery * p.liJob : 0,
    jobs_indeed: jobs.sources.includes('indeed') ? jobs.queries.length * jobs.resultsPerQuery * p.inJob : 0,
  };
  const runsPerDay = {
    tiktok: 1440 / (refresh.socialMs / 60_000),
    instagram: 1440 / (refresh.socialMs / 60_000),
    facebook: 1440 / (refresh.socialMs / 60_000),
    tiktokTrends: 1440 / (refresh.trendsMs / 60_000),
    jobs_jobstreet: 1440 / (refresh.jobsMs / 60_000),
    jobs_linkedin: 1440 / (refresh.jobsMs / 60_000),
    jobs_indeed: 1440 / (refresh.jobsMs / 60_000),
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
