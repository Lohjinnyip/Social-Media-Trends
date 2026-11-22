/** Return the first defined, non-empty value found at any of the given dot-paths. */
export function pick(obj, ...paths) {
  for (const p of paths) {
    let v = obj;
    for (const k of p.split('.')) {
      if (v == null) break;
      v = v[k];
    }
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export const toNum = (v) => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toUpperCase().replace(/,/g, '');
  const m = s.match(/^([\d.]+)\s*([KMB])?$/);
  if (!m) return Number(s) || 0;
  return Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]] || 1);
};

export function toIso(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function hashtagsFrom(text = '') {
  return [...new Set((String(text).match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.slice(1).toLowerCase()))];
}

/**
 * Trend score: weighted engagement divided by age, so a fresh video gaining
 * views quickly outranks an old one with a bigger lifetime total.
 */
export function scoreVideo(v) {
  const { views, likes, comments, shares } = v.stats;
  const hours = v.postedAt ? Math.max((Date.now() - Date.parse(v.postedAt)) / 3.6e6, 0) : 48;
  const engagement = views + likes * 8 + comments * 15 + shares * 25;
  v.ageHours = Math.round(hours * 10) / 10;
  v.velocity = Math.round(views / Math.max(hours, 1));
  v.score = Math.round(engagement / Math.pow(hours + 2, 1.3));
  return v;
}

export function dedupe(items, key = (i) => i.id) {
  const seen = new Map();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    const prev = seen.get(k);
    if (!prev || (it.stats?.views || 0) > (prev.stats?.views || 0)) seen.set(k, it);
  }
  return [...seen.values()];
}
