// Your favorite teams. Their games are pinned to the top of Today and marked with a star.
//
// Each entry matches by ESPN team id inside the listed leagues, so a club follows you across
// competitions (Liverpool shows up in the Premier League, Champions League and Europa League).
// To find an id, open the team on espn.com: it is the number in the URL,
// e.g. https://www.espn.com/soccer/club/_/id/364/liverpool -> '364'.
//
// The Settings screen can toggle these on your phone (stored on the device). Edit this file to
// change what the morning brief (brief.json) treats as a favorite.

export default [
  { name: 'Las Vegas Raiders', leagues: ['nfl'], id: '13' },
  { name: 'USC Trojans', leagues: ['cfb'], id: '30' },
  { name: 'USC Trojans (men)', leagues: ['mcbb'], id: '30' },
  { name: 'USC Trojans (women)', leagues: ['wcbb'], id: '30' },
  { name: 'Los Angeles Lakers', leagues: ['nba'], id: '13' },
  { name: 'Los Angeles Dodgers', leagues: ['mlb'], id: '19' },
  { name: 'LA Kings', leagues: ['nhl'], id: '8' },
  { name: 'Liverpool', leagues: ['epl', 'ucl', 'uel'], id: '364' },
  { name: 'LAFC', leagues: ['mls'], id: '18966' },
  { name: 'Angel City FC', leagues: ['nwsl'], id: '21422' },
];
