// The scoreboard app icon (assets/icon, built by `npm run icons`): the shipped files exist at the
// right sizes, carry no <text> (no font needed to draw them), and use only Wasabi and Nori colours.
// These tests only read files; building the icons needs the dev dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readTokens } from '../scripts/check-contrast.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(`${ROOT}/${p}`);
const noQuery = (u) => u.replace(/[?#].*$/, '');

function png(buf) {
  assert.equal(buf.toString('hex', 0, 8), '89504e470d0a1a0a', 'PNG signature');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colourType: buf[25] };
}

const OUTLINED = [
  'site/icons/favicon.svg',
  ...readdirSync(`${ROOT}/assets/icon`).filter((f) => f.endsWith('-outlined.svg')).map((f) => `assets/icon/${f}`),
];

test('shipped icon SVGs are outlined: no <text>, so no font is needed to draw them', () => {
  assert.equal(OUTLINED.length, 4, 'favicon.svg and three outlined masters');
  for (const f of [...OUTLINED, 'site/js/ui/brand-mark.js']) {
    const s = read(f).toString();
    assert.doesNotMatch(s, /<text\b/, f);
    assert.doesNotMatch(s, /NaN|undefined|Infinity/, f);
  }
});

test('icon colours are Wasabi and Nori tokens', () => {
  const { light, dark } = readTokens();
  const palette = new Set([...Object.values(light), ...Object.values(dark)].filter(Boolean).map((v) => v.toUpperCase()));
  for (const f of OUTLINED) {
    for (const [hex] of read(f).toString().matchAll(/#[0-9a-f]{6}\b/gi)) assert.ok(palette.has(hex.toUpperCase()), `${f}: ${hex}`);
  }
});

test('manifest: "any" and "maskable" icons at 192 and 512, each file the size it claims', () => {
  const m = JSON.parse(read('site/manifest.webmanifest'));
  assert.equal(m.theme_color, '#A3C14A');
  assert.equal(m.background_color, '#0F1F1C');
  const sizes = (purpose) => m.icons.filter((i) => i.purpose === purpose).map((i) => i.sizes).sort();
  assert.deepEqual(sizes('any'), ['192x192', '512x512']);
  assert.deepEqual(sizes('maskable'), ['192x192', '512x512']);
  for (const i of m.icons) {
    assert.equal(i.type, 'image/png');
    assert.doesNotMatch(i.src, /^\//, `${i.src}: relative, for the GitHub Pages project path`);
    const { width, height } = png(read(`site/${noQuery(i.src)}`));
    assert.equal(`${width}x${height}`, i.sizes, i.src);
  }
});

test('apple-touch-icon is 180x180 with no alpha channel', () => {
  const p = png(read('site/icons/apple-touch-icon.png'));
  assert.deepEqual([p.width, p.height], [180, 180]);
  assert.equal(p.colourType, 2, 'RGB without alpha');
});

test('favicon.ico holds 16, 32 and 48 px images', () => {
  const ico = read('site/favicon.ico');
  assert.equal(ico.readUInt16LE(2), 1, 'icon resource');
  const entries = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const o = 6 + 16 * i;
    const data = ico.subarray(ico.readUInt32LE(o + 12), ico.readUInt32LE(o + 12) + ico.readUInt32LE(o + 8));
    return { size: ico[o], png: png(data) };
  });
  assert.deepEqual(entries.map((e) => e.size).sort((a, b) => a - b), [16, 32, 48]);
  for (const e of entries) assert.deepEqual([e.png.width, e.png.height], [e.size, e.size]);
});

test('index.html links the SVG and ICO favicons, touch icon and manifest by relative paths that exist', () => {
  const html = read('site/index.html').toString();
  const links = [...html.matchAll(/<link rel="(icon|apple-touch-icon|manifest)" href="([^"]+)"/g)].map(([, rel, href]) => ({ rel, href }));
  assert.deepEqual(links.map((l) => l.rel).sort(), ['apple-touch-icon', 'icon', 'icon', 'manifest']);
  for (const { href } of links) {
    assert.doesNotMatch(href, /^\//, `${href}: relative, for the GitHub Pages project path`);
    assert.ok(existsSync(`${ROOT}/site/${noQuery(href)}`), href);
  }
  assert.match(html, /<link rel="icon" href="icons\/favicon\.svg\?v=\d+" type="image\/svg\+xml">/);
});

test('the header shows the brand mark: token colours, straight on the bar (no tile or outline)', () => {
  assert.match(read('site/js/ui/components.js').toString(), /BRAND_MARK/);
  const mark = read('site/js/ui/brand-mark.js').toString();
  assert.match(mark, /var\(--nori\)/);
  assert.match(mark, /var\(--rice\)/);
  assert.doesNotMatch(mark, /--wasabi|--on-wasabi/, 'no tile or outline behind the mark');
  assert.doesNotMatch(mark, /#[0-9a-f]{3,8}\b/i);
});
