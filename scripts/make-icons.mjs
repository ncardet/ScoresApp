#!/usr/bin/env node
// Render the app icon (SVG below) to the PNG sizes iOS and the manifest need.
// Requires Playwright + Chromium (dev only): node scripts/make-icons.mjs
import { writeFile } from 'node:fs/promises';
// Playwright is resolved globally via require (ESM imports ignore NODE_PATH).
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

// A "Great" rating badge: red-orange disc with a bold S, on near-black.
const svg = (size, pad = 0) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffb020"/><stop offset="0.55" stop-color="#ff5a2a"/><stop offset="1" stop-color="#ff2d3d"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="#0d0d10"/>
  <g transform="translate(${256 - (256 - pad)} ${256 - (256 - pad)}) scale(${(512 - 2 * pad) / 512})">
    <circle cx="256" cy="256" r="178" fill="url(#g)"/>
    <circle cx="256" cy="256" r="206" fill="none" stroke="#ff5a2a" stroke-opacity="0.35" stroke-width="12"/>
    <text x="256" y="262" text-anchor="middle" dominant-baseline="central" font-family="Helvetica, Arial, 'DejaVu Sans', sans-serif" font-weight="800" font-size="232" fill="#ffffff">S</text>
  </g>
</svg>`;

const targets = [
  ['site/icons/icon-512.png', 512, 0],
  ['site/icons/icon-192.png', 192, 0],
  ['site/icons/apple-touch-icon.png', 180, 0],
  ['site/icons/favicon-32.png', 32, 0],
  ['site/icons/icon-maskable-512.png', 512, 56], // keep the badge inside the 80% safe zone
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, size, pad] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(size, pad)}</body></html>`);
  await writeFile(file, await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', file);
}
await writeFile('site/icons/icon.svg', svg(512).trim());
await browser.close();
