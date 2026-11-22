import { config } from '../config.js';
import { runActor } from './apify.js';
import { pick, toNum, toIso } from './util.js';

/*
 * Malaysian job listings. None of LinkedIn, JobStreet, Indeed, Maukerja or
 * Hiredly offer a public job-search API, so:
 *   - JobStreet, LinkedIn, Indeed  → Apify actors (APIFY_TOKEN, paid per job)
 *   - Google Jobs                  → SerpApi (SERPAPI_KEY, free 250 searches/month).
 *                                     Google aggregates Maukerja, Hiredly, JobStreet, LinkedIn…
 *   - Careerjet                    → official v4 API (CAREERJET_API_KEY, free publisher key)
 */

const ACTORS = {
  jobstreet: 'blackfalcondata/jobstreet-scraper',
  linkedin: 'curious_coder/linkedin-jobs-scraper',
  indeed: 'curious_coder/indeed-scraper',
};

export const JOB_SOURCES = {
  jobstreet: { label: 'JobStreet', paid: true, needs: 'APIFY_TOKEN' },
  linkedin: { label: 'LinkedIn', paid: true, needs: 'APIFY_TOKEN' },
  indeed: { label: 'Indeed', paid: true, needs: 'APIFY_TOKEN' },
  google: { label: 'Google Jobs', paid: false, needs: 'SERPAPI_KEY' },
  careerjet: { label: 'Careerjet', paid: false, needs: 'CAREERJET_API_KEY' },
};

export function jobSourceStatus(name) {
  const j = config.jobs;
  const on = j.sources.includes(name);
  const has = {
    jobstreet: !!config.apifyToken,
    linkedin: !!config.apifyToken,
    indeed: !!config.apifyToken,
    google: !!j.serpApiKey,
    careerjet: !!j.careerjetKey,
  }[name];
  if (!on) return { connected: false, hint: `Disabled in JOB_SOURCES` };
  if (!has) return { connected: false, hint: `Set ${JOB_SOURCES[name].needs} in .env` };
  return { connected: true, via: { jobstreet: `Apify · ${ACTORS.jobstreet}`, linkedin: `Apify · ${ACTORS.linkedin}`, indeed: `Apify · ${ACTORS.indeed}`, google: 'SerpApi · Google Jobs', careerjet: 'Careerjet API v4' }[name] };
}

// ── helpers ──────────────────────────────────────────────────────────
const strip = (html = '') => String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const snippet = (s) => strip(s).slice(0, 280);

/** "3 days ago", "Just posted", "30+ days ago", ISO strings, epoch → ISO */
function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return toIso(v);
  const s = String(v).toLowerCase().trim();
  if (/just|today|now|baru/.test(s)) return new Date().toISOString();
  if (/yesterday|semalam/.test(s)) return new Date(Date.now() - 864e5).toISOString();
  const m = s.match(/(\d+)\+?\s*(minute|min|hour|hr|day|week|month|minit|jam|hari|minggu|bulan)/);
  if (m) {
    const unit = { minute: 6e4, min: 6e4, minit: 6e4, hour: 3.6e6, hr: 3.6e6, jam: 3.6e6, day: 864e5, hari: 864e5, week: 6048e5, minggu: 6048e5, month: 2592e6, bulan: 2592e6 }[m[2]];
    return new Date(Date.now() - Number(m[1]) * unit).toISOString();
  }
  return toIso(v);
}

function salaryText(min, max, currency = 'MYR', period = '') {
  if (!min && !max) return null;
  const f = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)));
  const cur = currency === 'MYR' ? 'RM' : `${currency} `;
  const per = { Y: '/yr', YEAR: '/yr', YEARLY: '/yr', M: '/mo', MONTH: '/mo', MONTHLY: '/mo', W: '/wk', WEEK: '/wk', D: '/day', DAY: '/day', H: '/hr', HOUR: '/hr' }[String(period).toUpperCase()] || '';
  return min && max && min !== max ? `${cur}${f(min)}–${f(max)}${per}` : `${cur}${f(min || max)}${per}`;
}

const job = (o) => ({
  id: `${o.source}_${o.rawId || o.url}`,
  via: null, company: null, location: null, salary: null, postedAt: null,
  type: null, logo: null, description: '', ...o,
});

