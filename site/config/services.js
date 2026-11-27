// Where to watch: which of YOUR services carry each TV network / streamer.
//
// ESPN lists broadcasters per game (e.g. "ESPN", "NBC", "Peacock", "Prime Video"). Each name is
// looked up here after applying ALIASES; a game shows the services that carry any of its
// broadcasters, or "Not on your services" when none do.
//
// Edit freely. Regional sports networks (Spectrum SportsNet, SportsNet LA, FanDuel Sports
// Network), league passes, Apple TV and MLS Season Pass are intentionally absent because none of
// your services carry them. A broadcaster that isn't listed here shows as "Not on your services"
// and is logged by the morning brief to site/data/unmapped-networks.json, so new names get noticed.

/** The services you have (display names). Settings can switch these off on your phone. */
export const MY_SERVICES = ['YouTube (free)', 'YouTube TV', 'Prime Video', 'Peacock', 'Paramount+', 'HBO Max', 'Netflix'];

/** The free YouTube service: free streams ESPN lists as "YouTube", "NFL on YouTube", ... */
export const FREE_YOUTUBE = 'YouTube (free)';

/** Paramount+ Premium includes your live local CBS station; Essential only includes NFL on CBS. */
export const PARAMOUNT_PREMIUM = false;

/**
 * Preferred services, first match wins: a free YouTube stream is the simplest way to watch.
 * Per league overrides: WSL matches are all on Paramount+, so it beats the odd YouTube stream.
 */
export const PREFERENCE = {
  default: [FREE_YOUTUBE],
  wsl: ['Paramount+', FREE_YOUTUBE],
};

/** League-specific carriage on top of NETWORKS: Paramount+ Essential still has NFL on CBS. */
export const LEAGUE_NETWORKS = {
  nfl: { CBS: ['Paramount+'] },
};

/** Short labels used on the compact game rows. */
export const SERVICE_SHORT = {
  'YouTube (free)': 'YouTube',
  'YouTube TV': 'YTTV',
  'Prime Video': 'Prime',
  Peacock: 'Peacock',
  'Paramount+': 'P+',
  'HBO Max': 'HBO Max',
  Netflix: 'Netflix',
};

/** Network -> services that carry it. Keys are canonical network names. */
export const NETWORKS = {
  // Broadcast networks (local affiliates on YouTube TV)
  ABC: ['YouTube TV'],
  CBS: PARAMOUNT_PREMIUM ? ['YouTube TV', 'Paramount+'] : ['YouTube TV'],
  NBC: ['YouTube TV', 'Peacock'],
  FOX: ['YouTube TV'],
  'The CW': ['YouTube TV'],
  Telemundo: ['YouTube TV', 'Peacock'],
  Universo: ['YouTube TV', 'Peacock'],
  ION: ['YouTube TV'],

  // ESPN / Disney cable. ESPN+ and ESPN Unlimited come with YouTube TV.
  ESPN: ['YouTube TV'],
  'ESPN+': ['YouTube TV'],
  'ESPN Unlimited': ['YouTube TV'],
  ESPN2: ['YouTube TV'],
  ESPNU: ['YouTube TV'],
  ESPNEWS: ['YouTube TV'],
  'ESPN Deportes': ['YouTube TV'],
  'SEC Network': ['YouTube TV'],
  'ACC Network': ['YouTube TV'],

  // Fox cable
  FS1: ['YouTube TV'],
  FS2: ['YouTube TV'],
  'Big Ten Network': ['YouTube TV'],
  'FOX Deportes': ['YouTube TV'],

  // NBCUniversal / Versant
  'USA Network': ['YouTube TV'],
  'Golf Channel': ['YouTube TV'],
  Peacock: ['Peacock'],

  // CBS / Paramount
  'CBS Sports Network': ['YouTube TV'],
  'Paramount+': ['Paramount+'],
  'CBS Sports Golazo Network': ['Paramount+'],

  // Warner Bros. Discovery
  TNT: ['YouTube TV', 'HBO Max'],
  TBS: ['YouTube TV', 'HBO Max'],
  truTV: ['YouTube TV', 'HBO Max'],
  'HBO Max': ['HBO Max'],

  // League networks on YouTube TV. MLB Network, NHL Network and NFL RedZone are not on your plan
  // (see KNOWN_GAPS), so they're left out.
  'NFL Network': ['YouTube TV'],
  'NBA TV': ['YouTube TV'],

  // Streamers
  'Prime Video': ['Prime Video'],
  Netflix: ['Netflix'],

  // Free
  YouTube: [FREE_YOUTUBE],
};

