// Colour discipline: one set of design tokens (site/css/tokens.css) drives every colour.
//   - The spec's tokens exist in both modes, and the excitement bands match the spec.
//   - Every text/background pair meets WCAG contrast (scripts/check-contrast.mjs).
//   - No hex, rgb() or hsl() literal appears in shipped code outside tokens.css. Team colours
//     come from ESPN data at runtime, so they never appear as literals.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTokens, contrastReport } from '../scripts/check-contrast.mjs';

const SITE = fileURLToPath(new URL('../site/', import.meta.url));

const SPEC_TOKENS = ['--bg', '--surface', '--surface-2', '--border', '--text', '--text-2', '--text-3',
  '--wasabi', '--on-wasabi', '--wasabi-ink', '--accent', '--on-accent', '--focus'];

test('every spec token is defined in both light and dark', () => {
  const t = readTokens();
  for (const mode of ['light', 'dark']) {
    for (const k of SPEC_TOKENS) assert.match(t[mode][k] || '', /^#[0-9a-f]{6}$/i, `${mode} ${k}`);
  }
  // Values the spec fixes outright (the contrast nudges are documented in DECISIONS.md).
  assert.equal(t.light['--wasabi'], '#A3C14A');
  assert.equal(t.dark['--wasabi'], '#A3C14A');
  assert.equal(t.light['--on-wasabi'], '#1B230A');
  assert.equal(t.dark['--bg'], '#0F1F1C');
  assert.equal(t.light['--bg'], '#F5F2E8');
});

test('excitement band colours match the spec in both modes', () => {
  const t = readTokens();
  const bands = { '--dull': '#7F918B', '--dull-ink': '#14201D', '--ok': '#E3C75A', '--ok-ink': '#3A2F07', '--good': '#F2A65A', '--good-ink': '#3D2205', '--great': '#EE5D45', '--great-ink': '#2E0A04' };
  for (const mode of ['light', 'dark']) for (const [k, v] of Object.entries(bands)) assert.equal(t[mode][k], v, `${mode} ${k}`);
  // Wasabi is never a rating colour.
  for (const b of ['--dull', '--ok', '--good', '--great']) assert.notEqual(t.light[b], t.light['--wasabi']);
});

test('design tokens meet WCAG contrast (4.5:1 text, 3:1 large text and icons)', () => {
  const fails = contrastReport().filter((r) => !r.ok);
  assert.equal(fails.length, 0, fails.map((f) => `${f.mode} ${f.fg} on ${f.bg}: ${f.ratio.toFixed(2)}:1 < ${f.min}:1`).join('\n'));
});

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('no colour literals outside tokens.css', () => {
  const LITERAL = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b|\brgba?\(|\bhsla?\(/;
  // The browser needs a theme colour before any CSS loads; js/core/theme.js then sets it from the tokens.
  const ALLOWED = [/^\s*<meta name="theme-color" content="#[0-9A-Fa-f]{6}">\s*$/];
  const offenders = [];
  for (const file of walk(SITE)) {
    const rel = relative(SITE, file);
    if (!/\.(js|css|html)$/.test(rel) || rel === 'css/tokens.css' || rel === 'sw.js') continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (LITERAL.test(line) && !ALLOWED.some((a) => a.test(line))) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, []);
});
