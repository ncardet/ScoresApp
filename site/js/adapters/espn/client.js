// HTTP client for every external data call. Adds timeouts, retries, and an offline fallback:
// successful responses can be persisted, and when the network fails the last good copy is
// returned with `stale: true` so the UI can say "Couldn't reach ESPN; showing data from 10:42am".

import { kvGet, kvSet, kvKeys, kvDel } from '../../core/kv.js';

const status = { lastOk: 0, lastError: null, lastErrorAt: 0, offlineSince: 0 };
const listeners = new Set();

export function sourceStatus() {
  return { ...status };
}

export function onSourceStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try { fn(sourceStatus()); } catch { /* listener errors are not our problem */ }
  }
}

function markOk() {
  status.lastOk = Date.now();
  status.offlineSince = 0;
  emit();
}

function markError(err) {
  status.lastError = String(err?.message || err);
  status.lastErrorAt = Date.now();
  if (!status.offlineSince) status.offlineSince = Date.now();
  emit();
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url, timeout) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await fetch(url, { signal: ctrl?.signal });
    if (!res.ok) throw new HttpError(res.status, url);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fetch JSON.
 * @param {string} url
 * @param {{timeout?: number, retries?: number, persist?: boolean}} [opts]
 *   persist: keep the last good copy for offline fallback (IndexedDB in the browser).
 * @returns {Promise<{json: any, at: number, stale: boolean}>}
 */
export async function getJson(url, { timeout = 12000, retries = 1, persist = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const json = await fetchOnce(url, timeout);
      markOk();
      if (persist) {
        kvSet(`http:${url}`, { at: Date.now(), json }).catch(() => {});
      }
      return { json, at: Date.now(), stale: false };
    } catch (err) {
      lastErr = err;
      // 4xx (other than 429) will not get better by retrying.
      if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429) break;
      if (attempt < retries) await sleep(400 * 2 ** attempt + (err?.status === 429 ? 1500 : 0));
    }
  }
  const httpRefusal = lastErr instanceof HttpError && lastErr.status >= 400 && lastErr.status < 500 && lastErr.status !== 429;
  if (!httpRefusal) markError(lastErr);
  if (persist) {
    const cached = await kvGet(`http:${url}`).catch(() => null);
    if (cached?.json) return { json: cached.json, at: cached.at, stale: true, error: lastErr };
  }
  throw lastErr;
}

/** Convenience: JSON body only. */
export async function json(url, opts) {
  return (await getJson(url, opts)).json;
}

/** Drop persisted responses beyond the newest `keep` (called occasionally by the app). */
export async function prunePersisted(keep = 160) {
  const keys = await kvKeys('http:');
  if (keys.length <= keep) return;
  const entries = await Promise.all(keys.map(async (k) => [k, (await kvGet(k))?.at || 0]));
  entries.sort((a, b) => b[1] - a[1]);
  await Promise.all(entries.slice(keep).map(([k]) => kvDel(k)));
}

/** Run async tasks with a concurrency limit, preserving order of results. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (err) {
        out[idx] = { error: err };
      }
    }
  });
  await Promise.all(workers);
  return out;
}