/** Other spellings ESPN uses -> canonical name above. Compared case-insensitively. */
export const ALIASES = {
  'USA Net': 'USA Network',
  USA: 'USA Network',
  BTN: 'Big Ten Network',
  'B1G Network': 'Big Ten Network',
  'Big Ten Net': 'Big Ten Network',
  'Amazon Prime Video': 'Prime Video',
  'Amazon Prime': 'Prime Video',
  Prime: 'Prime Video',
  'Paramount Plus': 'Paramount+',
  CBSSN: 'CBS Sports Network',
  'CBS Sports Net': 'CBS Sports Network',
  'CBS Sports Golazo': 'CBS Sports Golazo Network',
  SECN: 'SEC Network',
  ACCN: 'ACC Network',
  'FOX Sports 1': 'FS1',
  'Fox Sports 1': 'FS1',
  'FOX Sports 2': 'FS2',
  'Fox Sports 2': 'FS2',
  Fox: 'FOX',
  Max: 'HBO Max',
  'TNT Sports': 'TNT',
  TruTV: 'truTV',
  'NFL Net': 'NFL Network',
  NFLN: 'NFL Network',
  'MLB Net': 'MLB Network',
  MLBN: 'MLB Network',
  NBATV: 'NBA TV',
  'NHL Net': 'NHL Network',
  'ESPN 2': 'ESPN2',
  ESPNews: 'ESPNEWS',
  'Peacock Premium': 'Peacock',
  'ESPN Plus': 'ESPN+',
  'NFL on YouTube': 'YouTube',
  'NBC Sports YouTube': 'YouTube',
  'NBC Sports on YouTube': 'YouTube',
  'WSL YouTube': 'YouTube',
  'YouTube (free)': 'YouTube',
};

/**
 * Settings → What my services cover: the networks each league's games are usually on (national
 * TV and streaming, 2026). The panel maps them through NETWORKS to your services; any that map to
 * none of them are listed as missing, together with KNOWN_GAPS.
 */
export const LEAGUE_CARRIERS = {
  nfl: ['CBS', 'FOX', 'NBC', 'ESPN', 'ABC', 'Prime Video', 'NFL Network', 'Netflix', 'Peacock', 'YouTube'],
  cfb: ['ABC', 'ESPN', 'ESPN2', 'ESPNU', 'ESPN+', 'FOX', 'FS1', 'CBS', 'NBC', 'Peacock', 'Big Ten Network', 'SEC Network', 'ACC Network', 'The CW'],
  nba: ['ABC', 'ESPN', 'NBC', 'Peacock', 'Prime Video', 'NBA TV'],
  wnba: ['ABC', 'ESPN', 'ESPN+', 'ION', 'CBS', 'CBS Sports Network', 'NBC', 'USA Network', 'Peacock', 'Prime Video', 'NBA TV'],
  mcbb: ['CBS', 'TNT', 'TBS', 'truTV', 'ESPN', 'ESPN2', 'ESPN+', 'FOX', 'FS1', 'NBC', 'Peacock', 'Big Ten Network', 'CBS Sports Network'],
  wcbb: ['ABC', 'ESPN', 'ESPN2', 'ESPN+', 'FOX', 'FS1', 'NBC', 'Peacock', 'Big Ten Network'],
  mlb: ['FOX', 'FS1', 'ESPN', 'NBC', 'Peacock', 'TBS', 'Netflix', 'MLB Network'],
  nhl: ['ESPN', 'ABC', 'ESPN+', 'TNT', 'truTV', 'HBO Max', 'NHL Network'],
  epl: ['NBC', 'USA Network', 'Peacock'],
  ucl: ['CBS', 'Paramount+', 'CBS Sports Golazo Network'],
  uel: ['Paramount+', 'CBS Sports Network'],
  mls: ['Apple TV', 'FOX', 'FS1'],
  nwsl: ['CBS', 'Paramount+', 'ABC', 'ESPN', 'Prime Video', 'ION'],
  wsl: ['Paramount+', 'CBS Sports Network'],
  f1: ['Apple TV'],
  seriea: ['Paramount+', 'CBS Sports Network'],
  uecl: ['Paramount+'],
  uwcl: ['Paramount+', 'ESPN+'],
  nascar: ['FOX', 'FS1', 'NBC', 'USA Network', 'TNT', 'truTV', 'HBO Max', 'Prime Video'],
  tennis: ['ESPN', 'ESPN2', 'ABC', 'ESPN+', 'TNT', 'truTV', 'HBO Max'],
  ufc: ['Paramount+', 'CBS'],
};

/** What your services don't carry, by league (local and add-on coverage ESPN can't tell us about). */
export const KNOWN_GAPS = {
  nfl: ['NFL RedZone', "NFL Sunday Ticket (Raiders games that don't air in LA)"],
  nba: ['Lakers local games on Spectrum SportsNet'],
  wnba: ['Sparks local games on Spectrum SportsNet'],
  mlb: ['Dodgers local games on SportsNet LA', 'MLB Network'],
  nhl: ['Kings local games on ABTV / DAZN', 'NHL Network'],
};
