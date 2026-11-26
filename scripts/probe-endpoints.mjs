#!/usr/bin/env node
// Probe every data endpoint the app relies on and report, per league:
//   - HTTP status, payload size, and whether CORS lets a GitHub Pages origin read it
//   - which fields exist: win probability, play-by-play, lineups, xG, broadcasts, odds, ...
//
// Usage:
//   node scripts/probe-endpoints.mjs [--origin https://you.github.io] [--league nba] [--out docs/probe-report]
// Behind an HTTPS proxy, Node's fetch needs: NODE_USE_ENV_PROXY=1 (Node >= 22.21).
//
// Writes <out>.md (human summary) and <out>.json (full details).

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LEAGUES } from '../site/js/core/leagues.js';

const args = parseArgs(process.argv.slice(2));
const ORIGIN = args.origin || 'https://example.github.io';
const OUT = args.out || 'docs/probe-report';
const ONLY = args.league ? new Set(String(args.league).split(',')) : null;

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const SITE_V2 = 'https://site.api.espn.com/apis/v2/sports';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[k] = next; i++; } else out[k] = true;
    }
  }
  return out;
}

function ymd(d) {
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000);
}

async function get(url) {
  const t0 = performance.now();
  const rec = { url, status: 0, ok: false, cors: false, acao: null, bytes: 0, ms: 0, error: null };
  try {
    const res = await fetch(url, { headers: { Origin: ORIGIN, Accept: 'application/json' } });
    rec.status = res.status;
    rec.acao = res.headers.get('access-control-allow-origin');
    rec.cors = rec.acao === '*' || rec.acao === ORIGIN;
    rec.cacheControl = res.headers.get('cache-control');
    const text = await res.text();
    rec.bytes = text.length;
    rec.ok = res.ok;
    try { rec.json = JSON.parse(text); } catch { rec.error = 'not JSON'; }
  } catch (e) {
    rec.error = e.cause?.code || e.message;
  }
  rec.ms = Math.round(performance.now() - t0);
  return rec;
}

function strip(rec) {
  const { json, ...rest } = rec;
  return rest;
}

/** Recursively collect object keys / stat names that look like xG. */
function findXg(node, path = '', hits = new Set(), depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12 || hits.size > 5) return hits;
  if (Array.isArray(node)) {
    node.slice(0, 50).forEach((v, i) => findXg(v, `${path}[${i}]`, hits, depth + 1));
    return hits;
  }
  for (const [k, v] of Object.entries(node)) {
    if (/^(xg|xG|expectedGoals.*|expected_goals.*)$/i.test(k)) hits.add(`${path}.${k}`);
    if (k === 'name' && typeof v === 'string' && /expected ?goals|^xg$/i.test(v)) hits.add(`${path}.name=${v}`);
    findXg(v, `${path}.${k}`, hits, depth + 1);
  }
  return hits;
}

function analyzeScoreboard(json) {
  const events = json?.events || [];
  const comps = events.map((e) => e.competitions?.[0]).filter(Boolean);
  const count = (pred) => comps.filter(pred).length;
  return {
    events: events.length,
    states: events.reduce((m, e) => {
      const s = e.status?.type?.state || '?';
      m[s] = (m[s] || 0) + 1;
      return m;
    }, {}),
    withBroadcasts: count((c) => (c.broadcasts?.length || 0) + (c.geoBroadcasts?.length || 0) > 0),
    withOdds: count((c) => c.odds?.length > 0),
    withRanks: count((c) => c.competitors?.some((t) => (t.curatedRank?.current ?? 99) <= 25)),
    withRecords: count((c) => c.competitors?.some((t) => t.records?.length)),
    withSituationWP: count((c) => c.situation?.lastPlay?.probability != null),
    withSeries: count((c) => !!c.series),
    withNotes: count((c) => c.notes?.length > 0),
    withSoccerDetails: count((c) => c.details?.length > 0),
    sampleNetworks: [...new Set(comps.flatMap((c) => [
      ...(c.broadcasts || []).flatMap((b) => b.names || []),
      ...(c.geoBroadcasts || []).map((g) => g.media?.shortName),
    ]).filter(Boolean))].slice(0, 25),
    sessionTypes: json?.leagues?.[0]?.slug === 'f1'
      ? [...new Set(comps.length ? events.flatMap((e) => e.competitions.map((c) => c.type?.abbreviation || c.type?.text)) : [])]
      : undefined,
  };
}

