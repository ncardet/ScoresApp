// Theme: System / Light / Dark. The choice is stored in localStorage under `sideline.theme`
// (default `system`); the resolved mode is `data-theme` on <html>, which selects the tokens in
// css/tokens.css. With `system`, the app follows prefers-color-scheme and switches live when the
// phone flips (at sunset, say). An inline script in index.html does the first resolution before
// any CSS paints, so there is never a flash of the wrong theme.

export const THEME_KEY = 'sideline.theme';
export const THEMES = ['system', 'light', 'dark'];
const QUERY = '(prefers-color-scheme: dark)';

/** The stored choice, or `system`. Never throws (private mode, blocked storage). */
export function readTheme(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(choice, storage = globalThis.localStorage) {
  try { storage?.setItem(THEME_KEY, choice); } catch { /* storage unavailable: still applies this session */ }
}

/** `light` or `dark` for a choice, given the system media query (or its `matches`). */
export function resolveTheme(choice, systemDark) {
  if (choice === 'light' || choice === 'dark') return choice;
  const dark = typeof systemDark === 'object' ? !!systemDark?.matches : !!systemDark;
  return dark ? 'dark' : 'light';
}

/** Browser and PWA chrome: the header colour (wasabi), read from the tokens. */
function updateChrome(doc) {
  const meta = doc.querySelector?.('meta[name="theme-color"]');
  if (!meta) return;
  const css = doc.defaultView?.getComputedStyle?.(doc.documentElement);
  const wasabi = css?.getPropertyValue('--wasabi').trim();
  const bg = css?.getPropertyValue('--bg').trim();
  const color = wasabi || bg;
  if (color) meta.setAttribute('content', color);
}

let state = null;

/**
 * Resolve and apply the theme, and follow the system setting while the choice is `system`.
 * Fires a `sideline:theme` event on window whenever the resolved mode changes.
 */
export function initTheme(win = globalThis.window) {
  const doc = win.document;
  const mql = win.matchMedia?.(QUERY) || null;
  state = { win, doc, mql, mode: null };
  const apply = () => {
    const mode = resolveTheme(readTheme(win.localStorage), mql);
    const changed = doc.documentElement.dataset.theme !== mode;
    doc.documentElement.dataset.theme = mode;
    updateChrome(doc);
    if (changed && state.mode !== null) win.dispatchEvent(new win.CustomEvent('sideline:theme', { detail: { mode } }));
    state.mode = mode;
  };
  state.apply = apply;
  const onSystem = () => { if (readTheme(win.localStorage) === 'system') apply(); };
  if (mql?.addEventListener) mql.addEventListener('change', onSystem);
  else mql?.addListener?.(onSystem);
  apply();
  return state;
}

/** Change the setting (System / Light / Dark), persist it and apply it now. */
export function setTheme(choice) {
  if (!THEMES.includes(choice)) return;
  saveTheme(choice, state?.win?.localStorage);
  state?.apply?.();
}

export function currentMode(doc = globalThis.document) {
  return doc?.documentElement?.dataset?.theme === 'dark' ? 'dark' : 'light';
}
