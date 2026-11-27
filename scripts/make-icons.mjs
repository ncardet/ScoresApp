#!/usr/bin/env node
// Render the app icons and iPhone launch screens from the design tokens (site/css/tokens.css).
// The mark is the header's brand badge: a paper disc with a nori ring around a wasabi disc with a
// heavy nori "S". Icons put it on wasabi with faint diagonal stripes (like the posters); launch
// screens put it on nori. Writes site/icons/* and prints the <link> tags index.html uses.
// Requires Playwright + Chromium (dev only): npm run icons
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { readTokens } from './check-contrast.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const { light, dark } = readTokens();
const WASABI = light['--wasabi'];
const NORI = light['--nori'];
const PAPER = light['--paper'];
const NORI_BG = dark['--bg'];

// The badge in a 512 box.
const badge = `
    <circle cx="256" cy="256" r="190" fill="${PAPER}" stroke="${NORI}" stroke-width="20"/>
    <circle cx="256" cy="256" r="134" fill="${WASABI}" stroke="${NORI}" stroke-width="17"/>
    <text x="256" y="268" text-anchor="middle" dominant-baseline="central" font-family="'Inter Display', Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="190" fill="${NORI}">S</text>`;

// `pad` is in 512ths of the icon: the maskable icon keeps the badge inside the 80% safe zone.
const iconSvg = (size, pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <pattern id="st" width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(25)">
      <rect width="6" height="44" fill="${PAPER}" fill-opacity="0.08"/>
    </pattern>
  </defs>
  <rect width="512" height="512" fill="${WASABI}"/>
  <rect width="512" height="512" fill="url(#st)"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">${badge}</g>
</svg>`;

const splashSvg = (w, h) => {
  const s = Math.round(Math.min(w, h) * 0.36);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${NORI_BG}"/>
  <g transform="translate(${(w - s) / 2} ${(h - s) / 2}) scale(${s / 512})">${badge}</g></svg>`;
};

const icons = [
  ['site/icons/icon-512.png', 512, 0],
  ['site/icons/icon-192.png', 192, 0],
  ['site/icons/apple-touch-icon.png', 180, 0],
  ['site/icons/favicon-32.png', 32, 0],
  ['site/icons/icon-maskable-512.png', 512, 60],
];
// iPhone launch screens: [css width, css height, pixel ratio]
export const SPLASHES = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [390, 844, 3],
  [375, 812, 3], [360, 780, 3], [414, 896, 2], [375, 667, 2],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const shoot = async (file, w, h, svg) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await writeFile(file, await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }));
  console.log('wrote', file);
};
for (const [file, size, pad] of icons) await shoot(file, size, size, iconSvg(size, pad));
await writeFile('site/icons/icon.svg', iconSvg(512).trim());
const links = [];
for (const [w, h, dpr] of SPLASHES) {
  const file = `icons/splash-${w * dpr}x${h * dpr}.png`;
  await shoot(`site/${file}`, w * dpr, h * dpr, splashSvg(w * dpr, h * dpr));
  links.push(`  <link rel="apple-touch-startup-image" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" href="${file}">`);
}
await browser.close();
console.log(`\n${links.join('\n')}`);