function analyzeSummary(json) {
  if (!json) return null;
  const drivesPlays = json.drives
    ? (json.drives.previous || []).reduce((n, d) => n + (d.plays?.length || 0), 0) + (json.drives.current?.plays?.length || 0)
    : 0;
  const rosters = json.rosters || [];
  const comp = json.header?.competitions?.[0] || {};
  const xg = [...findXg(json)];
  return {
    keys: Object.keys(json),
    winProbability: json.winprobability?.length || 0,
    plays: json.plays?.length || drivesPlays || 0,
    playsSource: json.plays?.length ? 'plays' : drivesPlays ? 'drives' : null,
    scoringPlays: json.scoringPlays?.length || 0,
    keyEvents: json.keyEvents?.length || 0,
    commentary: json.commentary?.length || 0,
    commentaryShots: (json.commentary || []).filter((c) => /^shot-|goal/.test(c.play?.type?.type || '')).length,
    lineups: rosters.filter((r) => (r.roster || []).some((p) => p.starter)).length,
    formation: rosters.map((r) => r.formation).filter(Boolean),
    boxscorePlayers: json.boxscore?.players?.length || 0,
    teamStatNames: (json.boxscore?.teams?.[0]?.statistics || []).map((s) => s.name || s.label).slice(0, 40),
    xg: xg.length ? xg : null,
    shotMapAvailable: comp.shotMapAvailable ?? null,
    predictor: !!json.predictor,
    pickcenter: json.pickcenter?.length || 0,
    broadcasts: json.broadcasts?.length || 0,
    series: !!comp.series,
    seasonseries: json.seasonseries?.length || 0,
    standingsInSummary: !!json.standings,
  };
}

function analyzeStandings(json) {
  if (!json) return null;
  const groups = [];
  const walk = (n, depth) => {
    if (!n) return;
    if (n.standings?.entries) groups.push({ name: n.name || n.abbreviation, entries: n.standings.entries.length, depth });
    (n.children || []).forEach((c) => walk(c, depth + 1));
  };
  walk(json, 0);
  const firstEntry = (function find(n) {
    if (!n) return null;
    if (n.standings?.entries?.length) return n.standings.entries[0];
    for (const c of n.children || []) { const f = find(c); if (f) return f; }
    return null;
  })(json);
  return {
    groups: groups.length,
    entries: groups.reduce((n, g) => n + g.entries, 0),
    groupNames: groups.map((g) => g.name).slice(0, 12),
    statNames: (firstEntry?.stats || []).map((s) => s.name || s.type).slice(0, 30),
    seasonDisplay: json.seasons?.[0]?.displayName || json.season?.displayName || null,
  };
}

function analyzeRankings(json) {
  if (!json) return null;
  return {
    polls: (json.rankings || []).map((r) => `${r.name} (${r.ranks?.length || 0})`),
    latestWeek: json.latestWeek?.displayValue || null,
  };
}

// ESPN rejects date ranges (`dates=A-B` -> 400 "Failed to get events endpoint"), so step back
// one day at a time: daily for the first two weeks, then every 3rd day (off-season leagues).
const LOOKBACK_DAYS = [...Array.from({ length: 14 }, (_, i) => i), ...Array.from({ length: 36 }, (_, i) => 15 + i * 3)];

async function findFinished(l) {
  for (const days of LOOKBACK_DAYS) {
    const date = ymd(daysAgo(days));
    const rec = await get(`${SITE}/${l.espn}/scoreboard?dates=${date}`);
    const events = rec.json?.events || [];
    const done = events
      .filter((e) => e.status?.type?.completed && e.status?.type?.state === 'post')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    if (done.length) return { range: date, scoreboard: strip(rec), event: done[0] };
  }
  return null;
}

