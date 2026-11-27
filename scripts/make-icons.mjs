#!/usr/bin/env node
// Render the app icon (SVG below) to the PNG sizes iOS and the manifest need.
// Requires Playwright + Chromium (dev only): node scripts/make-icons.mjs
import { writeFile } from 'node:fs/promises';
// Playwright is resolved globally via require (ESM imports ignore NODE_PATH).
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

// The brand badge (as in the app's header): a double-ring mint disc with a heavy "S",
// on the cobalt brand colour with faint diagonal stripes.
const svg = (size, pad = 0) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <pattern id="st" width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(25)">
      <rect width="6" height="44" fill="#ffffff" fill-opacity="0.07"/>
    </pattern>
  </defs>
  <rect width="512" height="512" fill="#2747e6"/>
  <rect width="512" height="512" fill="url(#st)"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
    <circle cx="256" cy="256" r="190" fill="#ffffff" stroke="#111214" stroke-width="20"/>
    <circle cx="256" cy="256" r="134" fill="#46dfb1" stroke="#111214" stroke-width="17"/>
    <text x="256" y="268" text-anchor="middle" dominant-baseline="central" font-family="'Inter Display', Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="190" fill="#111214">S</text>
  </g>
</svg>`;

const targets = [
  ['site/icons/icon-512.png', 512, 0],
  ['site/icons/icon-192.png', 192, 0],
  ['site/icons/apple-touch-icon.png', 180, 0],
  ['site/icons/favicon-32.png', 32, 0],
  ['site/icons/icon-maskable-512.png', 512, 60], // keep the badge inside the 80% safe zone
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
