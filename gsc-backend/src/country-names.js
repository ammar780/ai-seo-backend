// Country code → full name mapping (ISO 3166-1 alpha-3 → English name)
// Source: matches what GSC returns in the "country" dimension.
export const COUNTRY_NAMES = {
  usa: 'United States', gbr: 'United Kingdom', can: 'Canada', aus: 'Australia',
  deu: 'Germany', fra: 'France', ind: 'India', nld: 'Netherlands', mex: 'Mexico',
  esp: 'Spain', ita: 'Italy', bra: 'Brazil', jpn: 'Japan', kor: 'South Korea',
  rus: 'Russia', chn: 'China', irn: 'Iran', pak: 'Pakistan', idn: 'Indonesia',
  tur: 'Turkey', vnm: 'Vietnam', tha: 'Thailand', phl: 'Philippines', mys: 'Malaysia',
  sgp: 'Singapore', hkg: 'Hong Kong', twn: 'Taiwan', pol: 'Poland', swe: 'Sweden',
  nor: 'Norway', dnk: 'Denmark', fin: 'Finland', che: 'Switzerland', aut: 'Austria',
  bel: 'Belgium', irl: 'Ireland', prt: 'Portugal', grc: 'Greece', cze: 'Czech Republic',
  hun: 'Hungary', rou: 'Romania', ukr: 'Ukraine', arg: 'Argentina', chl: 'Chile',
  col: 'Colombia', per: 'Peru', ven: 'Venezuela', nzl: 'New Zealand', zaf: 'South Africa',
  nga: 'Nigeria', egy: 'Egypt', mar: 'Morocco', ken: 'Kenya', sau: 'Saudi Arabia',
  are: 'UAE', qat: 'Qatar', kwt: 'Kuwait', isr: 'Israel', irq: 'Iraq',
  bgd: 'Bangladesh', lka: 'Sri Lanka', npl: 'Nepal', mmr: 'Myanmar', khm: 'Cambodia',
};

export function countryName(code) {
  return COUNTRY_NAMES[String(code).toLowerCase()] || String(code).toUpperCase();
}