async function probeLeague(l) {
  const out = { league: l.key, name: l.name, espn: l.espn };

  // 1) Today's scoreboard (no date = ESPN's "current" slate).
  const sb = await get(`${SITE}/${l.espn}/scoreboard`);
  out.scoreboard = { ...strip(sb), ...analyzeScoreboard(sb.json) };

  // 2) A live game, if one is on right now.
  const live = (sb.json?.events || []).find((e) => e.status?.type?.state === 'in');
  if (live && l.sport !== 'racing') {
    const s = await get(`${SITE}/${l.espn}/summary?event=${live.id}`);
    out.liveSummary = { event: live.id, name: live.name, ...strip(s), ...analyzeSummary(s.json) };
  }

  // 3) The most recent finished game -> summary.
  const fin = await findFinished(l);
  if (fin) {
    const e = fin.event;
    const s = await get(`${SITE}/${l.espn}/summary?event=${e.id}`);
    out.finishedSummary = {
      event: e.id, name: e.name, date: e.date, range: fin.range,
      ...strip(s), ...analyzeSummary(s.json),
    };
    out.rangeScoreboard = { ...fin.scoreboard, ...analyzeScoreboard({ events: [e] }) };
  } else {
    out.finishedSummary = null;
  }

  // 3b) Soccer: team xG and advanced match stats live in ESPN's core API, not in the summary.
  if (l.sport === 'soccer' && fin) {
    const e = fin.event;
    const teamId = e.competitions?.[0]?.competitors?.[0]?.id;
    const slug = l.espn.split('/')[1];
    const st = await get(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${slug}/events/${e.id}/competitions/${e.id}/competitors/${teamId}/statistics`);
    const names = (st.json?.splits?.categories || []).flatMap((c) => (c.stats || []).map((s) => s.name));
    out.coreTeamStats = {
      ...strip(st),
      statCount: names.length,
      xg: names.includes('expectedGoals'),
      bigChances: names.includes('bigChanceCreated'),
    };
  }

  // 3c) F1: ESPN has no summary for racing; session results sit on the scoreboard competitors.
  if (l.sport === 'racing' && fin) {
    const comps = fin.event.competitions || [];
    out.f1Sessions = comps.map((c) => ({
      type: c.type?.abbreviation,
      state: c.status?.type?.state,
      competitors: c.competitors?.length || 0,
      hasOrder: (c.competitors || []).some((d) => d.order != null),
      statNames: [...new Set((c.competitors || []).flatMap((d) => (d.statistics || []).map((s) => s.name)))].slice(0, 12),
    }));
  }

  // 4) Standings (the documented /apis/v2 path).
  const st = await get(`${SITE_V2}/${l.espn}/standings`);
  out.standings = { ...strip(st), ...analyzeStandings(st.json) };

  // 5) Rankings for college leagues.
  if (l.college) {
    const rk = await get(`${SITE}/${l.espn}/rankings`);
    out.rankings = { ...strip(rk), ...analyzeRankings(rk.json) };
  }
  return out;
}

async function probeF1Extras() {
  const year = new Date().getUTCFullYear();
  const res = {};
  const openf1 = await get(`https://api.openf1.org/v1/sessions?year=${year}&session_name=Race`);
  const races = Array.isArray(openf1.json) ? openf1.json : [];
  const past = races.filter((r) => new Date(r.date_end) < new Date()).at(-1);
  res.openf1Sessions = { ...strip(openf1), races: races.length, lastRace: past ? `${past.location} ${past.date_start}` : null };
  if (past) {
    // OpenF1's free tier rate-limits bursts (HTTP 429), so space the calls out.
    for (const ep of ['race_control', 'position', 'overtakes', 'intervals', 'laps', 'session_result']) {
      await new Promise((r) => setTimeout(r, 1200));
      const r = await get(`https://api.openf1.org/v1/${ep}?session_key=${past.session_key}`);
      res[`openf1_${ep}`] = { ...strip(r), rows: Array.isArray(r.json) ? r.json.length : null, sample: Array.isArray(r.json) ? r.json[0] : r.json?.detail };
    }
  }
  return res;
}

function mark(v) {
  if (v === true) return 'yes';
  if (v === false || v === 0 || v == null) return '—';
  return String(v);
}

function toMarkdown(results, f1, startedAt) {
  const lines = [];
  lines.push('# Endpoint probe report', '');
  lines.push(`Generated ${startedAt} with Origin \`${ORIGIN}\`. Re-run: \`npm run probe\`.`, '');
  const allCors = results.every((r) => [r.scoreboard, r.finishedSummary, r.standings, r.rankings, r.coreTeamStats]
    .filter(Boolean).every((x) => !x.status || x.cors));
  lines.push(`**CORS:** ${allCors ? 'every ESPN endpoint answered with `Access-Control-Allow-Origin: *` — the browser can call ESPN directly.' : 'SOME ENDPOINTS BLOCK CROSS-ORIGIN READS — see the table.'}`, '');
  lines.push('## Per-league availability', '');
  lines.push('| League | Scoreboard | Summary | Standings | Rankings | Win prob. | Play-by-play | Lineups | xG | Broadcasts | Odds | Predictor |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const s = r.finishedSummary;
    const ep = (x) => (x ? `${x.status}${x.cors ? ' ✓CORS' : ' ✗CORS'}` : '—');
    const xg = r.coreTeamStats?.xg ? 'team xG (core API)' : s?.xg ? 'top shooter only' : '—';
    lines.push(`| ${r.name} | ${ep(r.scoreboard)} | ${ep(s)} | ${ep(r.standings)} | ${r.rankings ? ep(r.rankings) : 'n/a'} | ${mark(s?.winProbability)} | ${s?.plays ? `${s.plays} (${s.playsSource})` : s?.commentary ? `commentary ${s.commentary}` : '—'} | ${s?.lineups ? `${s.lineups} (${s.formation.join(' / ') || 'no formation'})` : '—'} | ${xg} | ${r.scoreboard?.withBroadcasts ?? 0}/${r.scoreboard?.events ?? 0} games | ${r.scoreboard?.withOdds ?? 0}/${r.scoreboard?.events ?? 0} | ${mark(s?.predictor)} |`);
  }
  lines.push('', 'Counts are from the most recent finished game (summary) and the current scoreboard.', '');
  lines.push('## Details', '');
  for (const r of results) {
    const s = r.finishedSummary;
    lines.push(`### ${r.name} (\`${r.espn}\`)`, '');
    lines.push(`- Scoreboard now: ${r.scoreboard?.events} events ${JSON.stringify(r.scoreboard?.states)}, ${Math.round((r.scoreboard?.bytes || 0) / 1024)} KB, ${r.scoreboard?.ms} ms`);
    if (r.scoreboard?.sampleNetworks?.length) lines.push(`- Networks seen: ${r.scoreboard.sampleNetworks.join(', ')}`);
    if (r.scoreboard?.sessionTypes) lines.push(`- Session types: ${r.scoreboard.sessionTypes.join(', ')}`);
    if (s) {
      lines.push(`- Finished game: ${s.name} (${s.event}, ${s.date}) — summary ${Math.round(s.bytes / 1024)} KB, ${s.ms} ms`);
      lines.push(`- Summary keys: ${s.keys?.join(', ')}`);
      lines.push(`- Win probability points: ${s.winProbability}; plays: ${s.plays}; scoring plays: ${s.scoringPlays}; key events: ${s.keyEvents}; commentary: ${s.commentary} (${s.commentaryShots} shots/goals)`);
      if (s.teamStatNames?.length) lines.push(`- Team stats: ${s.teamStatNames.join(', ')}`);
      lines.push(`- Box score players: ${s.boxscorePlayers ? 'yes' : 'no'}; predictor: ${s.predictor ? 'yes' : 'no'}; odds (pickcenter): ${s.pickcenter}; series: ${s.series ? 'yes' : 'no'}; shot map flag: ${s.shotMapAvailable}`);
      if (s.xg) lines.push(`- xG fields: ${s.xg.join(', ')}`);
    } else {
      lines.push('- No finished game found in the lookback window.');
    }
    if (r.coreTeamStats) lines.push(`- Core API team stats: ${r.coreTeamStats.status}${r.coreTeamStats.cors ? ' ✓CORS' : ' ✗CORS'}, ${r.coreTeamStats.statCount} stats, xG ${r.coreTeamStats.xg ? 'yes' : 'no'}, big chances ${r.coreTeamStats.bigChances ? 'yes' : 'no'}`);
    if (r.f1Sessions) lines.push(`- F1 sessions on scoreboard: ${r.f1Sessions.map((x) => `${x.type} (${x.competitors} drivers${x.hasOrder ? ', order' : ''}${x.statNames.length ? `, stats: ${x.statNames.join('/')}` : ''})`).join('; ')}`);
    if (r.liveSummary) lines.push(`- Live game probed: ${r.liveSummary.name} — win prob. points ${r.liveSummary.winProbability}, plays ${r.liveSummary.plays}, commentary ${r.liveSummary.commentary}`);
    lines.push(`- Standings: ${r.standings?.status}, ${r.standings?.groups} groups / ${r.standings?.entries} rows (${(r.standings?.groupNames || []).join(', ')})`);
    if (r.standings?.statNames?.length) lines.push(`- Standings stats: ${r.standings.statNames.join(', ')}`);
    if (r.rankings) lines.push(`- Rankings: ${r.rankings.status} — ${(r.rankings.polls || []).join('; ')}`);
    lines.push('');
  }
  if (f1) {
    lines.push('## F1 supplementary sources', '');
    for (const [k, v] of Object.entries(f1)) {
      lines.push(`- **${k}**: ${v.status} ${v.cors ? '✓CORS' : `✗CORS (${v.acao})`} ${v.error ? `error ${v.error}` : ''} ${v.rows != null ? `rows ${v.rows}` : ''} ${v.race || v.lastRace || ''} ${v.total ? `total ${v.total}` : ''} ${v.drivers ? `drivers ${v.drivers}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const startedAt = new Date().toISOString();
  const leagues = LEAGUES.filter((l) => !ONLY || ONLY.has(l.key));
  const results = [];
  // Small concurrency so we are polite to ESPN.
  const queue = [...leagues];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const l = queue.shift();
      try {
        const r = await probeLeague(l);
        results.push(r);
        const s = r.finishedSummary;
        console.log(`${l.short.padEnd(5)} sb ${r.scoreboard.status}${r.scoreboard.cors ? '+cors' : '-CORS'} ` +
          `sum ${s?.status ?? '—'}${s ? (s.cors ? '+cors' : '-CORS') : ''} wp=${s?.winProbability ?? '—'} ` +
          `plays=${s?.plays ?? '—'} lineups=${s?.lineups ?? '—'} xg=${s?.xg ? 'yes' : 'no'} ` +
          `stand ${r.standings.status}${r.standings.cors ? '+cors' : '-CORS'}${r.rankings ? ` rank ${r.rankings.status}` : ''}`);
      } catch (e) {
        console.error(`${l.key}: probe failed`, e);
        results.push({ league: l.key, name: l.name, espn: l.espn, error: String(e) });
      }
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => LEAGUES.findIndex((l) => l.key === a.league) - LEAGUES.findIndex((l) => l.key === b.league));

  let f1 = null;
  if (!ONLY || ONLY.has('f1')) {
    try { f1 = await probeF1Extras(); } catch (e) { f1 = { error: { status: 0, error: String(e) } }; }
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(`${OUT}.json`, JSON.stringify({ startedAt, origin: ORIGIN, results, f1 }, null, 2));
  await writeFile(`${OUT}.md`, toMarkdown(results, f1, startedAt));
  const blocked = results.flatMap((r) => [r.scoreboard, r.finishedSummary, r.standings, r.rankings, r.coreTeamStats]
    .filter((x) => x && x.status && !x.cors).map((x) => x.url));
  console.log(`\nWrote ${OUT}.md and ${OUT}.json`);
  if (blocked.length) {
    console.log('\nCORS BLOCKED:\n' + blocked.join('\n'));
    process.exitCode = 2;
  } else {
    console.log('CORS: all ESPN endpoints allow cross-origin reads.');
  }
}

main();
