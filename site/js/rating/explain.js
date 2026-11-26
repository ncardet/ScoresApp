// Plain-English reasons built from the components that drove a rating.
// Example: "3 lead changes, 2 in the 4th quarter · 4th quarter within one possession · Overtime"

import { LEAGUE_BY_KEY } from '../core/leagues.js';

const LATE = {
  nfl: '4th quarter', cfb: '4th quarter', nba: '4th quarter', wcbb: '4th quarter',
  mcbb: 'final 8 minutes', nhl: '3rd period', mlb: 'last 2 innings',
};
const ONE_SCORE = {
  football: 'one score', basketball: 'one possession', hockey: 'a goal', soccer: 'a goal', baseball: '2 runs',
};
const UNIT = { football: 'points', basketball: 'points', hockey: 'goals', soccer: 'goals', baseball: 'runs' };

function latePhrase(league) {
  const lg = LEAGUE_BY_KEY[league];
  return LATE[league] || (lg.sport === 'soccer' ? 'final 20 minutes' : 'closing stretch');
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * @param {object} m   measurements from components.js
 * @param {object} norm normalised components
 * @param {object} weights component weights
 * @param {object} ctx {game, league, sport, final, live, context}
 * @returns {{text: string, tone: '+'|'-', score: number}[]}
 */
export function inGameReasons(m, norm, weights, ctx) {
  const { league, sport, final } = ctx;
  const out = [];
  const push = (key, text, tone = '+', boost = 0) => {
    if (!text) return;
    const score = (weights[key] || 0.1) * (tone === '+' ? (norm[key] ?? 0.5) : 1 - (norm[key] ?? 0.5)) + boost;
    out.push({ key, text, tone, score });
  };

  // Novelty first: these are the most concrete facts.
  for (const f of m.novelty.flags) push('novelty', f.label, '+', 0.3 + f.weight * 0.2);

  // Lead changes.
  const lc = m.leadChanges;
  if (lc.changes + lc.ties > 0) {
    let text = lc.changes ? plural(lc.changes, 'lead change') : '';
    if (lc.ties) text += `${text ? ' and ' : ''}${plural(lc.ties, 'tie')}`;
    if (lc.late && final) text += `, ${lc.late} in the ${latePhrase(league)}`;
    push('leadChanges', cap(text), '+', lc.late ? 0.05 : 0);
  } else if (final && m.scores > 1) {
    push('leadChanges', 'Never a lead change', '-');
  }

  // Closeness.
  const c = norm.closeness;
  if (final) {
    if (c >= 0.85) push('closeness', `${cap(latePhrase(league))} within ${ONE_SCORE[sport] || 'one score'}`);
    else if (c >= 0.5) push('closeness', `Close for much of the ${latePhrase(league)}`);
    else if (c <= 0.1) push('closeness', `Decided before the ${latePhrase(league)}`, '-');
  } else if (ctx.live) {
    if (m.marginNow === 0) push('closeness', 'Tied right now', '+', 0.05);
    else if (c >= 0.8) push('closeness', `Within ${ONE_SCORE[sport] || 'one score'} right now`);
    else if (c <= 0.1) push('closeness', 'Lopsided so far', '-');
  }

  // Swing.
  if (norm.swing >= 0.85) push('swing', 'Wild momentum swings');
  else if (norm.swing >= 0.65) push('swing', 'Big momentum swings');
  else if (norm.swing <= 0.2 && final) push('swing', 'Few momentum swings', '-');

  // Comeback (skip if a novelty flag already says it).
  const cb = m.comeback;
  if (norm.comeback >= 0.35 && !m.novelty.flags.some((f) => f.key === 'bigComeback')) {
    if (cb.deficit >= 2 || (cb.deficit >= 1 && ['soccer', 'hockey', 'baseball'].includes(sport))) {
      push('comeback', `${final ? 'Came back' : 'Coming back'} from ${cb.deficit} ${cb.deficit === 1 ? UNIT[sport].replace(/s$/, '') : UNIT[sport]} down`);
    } else {
      push('comeback', `${final ? 'Won' : 'Leading'} after falling to a ${Math.round(cb.minWp * 100)}% win chance`);
    }
  }

  // Pace.
  if (norm.pace >= 0.85) push('pace', `High-scoring (${m.pace.total} ${UNIT[sport] || 'points'})`);
  else if (norm.pace <= 0.12 && final && sport !== 'baseball') push('pace', 'Low-scoring', '-');

  // Context that mattered in-game.
  for (const r of ctx.context?.reasons || []) {
    if (['stakes', 'rivalry', 'ranked'].includes(r.key)) push('stakes', r.text, '+', 0.02);
  }

  return out;
}

/** Order and trim reasons for display, given the final value. */
export function pickReasons(reasons, value, max = 3) {
  const pos = reasons.filter((r) => r.tone === '+').sort((a, b) => b.score - a.score);
  const neg = reasons.filter((r) => r.tone === '-').sort((a, b) => b.score - a.score);
  let picked;
  if (value < 40) picked = [...neg.slice(0, 2), ...pos].slice(0, max);
  else if (value < 65) picked = [...pos.slice(0, 2), ...neg.slice(0, 1), ...pos.slice(2)].slice(0, max);
  else picked = [...pos, ...neg].slice(0, max);
  return picked;
}

export function joinReasons(reasons) {
  return reasons.map((r) => r.text).join(' · ');
}
