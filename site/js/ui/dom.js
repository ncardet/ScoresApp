// Tiny DOM helpers: h('div', {class: 'x', onclick}, ...children).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Parse an SVG/HTML string into a node. */
export function frag(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Replace an element's children (arrays are flattened, unlike Element.append). */
export function fill(el, ...children) {
  return append(clear(el), children);
}

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  today: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18"/><circle cx="12" cy="15" r="2.2" fill="currentColor" stroke="none"/>',
  standings: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>',
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  chevdown: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  pin: '<path d="M12 2.5a7 7 0 0 0-7 7c0 5.1 7 12.5 7 12.5s7-7.4 7-12.5a7 7 0 0 0-7-7zm0 9.6a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z" fill="currentColor" stroke="none"/>',
  tv: '<rect x="3" y="5.5" width="18" height="12.5" rx="2.5"/><path d="M8.5 21h7M12 18v3"/>',
};

/** Sport icons, keyed by the league `sport` field (core/leagues.js). Same 24px grid and round
 *  2-unit strokes as ICONS; small parts (pentagon, puck, checks) are solid so they read at 14px. */
export const SPORT_ICONS = {
  basketball: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6.4 4.95c2.4 3.1 2.4 11 0 14.1M17.6 4.95c-2.4 3.1-2.4 11 0 14.1"/>',
  football: '<path d="M3.8 20.2C2 10.6 10.6 2 20.2 3.8 22 13.4 13.4 22 3.8 20.2z"/><path d="M9 15l6-6M10.8 10.8l2.4 2.4M9.1 12.5l2.4 2.4M12.5 9.1l2.4 2.4"/>',
  baseball: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.7c2.7 2.9 2.7 9.7 0 12.6M18.4 5.7c-2.7 2.9-2.7 9.7 0 12.6"/><path stroke-width="1.6" d="M6.2 8.9l2-.7M6.6 12h2M6.2 15.1l2 .7M17.8 8.9l-2-.7M17.4 12h-2M17.8 15.1l-2 .7"/>',
  hockey: '<path stroke-width="2.5" d="M7 2.5l5.4 12.8c.6 1.5 1.7 2.7 3.6 2.7h4.5"/><ellipse cx="6.2" cy="18.6" rx="3.4" ry="2" fill="currentColor" stroke="none"/>',
  soccer: '<circle cx="12" cy="12" r="9"/><path d="M12 8.4l3.42 2.49-1.3 4.02H9.88l-1.3-4.02z" fill="currentColor"/>'
    + '<path d="M12 8.4V5.6M15.42 10.89l2.67-.87M14.12 14.91l1.64 2.27M9.88 14.91l-1.64 2.27M8.58 10.89l-2.67-.87"/>'
    + '<path fill="currentColor" d="M8.63 3.66a9 9 0 0 1 6.74 0L12 5.6zM18.89 6.21a9 9 0 0 1 2.09 6.42l-2.89-2.61zM19.63 16.77a9 9 0 0 1-5.45 3.96l1.58-3.55zM9.82 20.73a9 9 0 0 1-5.45-3.96l3.87.41zM3.02 12.63a9 9 0 0 1 2.09-6.42l.8 3.81z"/>',
  racing: '<path d="M5 21V3.5M5 4h14v9H5"/><path d="M5 4h3.5v3H5zM12 4h3.5v3H12zM8.5 7H12v3H8.5zM15.5 7H19v3h-3.5zM5 10h3.5v3H5zM12 10h3.5v3H12z" fill="currentColor" stroke="none"/>',
  tennis: '<ellipse cx="14.2" cy="9.8" rx="5.2" ry="6.6" transform="rotate(45 14.2 9.8)"/><path d="M10.4 13.6L4 20"/><path stroke-width="1.3" d="M11.6 8.1l4.3 4.3M13.9 5.8l4.3 4.3"/><circle cx="18.6" cy="18.6" r="2.3" fill="currentColor" stroke="none"/>',
  mma: '<path d="M8 14.5c-1.6-2-2.3-4.4-1.9-6.8C6.7 4.8 9.3 3 12.6 3c4.2 0 6.9 2.9 6.9 6.7 0 2.3-.9 3.6-2 4.8z" fill="currentColor"/><path d="M8.6 10.2c-2-.8-4 .3-4 2.2 0 1.4 1.2 2.1 3.4 2.1"/><rect x="8" y="14.5" width="9.5" height="6.5" rx="1.6"/>',
};

function svgIcon(inner, cls = '') {
  return frag(`<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`);
}

export function icon(name) {
  return svgIcon(ICONS[name] || '');
}

/** The sport's icon, to sit in front of a league name ("MCBB", "Premier League"). It takes the
 *  size and colour of the text around it (.sport-ic), and screen readers skip it: the name stays. */
export function sportIcon(sport) {
  return Object.hasOwn(SPORT_ICONS, sport) ? svgIcon(SPORT_ICONS[sport], 'sport-ic') : null;
}

export function logo(url, alt = '') {
  if (!url) return h('span', { class: 'logo-ph', 'aria-hidden': 'true' });
  const img = h('img', { src: url, alt, loading: 'lazy', decoding: 'async', width: 24, height: 24 });
  img.addEventListener('error', () => img.replaceWith(h('span', { class: 'logo-ph', 'aria-hidden': 'true' })), { once: true });
  return img;
}

/** Pick the logo variant that reads on the current theme (the app's setting, not just the OS). */
export function teamLogo(team) {
  const dark = document.documentElement.dataset.theme === 'dark';
  return (dark && team?.logoDark) || team?.logo || '';
}

/** A token's current value (e.g. cssVar('--wasabi')), for code that needs a concrete colour. */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function onTheme(fn) {
  window.addEventListener('sideline:theme', fn);
}
