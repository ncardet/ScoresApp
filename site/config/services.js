// Where to watch: which of YOUR services carry each TV network / streamer.
//
// ESPN lists broadcasters per game (e.g. "ESPN", "NBC", "Peacock", "Prime Video"). Each name is
// looked up here after applying ALIASES; a game shows the services that carry any of its
// broadcasters, or "Not on your services" when none do.
//
// Edit freely. Regional sports networks (Spectrum SportsNet, SportsNet LA, FanDuel Sports
// Network) and ESPN+ / Apple TV / MLS Season Pass are intentionally absent because none of
// your services carry them.

/** The services you pay for (display names). Settings can switch these off on your phone. */
export const MY_SERVICES = ['YouTube TV', 'Prime Video', 'Peacock', 'Paramount+', 'HBO Max', 'Netflix'];

/** Short labels used on the compact game rows. */
export const SERVICE_SHORT = {
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
  CBS: ['YouTube TV', 'Paramount+'],
  NBC: ['YouTube TV', 'Peacock'],
  FOX: ['YouTube TV'],
  'The CW': ['YouTube TV'],
  Telemundo: ['YouTube TV', 'Peacock'],
  Universo: ['YouTube TV', 'Peacock'],

  // ESPN / Disney cable (ESPN+ and ESPN Unlimited are separate subscriptions: not listed)
  ESPN: ['YouTube TV'],
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

  // League networks (YouTube TV base + Sports Plus add-on)
  'NFL Network': ['YouTube TV'],
  'NFL RedZone': ['YouTube TV'],
  'NBA TV': ['YouTube TV'],
  'MLB Network': ['YouTube TV'],
  'NHL Network': ['YouTube TV'],

  // Streamers
  'Prime Video': ['Prime Video'],
  Netflix: ['Netflix'],
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
};
