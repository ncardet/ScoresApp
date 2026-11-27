#!/usr/bin/env node
// Theme screenshots: Today, Look Ahead, a game page, Standings and Settings, in light and dark.
// Needs the dev server (npm run dev) and Playwright + Chromium (dev only).
//
//   node scripts/screenshots.mjs before     # -> docs/screenshots/theme/before-<screen>-<mode>.png
//   node scripts/screenshots.mjs after
//
// ESPN's CDN refuses headless Chrome, so API calls and team logos are fetched by Node and handed
// to the page. The theme is forced through the app's own setting (localStorage sideline.theme),
// falling back to the emulated system setting for builds that don't have one.
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const label = process.argv[2] || 'after';
const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = process.env.OUT || 'docs/screenshots/theme';
const SCREENS = process.env.SCREENS
  ? process.env.SCREENS.split(',').map((x) => x.split('='))   // e.g. SCREENS="past=#/day/2026-11-25"
  : [
    ['today', '#/day/2026-11-28'],
    ['look-ahead', '#/ahead'],
    ['game', '#/game/cfb/401858543'],
    ['standings', '#/standings/nfl'],
    ['settings', '#/settings'],
  ];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
for (const mode of ['light', 'dark']) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], deviceScaleFactor: 2, colorScheme: mode, serviceWorkers: 'block' });
  await ctx.addInitScript((m) => { try { localStorage.setItem('sideline.theme', m); } catch { /* ignore */ } }, mode);
  await ctx.route(/https:\/\/([a-z0-9-]+\.)*(espn\.com|espncdn\.com|openf1\.org)\//, async (route) => {
    try {
      const res = await fetch(route.request().url());
      const body = Buffer.from(await res.arrayBuffer());
      await route.fulfill({ status: res.status, body, headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'access-control-allow-origin': '*' } });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  const page = await ctx.newPage();
  for (const [name, hash] of SCREENS) {
    await page.goto(`${BASE}${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(name === 'settings' ? 2500 : 8000);
    await page.evaluate((y) => window.scrollTo(0, y), +(process.env.SCROLL || 0));
    if (process.env.SHEET) { await page.click('.rating-card'); await page.waitForTimeout(700); }
    const file = `${OUT}/${label}-${name}-${mode}.png`;
    await page.screenshot({ path: file });
    console.log('wrote', file);
  }
  await ctx.close();
}
await browser.close();
