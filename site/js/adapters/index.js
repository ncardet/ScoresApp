// Adapter registry: league key -> adapter. The rest of the app only talks to adapters through here.
import nfl from './nfl.js';
import cfb from './cfb.js';
import nba from './nba.js';
import wnba from './wnba.js';
import mcbb from './mcbb.js';
import wcbb from './wcbb.js';
import mlb from './mlb.js';
import nhl from './nhl.js';
import epl from './epl.js';
import ucl from './ucl.js';
import uel from './uel.js';
import mls from './mls.js';
import nwsl from './nwsl.js';
import wsl from './wsl.js';
import f1 from './f1.js';

export const ADAPTERS = { nfl, cfb, nba, wnba, mcbb, wcbb, mlb, nhl, epl, ucl, uel, mls, nwsl, wsl, f1 };

export function adapter(key) {
  const a = ADAPTERS[key];
  if (!a) throw new Error(`No adapter for league ${key}`);
  return a;
}