// ── Apify sources ────────────────────────────────────────────────────
export async function fetchJobStreet() {
  const { queries, resultsPerQuery, postedWithinDays } = config.jobs;
  const dateRange = ['1', '3', '7', '14', '31'].find((d) => Number(d) >= postedWithinDays) || '';
  const runs = await Promise.allSettled(queries.map((q) => runActor(ACTORS.jobstreet, {
    query: q,
    country: 'MY',
    maxResults: resultsPerQuery,
    maxPages: Math.max(1, Math.ceil(resultsPerQuery / 30)),
    sortMode: 'date',
    dateRange,
    includeDetails: false,
    includeApplicantInsights: false,
    compact: true,
    descriptionFormat: 'text',
    descriptionMaxLength: 400,
    includeRunSummary: false,
  }).then((items) => items.map((it) => ({ ...it, _query: q })))));
  const items = settled(runs);
  return items.filter((it) => it.title).map((it) => job({
    source: 'jobstreet',
    rawId: pick(it, 'seekJobId', 'jobId', 'id'),
    query: it._query,
    title: it.title,
    company: pick(it, 'company', 'companyName', 'advertiserName'),
    location: pick(it, 'location', 'locationState'),
    salary: typeof pick(it, 'salaryLabel', 'salary', 'salaryText') === 'string'
      ? pick(it, 'salaryLabel', 'salary', 'salaryText')
      : salaryText(toNum(pick(it, 'salaryMin')), toNum(pick(it, 'salaryMax')), it.salaryCurrency || 'MYR', pick(it, 'salaryPeriod', 'salaryType')),
    postedAt: parseDate(pick(it, 'listedAt', 'listingDate', 'postedAt', 'datePosted', 'createdAt')),
    url: pick(it, 'canonicalUrl', 'url', 'jobUrl') || (it.seekJobId ? `https://my.jobstreet.com/job/${it.seekJobId}` : null),
    type: [it.employmentType, it.workArrangement].filter(Boolean).join(' · ') || null,
    logo: pick(it, 'companyLogo', 'logoUrl', 'logo'),
    description: snippet(pick(it, 'teaser', 'description') || ''),
    category: pick(it, 'subCategory', 'category'),
  }));
}

export async function fetchLinkedIn() {
  const { queries, resultsPerQuery, postedWithinDays, location } = config.jobs;
  const tpr = postedWithinDays <= 1 ? 'r86400' : postedWithinDays <= 7 ? 'r604800' : 'r2592000';
  // One run, one LinkedIn search URL per query.
  const urls = queries.map((q) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}&location=${encodeURIComponent(location)}&f_TPR=${tpr}&sortBy=DD`);
  const items = await runActor(ACTORS.linkedin, { urls, limitPerSource: resultsPerQuery, scrapeCompany: false, autoConvertToAiSearch: false });
  return items.filter((it) => it.title).map((it) => {
    const sal = Array.isArray(it.salaryInfo) ? it.salaryInfo.filter(Boolean).join(' – ') : it.salaryInfo;
    const q = queries.find((qq) => (it.inputUrl || it.searchUrl || '').includes(encodeURIComponent(qq)));
    return job({
      source: 'linkedin',
      rawId: it.id,
      query: q || null,
      title: it.title,
      company: it.companyName,
      location: it.location,
      salary: sal || null,
      postedAt: parseDate(pick(it, 'postedAt', 'postedDate', 'listedAt')),
      url: (it.link || '').split('?')[0] || (it.id ? `https://www.linkedin.com/jobs/view/${it.id}` : null),
      type: [it.employmentType, it.seniorityLevel].filter(Boolean).join(' · ') || null,
      logo: it.companyLogo,
      description: snippet(pick(it, 'descriptionText', 'descriptionHtml', 'description') || ''),
      applicants: it.applicantsCount,
    });
  });
}

export async function fetchIndeed() {
  const { queries, resultsPerQuery, postedWithinDays } = config.jobs;
  const days = ['1', '3', '7', '14'].find((d) => Number(d) >= postedWithinDays) || '';
  const runs = await Promise.allSettled(queries.map((q) => runActor(ACTORS.indeed, {
    country: 'my',
    query: q,
    location: config.jobs.city || '',
    count: resultsPerQuery,
    postedWithinDays: days,
  }).then((items) => items.map((it) => ({ ...it, _query: q })))));
  return settled(runs).filter((it) => pick(it, 'title', 'displayTitle', 'positionName')).map((it) => {
    const s = it.salary || it.estimatedSalary || {};
    const key = pick(it, 'id', 'jobkey', 'jobKey');
    return job({
      source: 'indeed',
      rawId: key,
      query: it._query,
      title: pick(it, 'title', 'displayTitle', 'positionName'),
      company: pick(it, 'companyDetails.name', 'company', 'companyName'),
      location: pick(it, 'location.formatted.long', 'location.city', 'formattedLocation', 'location'),
      salary: typeof s === 'string' ? s : salaryText(toNum(s.min), toNum(s.max), s.currencyCode || 'MYR', s.type),
      postedAt: parseDate(pick(it, 'datePublished', 'pubDate', 'postedAt', 'dateOnIndeed', 'formattedRelativeTime')),
      url: key ? `https://my.indeed.com/viewjob?jk=${key}` : pick(it, 'url', 'jobUrl'),
      type: [].concat(pick(it, 'jobTypes', 'jobType') || []).map((t) => t.label || t).join(' · ') || null,
      logo: pick(it, 'companyDetails.logoUrl', 'companyLogo'),
      description: snippet(pick(it, 'snippet', 'description.text', 'description') || ''),
    });
  });
}

