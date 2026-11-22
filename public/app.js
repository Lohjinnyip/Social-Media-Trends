const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (n) => (n ? compact.format(n) : '0');

const MEDIA_HOSTS = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibyteimg.com', 'muscdn.com', 'tiktokv.com', 'byteoversea.com', 'cdninstagram.com', 'fbcdn.net'];
function media(url) {
  if (!url) return '';
  try {
    const h = new URL(url).hostname;
    return MEDIA_HOSTS.some((d) => h === d || h.endsWith('.' + d)) ? `/api/media?url=${encodeURIComponent(url)}` : url;
  } catch { return ''; }
}

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 0) return 'in ' + until(iso);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function until(iso) {
  const s = Math.max(0, (Date.parse(iso) - Date.now()) / 1000);
  if (s < 60) return `${Math.ceil(s)}s`;
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

// ── State ────────────────────────────────────────────────────────────
let state = null;
const ui = { platform: 'all', sort: 'score', soundKind: 'all', lang: 'all' };
const seenNews = new Set();
let firstNewsLoad = true;
const freshNews = new Set();
let flashNews = new Set();

try {
  const saved = JSON.parse(localStorage.getItem('pulse-ui') || '{}');
  Object.assign(ui, saved);
  if (saved.theme) document.documentElement.dataset.theme = saved.theme;
} catch {}
const saveUi = () => { try { localStorage.setItem('pulse-ui', JSON.stringify(ui)); } catch {} };

// ── Rendering ────────────────────────────────────────────────────────
const LABEL = { news: 'News', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktokTrends: 'TikTok trends', searchTrends: 'Google Trends' };
const PLATFORMS = ['tiktok', 'instagram', 'facebook', 'youtube'];

function renderStatus() {
  const order = ['tiktok', 'instagram', 'facebook', 'youtube', 'tiktokTrends', 'searchTrends', 'news'];
  $('#status').innerHTML = order.map((k) => {
    const s = state.sources[k];
    const prov = state.providers[k === 'tiktokTrends' ? 'tiktok' : k];
    if (!s.enabled) {
      return `<div class="src off" title="${esc(prov?.hint || '')}"><span class="dot"></span><b>${LABEL[k]}</b><span class="meta">not connected</span></div>`;
    }
    const cls = s.running ? 'running' : s.error && !s.updatedAt ? 'err' : 'ok';
    const meta = s.running
      ? 'fetching…'
      : `${s.updatedAt ? 'updated ' + ago(s.updatedAt) : 'waiting'}${s.nextAt ? ' · next in ' + until(s.nextAt) : ''}`;
    const title = [prov?.via, s.error].filter(Boolean).join('\n');
    return `<div class="src ${cls}" title="${esc(title)}"><span class="dot"></span><b>${LABEL[k]}</b><span class="meta">${meta}</span>${s.error ? '<span title="' + esc(s.error) + '">⚠️</span>' : ''}<button data-refresh="${k}" title="Refresh ${LABEL[k]} now">↻</button></div>`;
  }).join('');
}

function allVideos() {
  const v = state.videos;
  let list = ui.platform === 'all' ? PLATFORMS.flatMap((p) => v[p] || []) : [...(v[ui.platform] || [])];
  const sorters = {
    score: (a, b) => b.score - a.score,
    views: (a, b) => b.stats.views - a.stats.views,
    likes: (a, b) => b.stats.likes - a.stats.likes,
    newest: (a, b) => Date.parse(b.postedAt || 0) - Date.parse(a.postedAt || 0),
  };
  return list.sort(sorters[ui.sort]);
}

function setupCard() {
  return `<div class="setup">
    <h3>Connect your video sources</h3>
    <p><b>YouTube (free):</b> create a free key in Google Cloud and set <code>YOUTUBE_API_KEY</code> in <code>.env</code> for YouTube's official Malaysia trending chart. Steps are in <code>README.md</code>.</p>
    <p><b>TikTok, Instagram, Facebook:</b> no official API lists “trending in Malaysia”, so these use <b>Apify</b> scrapers. One token covers all three, and the free plan includes $5/month.</p>
    <ol>
      <li>Create a free account at <a href="https://console.apify.com" target="_blank" rel="noopener"><u>console.apify.com</u></a> and copy your API token from <i>Settings → API &amp; Integrations</i>.</li>
      <li>Copy <code>.env.example</code> to <code>.env</code> and set <code>APIFY_TOKEN=…</code></li>
      <li>Restart with <code>npm start</code>. Videos, sounds and hashtags will appear after the first scrape (1–3 min).</li>
    </ol>
    <p>Meta Graph API is supported as an alternative for Instagram/Facebook. See <code>README.md</code>.</p>
  </div>`;
}

function videoCard(v, i) {
  const s = v.sound;
  const soundHtml = s
    ? `<a class="soundchip ${s.original ? 'original' : ''}" href="${esc(s.url || v.url)}" target="_blank" rel="noopener" title="${esc(s.title)}${s.author ? ' · ' + esc(s.author) : ''}">${s.original ? '🎙' : '♪'} <span>${esc(s.title)}${s.author ? ' · ' + esc(s.author) : ''}</span></a>`
    : '';
  const thumb = media(v.thumbnail);
  return `<article class="vcard">
    <a class="thumb" href="${esc(v.url)}" target="_blank" rel="noopener">
      ${thumb ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(thumb)}" data-fb="${esc(media(v.thumbnailFallback))}" alt="" onerror="if (this.dataset.fb) { this.src = this.dataset.fb; this.dataset.fb = ''; } else this.remove()">` : ''}
      <span class="noimg">▶</span>
      <span class="rank">#${i + 1}</span>
      <span class="pbadge ${v.platform}">${{ instagram: 'IG', facebook: 'FB', youtube: v.isShort ? 'YT Shorts' : 'YouTube', tiktok: 'TikTok' }[v.platform]}</span>
      <div class="overlay-stats">
        ${v.stats.views ? `<span>▶ ${fmt(v.stats.views)}</span>` : ''}
        <span>♥ ${fmt(v.stats.likes)}</span>
        <span>💬 ${fmt(v.stats.comments)}</span>
        ${v.stats.shares ? `<span>↗ ${fmt(v.stats.shares)}</span>` : ''}
      </div>
    </a>
    <div class="vbody">
      <div class="author">${esc(v.author?.name || v.author?.handle || 'Unknown')}${v.author?.handle && v.author.handle !== v.author.name ? ` <span class="muted">@${esc(v.author.handle)}</span>` : ''}</div>
      <div class="caption" title="${esc(v.caption)}">${esc(v.caption) || '<i>No caption</i>'}</div>
      ${soundHtml}
      <div class="vfoot"><span>${ago(v.postedAt)}</span>${v.velocity ? `<span class="velocity">🔥 ${fmt(v.velocity)}/hr</span>` : ''}</div>
    </div>
  </article>`;
}

function renderVideos() {
  const anyConnected = PLATFORMS.some((k) => state.providers[k]?.connected);
  const list = allVideos();
  $('#videoCount').textContent = list.length ? `· ${list.length}` : '';
  if (!anyConnected) return ($('#videos').innerHTML = setupCard());
  if (!list.length) {
    const platforms = ui.platform === 'all' ? PLATFORMS : [ui.platform];
    const running = platforms.some((k) => state.sources[k].running);
    const errors = platforms.map((k) => state.sources[k].error && `${LABEL[k]}: ${state.sources[k].error}`).filter(Boolean);
    const notConn = platforms.filter((k) => !state.providers[k].connected).map((k) => `${LABEL[k]}: ${state.providers[k].hint}`);
    if (running) return ($('#videos').innerHTML = Array(8).fill('<div class="skeleton"></div>').join(''));
    return ($('#videos').innerHTML = `<div class="empty" style="grid-column:1/-1">No videos yet.<br>${[...errors, ...notConn].map(esc).join('<br>')}</div>`);
  }
  $('#videos').innerHTML = list.slice(0, 120).map(videoCard).join('');
}

function renderSounds() {
  const list = state.sounds.filter((s) => ui.soundKind === 'all' || s.kind === ui.soundKind);
  if (!list.length) {
    $('#sounds').innerHTML = `<div class="empty">${['tiktok', 'instagram', 'youtube'].some((k) => state.providers[k].connected) ? 'Sounds appear after the first refresh.' : 'Connect YouTube (free) for Malaysia\'s trending music, or TikTok/Instagram for the sounds used in trending videos.'}</div>`;
    return;
  }
  const playing = $('#player').dataset.src;
  $('#sounds').innerHTML = list.map((s, i) => {
    const audio = media(s.audioUrl);
    const link = s.url || s.examples?.[0]?.url || '#';
    return `<div class="srow">
      <span class="n">${i + 1}</span>
      <a class="scover" href="${esc(link)}" target="_blank" rel="noopener">${s.cover ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(media(s.cover))}" alt="" onerror="this.remove()">` : s.original ? '🎙' : '♪'}</a>
      <div style="min-width:0">
        <a class="stitle" href="${esc(link)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(s.title)}</a>
        <div class="smeta">
          ${s.trendRank ? `<span class="tag hot">MY #${s.trendRank}</span>` : ''}
          ${s.ytRank ? `<span class="tag hot">YT MY #${s.ytRank}</span>` : ''}
          ${s.original ? '<span class="tag orig">Original / SFX</span>' : ''}
          ${(s.platforms || []).map((p) => `<span class="tag ${{ instagram: 'ig', youtube: 'yt', tiktok: 'tt' }[p]}">${{ instagram: 'IG', youtube: 'YT', tiktok: 'TT' }[p]}</span>`).join('')}
          ${esc(s.author || '')}
        </div>
        <div class="smeta">${s.videos ? `${s.videos} trending video${s.videos > 1 ? 's' : ''}${s.totalViews ? ' · ' + fmt(s.totalViews) + ' views' : ''}` : s.ytRank ? `Trending music video · ${fmt(s.totalViews)} views` : 'Trending on TikTok Explore'}</div>
      </div>
      ${audio ? `<button class="play ${playing === audio ? 'on' : ''}" data-audio="${esc(audio)}" aria-label="Preview">${playing === audio ? '❚❚' : '▶'}</button>` : '<span></span>'}
    </div>`;
  }).join('');
}

function renderHashtags() {
  const official = state.trends.hashtags || [];
  const derived = state.hashtags || [];
  let html = '';
  if (official.length) {
    html += `<div class="subhead">TikTok Creative Center · Malaysia, 7 days</div><div class="tags">${official.slice(0, 20).map((h) =>
      `<a class="htag official" target="_blank" rel="noopener" href="https://www.tiktok.com/tag/${encodeURIComponent(h.name)}">#${esc(h.name)}${h.posts ? `<small>${fmt(h.posts)} posts</small>` : ''}</a>`).join('')}</div>`;
  }
  if (derived.length) {
    html += `<div class="subhead">In current trending videos</div><div class="tags">${derived.slice(0, 30).map((h) =>
      `<span class="htag">#${esc(h.name)}<small>${h.videos}</small></span>`).join('')}</div>`;
  }
  if (!state.providers.tiktok.connected) {
    html += `<div class="subhead">TikTok · free, opens in your browser</div><div class="cc-links">
      <a class="htag official" target="_blank" rel="noopener" href="https://ads.tiktok.com/creative/creativeCenter/trends">TikTok Creative Center trends (choose Malaysia) ↗</a></div>`;
  }
  $('#hashtags').innerHTML = html || '<div class="empty">Hashtags appear once social sources are connected.</div>';
}

function renderSearchTrends() {
  const items = state.searchTrends || [];
  if (!items.length) {
    $('#searchTrends').innerHTML = `<li class="empty" style="display:block">${esc(state.sources.searchTrends?.error || 'Loading…')}</li>`;
    return;
  }
  $('#searchTrends').innerHTML = items.slice(0, 20).map((t) => `<li>
    <div style="min-width:0"><a class="q" href="${esc(t.searchUrl)}" target="_blank" rel="noopener">${esc(t.query)}</a>
      ${t.news[0] ? `<a class="ctx" href="${esc(t.news[0].url)}" target="_blank" rel="noopener" title="${esc(t.news[0].title)}">${esc(t.news[0].source || '')}: ${esc(t.news[0].title)}</a>` : ''}</div>
    <span class="traffic">${esc(t.traffic)}</span>
  </li>`).join('');
}

function renderNews() {
  const items = state.news.filter((n) => ui.lang === 'all' || n.lang === ui.lang).slice(0, 80);
  if (!items.length) {
    const s = state.sources.news;
    $('#news').innerHTML = `<li class="empty">${s.running || !s.updatedAt ? 'Loading headlines…' : esc(s.error || 'No headlines')}</li>`;
    return;
  }
  $('#news').innerHTML = items.map((n) => {
    const fresh = freshNews.has(n.id);
    return `<li class="${flashNews.has(n.id) ? 'fresh' : ''}"><a href="${esc(n.url)}" target="_blank" rel="noopener" class="${n.image ? '' : 'noimg'}">
      <div>
        <div class="ntitle">${fresh ? '<span class="new">NEW</span>' : ''}${esc(n.title)}</div>
        <div class="nmeta">${esc(n.source)} · ${ago(n.publishedAt)}</div>
      </div>
      ${n.image ? `<img class="nimg" loading="lazy" referrerpolicy="no-referrer" src="${esc(n.image)}" alt="" onerror="this.parentElement.classList.add('noimg');this.remove()">` : ''}
    </a></li>`;
  }).join('');
  flashNews = new Set();
}

function trackNewNews() {
  let added = 0;
  for (const n of state.news) {
    if (!seenNews.has(n.id)) {
      seenNews.add(n.id);
      if (!firstNewsLoad) { freshNews.add(n.id); flashNews.add(n.id); added++; }
    }
  }
  if (state.news.length) firstNewsLoad = false;
  if (added) {
    toast(`📰 ${added} new headline${added > 1 ? 's' : ''}`);
    setTimeout(() => freshNews.clear(), 10 * 60_000);
  }
}

function render() {
  if (!state) return;
  renderStatus();
  renderVideos();
  renderSounds();
  renderHashtags();
  renderSearchTrends();
  renderNews();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Live connection ──────────────────────────────────────────────────
function connect() {
  const es = new EventSource('/api/stream');
  const live = $('#live');
  es.addEventListener('state', (e) => {
    const prevVideos = state ? Object.values(state.videos).flat().length : null;
    state = JSON.parse(e.data);
    trackNewNews();
    const nowVideos = Object.values(state.videos).flat().length;
    if (prevVideos !== null && nowVideos && prevVideos !== nowVideos) toast(`🎬 Trending videos updated (${nowVideos})`);
    render();
  });
  es.onopen = () => { live.className = 'live'; live.querySelector('span').textContent = 'Live'; };
  es.onerror = () => { live.className = 'live off'; live.querySelector('span').textContent = 'Reconnecting…'; };
}

// ── Controls ─────────────────────────────────────────────────────────
function bindSeg(sel, key) {
  const el = $(sel);
  const sync = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === ui[key]));
  sync();
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ui[key] = b.dataset.v;
    saveUi();
    sync();
    render();
  });
}
bindSeg('#platformFilter', 'platform');
bindSeg('#soundFilter', 'soundKind');
bindSeg('#langFilter', 'lang');
$('#sortBy').value = ui.sort;
$('#sortBy').addEventListener('change', (e) => { ui.sort = e.target.value; saveUi(); render(); });

async function triggerRefresh(source) {
  const r = await fetch(`/api/refresh/${source}`, { method: 'POST' }).then((r) => r.json()).catch(() => null);
  if (!r) return toast('Could not reach server');
  if (r.started?.length) toast(`Refreshing ${r.started.map((s) => LABEL[s]).join(', ')}…`);
  else toast('Already up to date. Paid sources can be refreshed manually every 2 min.');
}
$('#refreshAll').addEventListener('click', () => triggerRefresh('all'));
$('#status').addEventListener('click', (e) => {
  const b = e.target.closest('[data-refresh]');
  if (b) triggerRefresh(b.dataset.refresh);
});

$('#themeToggle').addEventListener('click', () => {
  const root = document.documentElement;
  const isDark = root.dataset.theme ? root.dataset.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
  root.dataset.theme = isDark ? 'light' : 'dark';
  ui.theme = root.dataset.theme;
  saveUi();
});

const player = $('#player');
$('#sounds').addEventListener('click', (e) => {
  const b = e.target.closest('[data-audio]');
  if (!b) return;
  if (player.dataset.src === b.dataset.audio && !player.paused) {
    player.pause();
    player.dataset.src = '';
  } else {
    player.src = b.dataset.audio;
    player.dataset.src = b.dataset.audio;
    player.play().catch(() => toast('Preview unavailable for this sound'));
  }
  renderSounds();
});
player.addEventListener('ended', () => { player.dataset.src = ''; renderSounds(); });

function tickClock() {
  $('#clock').textContent = new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date()) + ' MYT';
}
tickClock();
setInterval(tickClock, 1000);
// Keep "x min ago" and countdowns fresh between pushes.
setInterval(() => state && (renderStatus(), renderNews()), 15_000);

connect();
