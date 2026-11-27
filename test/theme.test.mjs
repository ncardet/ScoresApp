// Theme setting: System / Light / Dark persists across reloads, and System follows an emulated
// prefers-color-scheme change live. Unit tests run everywhere; the browser test runs where
// Playwright + Chromium are installed (skipped in CI, which has no browser).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTheme, resolveTheme, initTheme, setTheme, THEME_KEY } from '../site/js/core/theme.js';

// ---------- a fake browser window: storage, matchMedia, document ----------
function fakeWindow({ dark = false, stored = null, brokenStorage = false } = {}) {
  const store = new Map(stored ? [[THEME_KEY, stored]] : []);
  const storage = brokenStorage
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const listeners = new Set();
  const mql = { matches: dark, addEventListener: (t, fn) => listeners.add(fn) };
  const meta = { content: '', setAttribute(k, v) { this[k] = v; } };
  const events = [];
  const win = {
    localStorage: storage,
    matchMedia: () => mql,
    document: {
      documentElement: { dataset: {} },
      querySelector: (sel) => (sel.includes('theme-color') ? meta : null),
      defaultView: null,
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    dispatchEvent: (e) => events.push(e),
    flip(next) { mql.matches = next; for (const fn of listeners) fn({ matches: next }); },
    store, meta, events,
  };
  win.document.defaultView = { getComputedStyle: () => ({ getPropertyValue: (n) => (n === '--wasabi' ? ' #A3C14A' : '') }) };
  return win;
}
const mode = (win) => win.document.documentElement.dataset.theme;

test('resolves System from the OS setting, and Light/Dark regardless of it', () => {
  assert.equal(resolveTheme('system', { matches: true }), 'dark');
  assert.equal(resolveTheme('system', { matches: false }), 'light');
  assert.equal(resolveTheme('light', { matches: true }), 'light');
  assert.equal(resolveTheme('dark', { matches: false }), 'dark');
  assert.equal(readTheme({ getItem: () => 'bogus' }), 'system', 'unknown values fall back to system');
});

test('System is the default and follows the phone live', () => {
  const win = fakeWindow({ dark: false });
  initTheme(win);
  assert.equal(readTheme(win.localStorage), 'system');
  assert.equal(mode(win), 'light');
  win.flip(true);
  assert.equal(mode(win), 'dark', 'sunset: the app switches with the phone');
  assert.equal(win.events.at(-1)?.type, 'sideline:theme');
  win.flip(false);
  assert.equal(mode(win), 'light');
  assert.equal(win.meta.content, '#A3C14A', 'header colour for the browser chrome');
});

test('Light/Dark persist across a reload and ignore the OS', () => {
  const win = fakeWindow({ dark: false });
  initTheme(win);
  setTheme('dark');
  assert.equal(win.store.get(THEME_KEY), 'dark');
  assert.equal(mode(win), 'dark');
  win.flip(false);
  assert.equal(mode(win), 'dark', 'a fixed choice ignores the OS');
  // "Reload": a fresh window over the same storage.
  const again = fakeWindow({ dark: false, stored: win.store.get(THEME_KEY) });
  initTheme(again);
  assert.equal(mode(again), 'dark');
  setTheme('system');
  assert.equal(mode(again), 'light', 'back to following the phone');
});

test('blocked storage falls back to System without throwing', () => {
  const win = fakeWindow({ dark: true, brokenStorage: true });
  initTheme(win);
  assert.equal(mode(win), 'dark');
  assert.doesNotThrow(() => setTheme('light'));
});

// ---------- in a real browser (optional) ----------
let playwright = null;
try { playwright = createRequire(import.meta.url)('playwright'); } catch { /* not installed (CI) */ }

const SITE = fileURLToPath(new URL('../site/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serveSite() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(SITE, path.endsWith('/') ? `${path}index.html` : path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || (path.endsWith('/') ? 'text/html' : 'application/octet-stream') });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('in the browser: the setting persists across reloads with no flash, and System follows the OS', { skip: !playwright && 'Playwright not installed' }, async (t) => {
  let browser;
  try { browser = await playwright.chromium.launch(); } catch { t.skip('Chromium not installed'); return; }
  const server = await serveSite();
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    const ctx = await browser.newContext({ colorScheme: 'light', serviceWorkers: 'block' });
    // Record every data-theme value from the very first one, and whether <body> existed yet (to
    // catch a flash of the wrong theme). <html> doesn't exist when init scripts run, so watch the
    // whole document.
    await ctx.addInitScript(() => {
      window.__themes = [];
      new MutationObserver((records) => records.forEach((r, i) => {
        const value = i + 1 < records.length ? records[i + 1].oldValue : r.target.getAttribute('data-theme');
        window.__themes.push({ value, beforeBody: !document.body });
      })).observe(document, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-theme'] });
    });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await ctx.newPage();
    await page.goto(`${base}#/settings`);
    await page.waitForSelector('[data-theme-choice="dark"]');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light', 'system + light OS');

    await page.click('[data-theme-choice="dark"]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.reload();
    await page.waitForSelector('[data-theme-choice="dark"][aria-pressed="true"]');
    const seen = await page.evaluate(() => window.__themes);
    assert.ok(seen.length > 0, 'data-theme was set');
    assert.equal(seen[0].beforeBody, true, 'set in <head>, before anything is painted');
    assert.deepEqual([...new Set(seen.map((s) => s.value))], ['dark'], 'dark from the first paint after reload, never light');

    await page.click('[data-theme-choice="system"]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    assert.equal(await page.evaluate(() => localStorage.getItem('sideline.theme')), 'system');
  } finally {
    await browser.close();
    server.close();
  }
});
