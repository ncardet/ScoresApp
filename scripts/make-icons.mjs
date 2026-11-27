#!/usr/bin/env node
// Render the app icons and iPhone splash screens from the design tokens (site/css/tokens.css):
// the "S" ring mark in --on-wasabi on --wasabi for icons, and in --wasabi on the dark --bg (nori)
// for splash screens. Writes site/icons/* and prints the <link> tags index.html uses.
// Requires Playwright + Chromium (dev only): node scripts/make-icons.mjs
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { readTokens } from './check-contrast.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const { light, dark } = readTokens();
const WASABI = light['--wasabi'];
const ON_WASABI = light['--on-wasabi'];
const NORI = dark['--bg'];

// The header's ring mark, scaled to a box of `size` with `pad` around it.
const mark = (size, pad, fg) => {
  const r = (size - 2 * pad) / 2;
  const c = size / 2;
  return `<circle cx="${c}" cy="${c}" r="${r * 0.86}" fill="none" stroke="${fg}" stroke-width="${r * 0.14}"/>
    <text x="${c}" y="${c + r * 0.06}" text-anchor="middle" dominant-baseline="central" font-family="'Inter Display', Inter, Helvetica, Arial, sans-serif" font-weight="800" font-size="${r * 1.0}" fill="${fg}">S</text>`;
};
const iconSvg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${WASABI}"/>${mark(size, pad, ON_WASABI)}</svg>`;
const splashSvg = (w, h) => {
  const s = Math.round(Math.min(w, h) * 0.28);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${NORI}"/>
  <g transform="translate(${(w - s) / 2} ${(h - s) / 2})">${mark(s, 0, WASABI)}</g></svg>`;
};

const icons = [
  ['site/icons/icon-512.png', 512, 60],
  ['site/icons/icon-192.png', 192, 22],
  ['site/icons/apple-touch-icon.png', 180, 22],
  ['site/icons/favicon-32.png', 32, 2],
  ['site/icons/icon-maskable-512.png', 512, 110], // keep the mark inside the 80% safe zone
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
await writeFile('site/icons/icon.svg', iconSvg(512, 60).trim());
const links = [];
for (const [w, h, dpr] of SPLASHES) {
  const file = `icons/splash-${w * dpr}x${h * dpr}.png`;
  await shoot(`site/${file}`, w * dpr, h * dpr, splashSvg(w * dpr, h * dpr));
  links.push(`  <link rel="apple-touch-startup-image" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" href="${file}">`);
}
await browser.close();
console.log(`\n${links.join('\n')}`);
