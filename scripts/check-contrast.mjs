#!/usr/bin/env node
// WCAG contrast check for the design tokens in site/css/tokens.css, in both modes.
// Body text needs 4.5:1; large text, badge numbers and icons need 3:1. Exits 1 on any failure.
//
//   node scripts/check-contrast.mjs            # report
//   node scripts/check-contrast.mjs --suggest  # also print the smallest lightness nudge that passes
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKENS = fileURLToPath(new URL('../site/css/tokens.css', import.meta.url));

// [foreground, background, minimum ratio, what it is]
export const PAIRS = [
  ['--text', '--bg', 4.5, 'primary text on page'],
  ['--text', '--surface', 4.5, 'primary text, scores on cards'],
  ['--text', '--surface-2', 4.5, 'chip labels, nested panels'],
  ['--text-2', '--bg', 4.5, 'secondary text on page'],
  ['--text-2', '--surface', 4.5, 'times, league labels on cards'],
  ['--text-2', '--surface-2', 4.5, 'chip counts'],
  ['--text-3', '--bg', 4.5, 'captions on page'],
  ['--text-3', '--surface', 4.5, 'captions, timestamps on cards'],
  ['--on-wasabi', '--wasabi', 4.5, 'header, selected chip, active tab, primary button'],
  ['--wasabi-ink', '--bg', 4.5, 'links on page'],
  ['--wasabi-ink', '--surface', 4.5, 'links, favorite star on cards'],
  ['--on-accent', '--accent', 4.5, 'text on a salmon chip'],
  ['--accent', '--surface', 3, 'live dot, circle icon'],
  ['--accent', '--bg', 3, 'live dot on page'],
  ['--focus', '--bg', 3, 'focus ring on page'],
  ['--focus', '--surface', 3, 'focus ring on cards'],
  ['--dull-ink', '--dull', 3, 'Dull badge number (large, bold)'],
  ['--ok-ink', '--ok', 3, 'OK badge number (large, bold)'],
  ['--good-ink', '--good', 3, 'Good badge number (large, bold)'],
  ['--great-ink', '--great', 3, 'Great badge number (large, bold)'],
];

/** { light: {name: value}, dark: {...} } with var() references resolved. */
export function readTokens(css = readFileSync(TOKENS, 'utf8')) {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, body]) => ({
    sel: sel.trim(),
    vars: Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()])),
  }));
  const pick = (test) => Object.assign({}, ...blocks.filter((b) => test(b.sel)).map((b) => b.vars));
  const shared = pick((s) => s === ':root');
  const light = { ...shared, ...pick((s) => s.includes('data-theme="light"')) };
  const dark = { ...shared, ...pick((s) => s.includes('data-theme="dark"')) };
  const resolve = (vars) => {
    const out = {};
    const get = (k, depth = 0) => {
      const v = vars[k];
      if (v == null || depth > 8) return null;
      const m = /^var\((--[\w-]+)\)$/.exec(v);
      return m ? get(m[1], depth + 1) : v;
    };
    for (const k of Object.keys(vars)) out[k] = get(k);
    return out;
  };
  return { light: resolve(light), dark: resolve(dark) };
}

export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex || '');
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function lum([r, g, b]) {
  const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a, b) {
  const [l1, l2] = [lum(hexToRgb(a)), lum(hexToRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Every pair in both modes: [{mode, fg, bg, ratio, min, ok, what}]. */
export function contrastReport(tokens = readTokens()) {
  const rows = [];
  for (const mode of ['light', 'dark']) {
    const t = tokens[mode];
    for (const [fg, bg, min, what] of PAIRS) {
      const ratio = contrast(t[fg], t[bg]);
      rows.push({ mode, fg, bg, fgValue: t[fg], bgValue: t[bg], ratio, min, ok: ratio >= min, what });
    }
  }
  return rows;
}

// ---- suggestions: the smallest OKLCH lightness change that passes (hue and chroma kept) ----
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function toOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
function fromOklch([L, C, H]) {
  for (let c = C; c >= 0; c -= 0.002) {
    const A = c * Math.cos(H); const B = c * Math.sin(H);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    if (rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) {
      return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    }
  }
  return null;
}
export function nudge(hex, others, min, { target = 'fg' } = {}) {
  const [L, C, H] = toOklch(hex);
  for (let step = 0.002; step <= 0.6; step += 0.002) {
    for (const dir of [-1, 1]) {
      const l = Math.min(1, Math.max(0, L + dir * step));
      const cand = fromOklch([l, C, H]);
      if (cand && others.every((o) => contrast(cand, o) >= min)) return { value: cand, from: hex, dl: dir * step, target };
    }
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = contrastReport();
  const pad = (s, n) => String(s).padEnd(n);
  for (const mode of ['light', 'dark']) {
    console.log(`\n${mode.toUpperCase()}`);
    for (const r of rows.filter((x) => x.mode === mode)) {
      console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${pad(`${r.fg} on ${r.bg}`, 30)} ${pad(`${r.fgValue} / ${r.bgValue}`, 20)} ${r.ratio.toFixed(2).padStart(5)}:1 (min ${r.min})  ${r.what}`);
    }
  }
  const fails = rows.filter((r) => !r.ok);
  if (process.argv.includes('--suggest') && fails.length) {
    const tokens = readTokens();
    console.log('\nSuggested nudges (foreground lightness, all of its pairs in that mode):');
    for (const key of [...new Set(fails.map((f) => `${f.mode}|${f.fg}`))]) {
      const [mode, fg] = key.split('|');
      const mine = rows.filter((r) => r.mode === mode && r.fg === fg);
      const min = Math.max(...mine.map((r) => r.min));
      const s = nudge(tokens[mode][fg], mine.map((r) => r.bgValue), min);
      if (s) { console.log(`  ${mode} ${fg}: ${tokens[mode][fg]} -> ${s.value} (lightness ${s.dl > 0 ? '+' : ''}${(s.dl * 100).toFixed(1)}%)`); continue; }
      // The text can't move far enough (e.g. white on a fill): nudge the fill instead, keeping
      // every pair that fill is part of.
      for (const f of fails.filter((x) => x.mode === mode && x.fg === fg)) {
        const fillPairs = rows.filter((r) => r.mode === mode && (r.bg === f.bg || r.fg === f.bg));
        const others = fillPairs.map((r) => (r.bg === f.bg ? r.fgValue : r.bgValue));
        const need = Math.max(...fillPairs.map((r) => r.min));
        const b = nudge(tokens[mode][f.bg], others.slice(0, 1), need);
        const ok = b && fillPairs.every((r) => contrast(b.value, r.bg === f.bg ? r.fgValue : r.bgValue) >= r.min);
        console.log(`  ${mode} ${fg} on ${f.bg}: text can't move; ${f.bg} ${tokens[mode][f.bg]} -> ${b ? `${b.value} (lightness ${(b.dl * 100).toFixed(1)}%)${ok ? '' : ' (breaks another pair)'}` : 'no nudge'}`);
      }
    }
  }
  console.log(fails.length ? `\n${fails.length} pair(s) below the minimum.` : '\nAll pairs pass.');
  process.exitCode = fails.length ? 1 : 0;
}