// ── Free sources ─────────────────────────────────────────────────────
export async function fetchGoogleJobs() {
  const { queries, location, serpApiKey } = config.jobs;
  const runs = await Promise.allSettled(queries.map(async (q) => {
    const qs = new URLSearchParams({ engine: 'google_jobs', q: `${q} ${location}`.trim(), gl: 'my', hl: 'en', api_key: serpApiKey });
    const res = await fetch(`https://serpapi.com/search.json?${qs}`, { signal: AbortSignal.timeout(30_000) });
    const body = await res.json();
    if (!res.ok || body.error) {
      // "hasn't returned any results" is a normal empty result, not a failure.
      if (/hasn't returned any results/i.test(body.error || '')) return [];
      throw new Error(`SerpApi: ${body.error || res.status}`);
    }
    return (body.jobs_results || []).map((it) => ({ ...it, _query: q }));
  }));
  return settled(runs).map((it) => {
    const ext = it.detected_extensions || {};
    const apply = (it.apply_options || [])[0];
    return job({
      source: 'google',
      via: (it.via || apply?.title || '').replace(/^via\s+/i, '') || null,
      rawId: it.job_id?.slice(0, 80) || `${it.title}|${it.company_name}`,
      query: it._query,
      title: it.title,
      company: it.company_name,
      location: it.location,
      salary: ext.salary || null,
      postedAt: parseDate(ext.posted_at),
      url: apply?.link || it.share_link,
      applyOptions: (it.apply_options || []).slice(0, 4).map((a) => ({ title: a.title, link: a.link })),
      type: ext.schedule_type || null,
      logo: it.thumbnail,
      description: snippet(it.description || ''),
    });
  });
}

export async function fetchCareerjet() {
  const { queries, careerjetKey, resultsPerQuery, city } = config.jobs;
  const auth = 'Basic ' + Buffer.from(`${careerjetKey}:`).toString('base64');
  const runs = await Promise.allSettled(queries.map(async (q) => {
    const qs = new URLSearchParams({
      locale_code: 'en_MY',
      keywords: q,
      sort: 'date',
      page_size: String(Math.min(100, Math.max(resultsPerQuery, 20))),
      user_ip: config.jobs.careerjetUserIp,
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) MalaysiaSocialPulse/1.0',
    });
    if (city) qs.set('location', city);
    const res = await fetch(`https://search.api.careerjet.net/v4/query?${qs}`, {
      headers: { Authorization: auth, Referer: `http://localhost:${config.port}/` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.type === 'ERROR') throw new Error(`Careerjet: ${body.error || res.status}`);
    return (body.jobs || []).map((it) => ({ ...it, _query: q }));
  }));
  return settled(runs).map((it) => job({
    source: 'careerjet',
    rawId: it.url,
    query: it._query,
    title: strip(it.title),
    company: it.company || null,
    location: it.locations || null,
    salary: it.salary || salaryText(toNum(it.salary_min), toNum(it.salary_max), it.salary_currency_code || 'MYR', it.salary_type),
    postedAt: parseDate(it.date),
    url: it.url,
    via: it.site || null,
    description: snippet(it.description || ''),
  }));
}

/** Flatten Promise.allSettled results; throw only if every call failed. */
function settled(runs) {
  const ok = runs.filter((r) => r.status === 'fulfilled');
  if (!ok.length && runs.length) throw runs[0].reason;
  return ok.flatMap((r) => r.value);
}

export const JOB_FETCHERS = {
  jobstreet: fetchJobStreet,
  linkedin: fetchLinkedIn,
  indeed: fetchIndeed,
  google: fetchGoogleJobs,
  careerjet: fetchCareerjet,
};

// ── Merge across sources ─────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/\((m|malaysia)\)/g, ' ').replace(/\b(sdn\.?\s*bhd\.?|berhad|bhd|plc|ltd|inc)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Same title + company on several sites → one row listing every site it's on. */
export function mergeJobs(lists) {
  const map = new Map();
  for (const j of lists.flat()) {
    if (!j.title || !j.url) continue;
    const key = `${norm(j.title)}|${norm(j.company)}`;
    const prev = map.get(key);
    const site = { source: j.source, via: j.via, url: j.url };
    if (!prev) {
      map.set(key, { ...j, key, sites: [site] });
      continue;
    }
    if (!prev.sites.some((s) => s.url === j.url)) prev.sites.push(site);
    prev.salary ||= j.salary;
    prev.logo ||= j.logo;
    prev.type ||= j.type;
    if (!prev.description && j.description) prev.description = j.description;
    if (j.postedAt && (!prev.postedAt || j.postedAt > prev.postedAt)) prev.postedAt = j.postedAt;
  }
  return [...map.values()].sort((a, b) => Date.parse(b.postedAt || 0) - Date.parse(a.postedAt || 0));
}
