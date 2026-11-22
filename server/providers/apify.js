import { config } from '../config.js';

const BASE = 'https://api.apify.com/v2';
const POLL_MS = 5_000;
const MAX_WAIT_MS = 10 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apifyToken}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (!res.ok) {
    let msg = body;
    try { msg = JSON.parse(body).error?.message || body; } catch {}
    throw new Error(`Apify ${res.status}: ${String(msg).slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : null;
}

/**
 * Start an Apify actor, wait for it to finish, and return its dataset items.
 * Uses start + poll rather than run-sync so long scrapes don't hit the 300s cap.
 */
export async function runActor(actorId, input, { maxItems = 500 } = {}) {
  if (!config.apifyToken) throw new Error('APIFY_TOKEN is not set');
  const id = actorId.replace('/', '~');
  const { data: run } = await api(`/acts/${id}/runs`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  const started = Date.now();
  let status = run.status;
  let datasetId = run.defaultDatasetId;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    if (Date.now() - started > MAX_WAIT_MS) {
      await api(`/actor-runs/${run.id}/abort`, { method: 'POST' }).catch(() => {});
      throw new Error(`${actorId} took longer than ${MAX_WAIT_MS / 60_000} min, aborted`);
    }
    await sleep(POLL_MS);
    const { data } = await api(`/actor-runs/${run.id}`);
    status = data.status;
    datasetId = data.defaultDatasetId;
  }
  if (status !== 'SUCCEEDED') throw new Error(`${actorId} run ${status}`);

  return api(`/datasets/${datasetId}/items?clean=true&limit=${maxItems}`);
}
