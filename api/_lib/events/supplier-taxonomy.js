/**
 * Supplier event taxonomy — the alias tables that make two feeds speak one language.
 *
 * Built from a full read of the "Supplier Event Listings" export (11,045 rows,
 * 28 Jul 2026 to 23 Jul 2027): 111 distinct category/competition pairs from
 * SportsEvents365 and 31 from XS2Event. Every alias below was observed in that
 * export. Nothing here is speculative — if a label is not in the feed, it is not
 * in this file.
 *
 * Why it exists: the two suppliers label the same competition differently.
 * SportsEvents365 says "Football (Soccer) / English Premier League", XS2Event
 * says "Football / Premier League". Fed straight into a filter, every major
 * league appears twice.
 *
 * Two traps this file is shaped around:
 *   1. "Serie A" means Italy to XS2Event, but SportsEvents365 also carries
 *      "Brazilian Serie A" and "Serie A (Brazil)". Aliases are resolved inside
 *      a category, never globally, and the Brazilian labels are mapped
 *      explicitly so they can never collide with the Italian ones.
 *   2. "Bundesliga" means Germany to XS2Event, which spells the Austrian one
 *      "Bundesliga AT". Same fix.
 *
 * Adding a competition: put the canonical slug in COMPETITIONS with every
 * supplier spelling in `aliases`. The normaliser lower-cases and collapses
 * whitespace before matching, so case and spacing do not matter.
 */

/** Canonical categories. `aliases` are the raw supplier category strings. */
export const CATEGORIES = [
  { slug: 'football',          label: 'Football',          aliases: ['football (soccer)', 'football'] },
  { slug: 'american-football', label: 'American Football',  aliases: ['us football', 'nfl'] },
  { slug: 'baseball',          label: 'Baseball',           aliases: ['baseball'] },
  { slug: 'basketball',        label: 'Basketball',         aliases: ['basketball'] },
  { slug: 'ice-hockey',        label: 'Ice Hockey',         aliases: ['ice hockey'] },
  { slug: 'tennis',            label: 'Tennis',             aliases: ['tennis', 'tennis - grand slam', 'tennis – grand slam', 'beach tennis'] },
  { slug: 'rugby',             label: 'Rugby',              aliases: ['rugby'] },
  { slug: 'cricket',           label: 'Cricket',            aliases: ['cricket'] },
  { slug: 'golf',              label: 'Golf',               aliases: ['golf'] },
  { slug: 'volleyball',        label: 'Volleyball',         aliases: ['volleyball'] },
  { slug: 'motorsport',        label: 'Motorsport',         aliases: ['car racing', 'formula 1', 'motorbike racing', 'motor gp'] },
  { slug: 'fighting',          label: 'Fighting',           aliases: ['fighting', 'wrestling'] },
  { slug: 'horse-racing',      label: 'Horse Racing',       aliases: ['horse racing'] },
  { slug: 'equestrian',        label: 'Equestrian',         aliases: ['equestrian sports'] },
  { slug: 'athletics',         label: 'Athletics',          aliases: ['athletics'] },
  { slug: 'field-hockey',      label: 'Field Hockey',       aliases: ['field hockey'] },
  { slug: 'entertainment',     label: 'Entertainment',      aliases: ['entertainment'] },
];

/**
 * Canonical competitions, scoped to a category.
 *
 * `country` is the one a customer would look under, not a strict list. MLS and
 * the NHL both have Canadian clubs and are still filed under USA, the way a
 * travel site lists them. International competitions have no country and show
 * their label on its own.
 *
 * `aliases` holds every raw supplier spelling. A competition with a single
 * alias is here because it needs a stable slug, not because it needed merging.
 */
export const COMPETITIONS = [
  // ── Football: the cross-supplier collisions ────────────────────────────────
  { slug: 'english-premier-league', label: 'Premier League',        category: 'football', country: 'England', aliases: ['english premier league', 'premier league'] },
  { slug: 'english-championship',   label: 'Championship',          category: 'football', country: 'England', aliases: ['english football league championship', 'championship'] },
  { slug: 'spanish-la-liga',        label: 'La Liga',               category: 'football', country: 'Spain', aliases: ['spanish la liga', 'la liga'] },
  { slug: 'spanish-segunda',        label: 'Segunda División',      category: 'football', country: 'Spain', aliases: ['spanish league 2nd division', 'segunda división', 'segunda division'] },
  { slug: 'italian-serie-a',        label: 'Serie A',               category: 'football', country: 'Italy', aliases: ['italian serie a', 'serie a'] },
  { slug: 'brazilian-serie-a',      label: 'Brazilian Série A',     category: 'football', country: 'Brazil', aliases: ['brazilian serie a', 'serie a (brazil)'] },
  { slug: 'german-bundesliga',      label: 'Bundesliga',            category: 'football', country: 'Germany', aliases: ['german bundesliga', 'bundesliga'] },
  { slug: 'german-2-bundesliga',    label: '2. Bundesliga',         category: 'football', country: 'Germany', aliases: ['german 2. bundesliga'] },
  { slug: 'austrian-bundesliga',    label: 'Austrian Bundesliga',   category: 'football', country: 'Austria', aliases: ['austrian bundesliga', 'bundesliga at'] },
  { slug: 'french-ligue-1',         label: 'Ligue 1',               category: 'football', country: 'France', aliases: ['french ligue 1', 'ligue 1'] },
  { slug: 'french-ligue-2',         label: 'Ligue 2',               category: 'football', country: 'France', aliases: ['french league 2'] },
  { slug: 'belgian-pro-league',     label: 'Belgian Pro League',    category: 'football', country: 'Belgium', aliases: ['belgium league', 'pro league'] },
  { slug: 'dutch-eredivisie',       label: 'Eredivisie',            category: 'football', country: 'Netherlands', aliases: ['dutch eredivisie', 'eredivisie'] },
  { slug: 'portuguese-primeira',    label: 'Primeira Liga',         category: 'football', country: 'Portugal', aliases: ['portuguese league', 'primeira liga'] },
  { slug: 'danish-superliga',       label: 'Superliga',             category: 'football', country: 'Denmark', aliases: ['danish superliga', 'superligaen'] },
  { slug: 'scottish-premiership',   label: 'Scottish Premiership',  category: 'football', country: 'Scotland', aliases: ['scottish premiership'] },
  { slug: 'football-friendly',      label: 'Friendlies',            category: 'football', aliases: ['friendly matches - football', 'friendlies'] },

  // ── Football: single-supplier, slugged for stable filtering ────────────────
  { slug: 'czech-first-league',     label: 'Czech First League',    category: 'football', country: 'Czechia', aliases: ['czech first league'] },
  { slug: 'croatian-hnl',           label: 'Croatian HNL',          category: 'football', country: 'Croatia', aliases: ['first croatian football league'] },
  { slug: 'greek-super-league',     label: 'Super League Greece',   category: 'football', country: 'Greece', aliases: ['super league greece'] },
  { slug: 'swiss-super-league',     label: 'Swiss Super League',    category: 'football', country: 'Switzerland', aliases: ['swiss super league'] },
  { slug: 'turkish-super-lig',      label: 'Süper Lig',             category: 'football', country: 'Turkey', aliases: ['turkish super lig'] },
  { slug: 'polish-ekstraklasa',     label: 'Ekstraklasa',           category: 'football', country: 'Poland', aliases: ['polish league (ekstraklasa)'] },
  { slug: 'serbian-superliga',      label: 'Serbian SuperLiga',     category: 'football', country: 'Serbia', aliases: ['serbian league'] },
  { slug: 'swedish-allsvenskan',    label: 'Allsvenskan',           category: 'football', country: 'Sweden', aliases: ['swedish league allsvenskan'] },
  { slug: 'argentine-primera',      label: 'Primera División',      category: 'football', country: 'Argentina', aliases: ['argentine primera division'] },
  { slug: 'mls',                    label: 'MLS',                   category: 'football', country: 'USA', aliases: ['mls (soccer)'] },
  { slug: 'leagues-cup',            label: 'Leagues Cup',           category: 'football', aliases: ['leagues cup'] },
  { slug: 'copa-libertadores',      label: 'Copa Libertadores',     category: 'football', aliases: ['copa libertadores'] },
  { slug: 'copa-do-brasil',         label: 'Copa do Brasil',        category: 'football', country: 'Brazil', aliases: ['copa do brasil'] },
  { slug: 'uefa-champions-league',  label: 'UEFA Champions League', category: 'football', aliases: ['uefa champions league'] },
  { slug: 'uefa-europa-league',     label: 'UEFA Europa League',    category: 'football', aliases: ['uefa europa league'] },
  { slug: 'uefa-conference-league', label: 'UEFA Conference League',category: 'football', aliases: ['uefa conference league'] },
  { slug: 'uefa-nations-league',    label: 'UEFA Nations League',   category: 'football', aliases: ['uefa nations league'] },
  { slug: 'uefa-super-cup',         label: 'UEFA Super Cup',        category: 'football', aliases: ['uefa super cup'] },
  { slug: 'afc-asian-cup',          label: 'AFC Asian Cup',         category: 'football', aliases: ['afc asian cup 2027', 'afc-u23 2020'] },
  { slug: 'efl-cup',                label: 'EFL Cup',               category: 'football', country: 'England', aliases: ['efl (carabao) cup'] },
  { slug: 'dfb-pokal',              label: 'DFB-Pokal',             category: 'football', country: 'Germany', aliases: ['german cup (dfb-pokal)'] },
  { slug: 'taca-da-liga',           label: 'Taça da Liga',          category: 'football', country: 'Portugal', aliases: ['portuguese league cup (taça da liga)'] },
  { slug: 'football-super-cup',     label: 'Super Cup',             category: 'football', aliases: ['belgian super cup', 'french super cup', 'german super cup (dfl)', 'johan cruijff shield (dutch super cup)'] },
  { slug: 'joan-gamper-cup',        label: 'Joan Gamper Trophy',    category: 'football', country: 'Spain', aliases: ['joan gamper cup'] },

  // ── American football ──────────────────────────────────────────────────────
  { slug: 'nfl',           label: 'NFL',           category: 'american-football', country: 'USA', aliases: ['nfl (us football)', 'nfl international games'] },
  { slug: 'nfl-preseason', label: 'NFL Preseason', category: 'american-football', country: 'USA', aliases: ['nfl preseason'] },
  { slug: 'super-bowl',    label: 'Super Bowl',    category: 'american-football', country: 'USA', aliases: ['super bowl lxi 2027'] },

  // ── Baseball, basketball, ice hockey ───────────────────────────────────────
  { slug: 'mlb',                 label: 'MLB',                 category: 'baseball',   country: 'USA', aliases: ['mlb (baseball)'] },
  { slug: 'nba',                 label: 'NBA',                 category: 'basketball', country: 'USA', aliases: ['nba (basketball)', 'nba europe games', 'nba global games'] },
  { slug: 'nba-preseason',       label: 'NBA Preseason',       category: 'basketball', country: 'USA', aliases: ['nba preseason'] },
  { slug: 'wnba',                label: 'WNBA',                category: 'basketball', country: 'USA', aliases: ['wnba'] },
  { slug: 'fiba-world-cup-qual', label: 'FIBA World Cup Qualifying', category: 'basketball', aliases: ['2027 fiba world cup european qualifying'] },
  { slug: 'nhl',                 label: 'NHL',                 category: 'ice-hockey', country: 'USA', aliases: ['nhl (ice hockey)'] },
  { slug: 'nhl-preseason',       label: 'NHL Preseason',       category: 'ice-hockey', country: 'USA', aliases: ['nhl preseason'] },
  { slug: 'nhl-special',         label: 'NHL Special Events',  category: 'ice-hockey', country: 'USA', aliases: ['nhl all star game', 'nhl global series', 'nhl stadium series', 'nhl winter classic', 'stanley cup finals'] },
  { slug: 'champions-hockey-league', label: 'Champions Hockey League', category: 'ice-hockey', aliases: ['champions hockey league'] },

  // ── Tennis ─────────────────────────────────────────────────────────────────
  { slug: 'us-open-tennis',     label: 'US Open',            category: 'tennis', country: 'USA', aliases: ['us open (tennis – grand slam)', 'us open (tennis - grand slam)', 'us open tennis'] },
  { slug: 'australian-open',    label: 'Australian Open',    category: 'tennis', country: 'Australia', aliases: ['australian open (grand slam)'] },
  { slug: 'wimbledon',          label: 'Wimbledon',          category: 'tennis', country: 'England', aliases: ['wimbledon (grand slam)'] },
  { slug: 'atp-wta-1000',       label: 'ATP / WTA 1000',     category: 'tennis', aliases: ['atp masters 1000 / wta 1000 (joint tournaments)', 'atp world tour masters 1000', 'indian wells masters bnp paribas open', 'miami open', 'rolex monte-carlo masters', 'rolex paris masters'] },
  { slug: 'atp-tour',           label: 'ATP Tour',           category: 'tennis', aliases: ['atp tour (250/500)'] },
  { slug: 'wta-tour',           label: 'WTA Tour',           category: 'tennis', aliases: ['wta tour'] },
  { slug: 'nitto-atp-finals',   label: 'Nitto ATP Finals',   category: 'tennis', country: 'Italy', aliases: ['nitto atp finals'] },
  { slug: 'davis-cup',          label: 'Davis Cup',          category: 'tennis', aliases: ['davis cup'] },
  { slug: 'laver-cup',          label: 'Laver Cup',          category: 'tennis', aliases: ['laver cup'] },
  { slug: 'beach-tennis-open',  label: 'Aruba Open Beach Tennis', category: 'tennis', country: 'Aruba', aliases: ['aruba open beach tennis championship'] },

  // ── Rugby, cricket, golf, volleyball, athletics, equestrian, hockey ────────
  { slug: 'six-nations',            label: 'Six Nations',            category: 'rugby',      aliases: ['six nations'] },
  { slug: 'rugby-nations-championship', label: 'Nations Championship', category: 'rugby',  aliases: ['world rugby nations championship', 'nations championship'] },
  { slug: 'rugby-champions-cup',    label: 'Champions Cup',          category: 'rugby',      aliases: ['european rugby champions cup'] },
  { slug: 'rugby-challenge-cup',    label: 'Challenge Cup',          category: 'rugby',      aliases: ['challenge cup'] },
  { slug: 'the-ashes',              label: 'The Ashes',              category: 'cricket',    aliases: ['the ashes'] },
  { slug: 'cricket-test',           label: 'Test Match',             category: 'cricket',    aliases: ['test match', "england cricket at lord's", 'england cricket at the oval'] },
  { slug: 'cricket-odi',            label: 'One Day International',  category: 'cricket',    aliases: ['one day internationals'] },
  { slug: 'european-tour-golf',     label: 'DP World Tour',          category: 'golf',       aliases: ['pga - golf european tour'] },
  { slug: 'solheim-cup',            label: 'Solheim Cup',            category: 'golf',       aliases: ['solheim cup'] },
  { slug: 'euro-volleyball-2026',   label: 'European Championship',  category: 'volleyball', aliases: ['2026 men european volleyball championship'] },
  { slug: 'diamond-league',         label: 'Diamond League',         category: 'athletics',  aliases: ['diamond league'] },
  { slug: 'fei-world-championships',label: 'FEI World Championships',category: 'equestrian', aliases: ['fei world championships'] },
  { slug: 'field-hockey-world-cup', label: 'World Cup',              category: 'field-hockey', aliases: ['field hockey world cup 2026'] },
  { slug: 'cheltenham-festival',    label: 'Cheltenham Festival',    category: 'horse-racing', country: 'England', aliases: ['cheltenham festival'] },

  // ── Motorsport ─────────────────────────────────────────────────────────────
  { slug: 'formula-1', label: 'Formula 1', category: 'motorsport', aliases: ['formula 1'] },
  { slug: 'motogp',    label: 'MotoGP',    category: 'motorsport', aliases: ['motogp', 'motor gp'] },
  // SportsEvents365 files most NASCAR rounds under their sponsor race name
  // rather than the series. These are all NASCAR Cup Series races, folded so a
  // "NASCAR" filter returns the season rather than one row. "Championship Race"
  // and "New Hampshire Motor Speedway Races" are left unmapped on purpose —
  // neither names a series, so folding them would be a guess.
  { slug: 'nascar',    label: 'NASCAR',    category: 'motorsport', country: 'USA', aliases: ['nascar', 'nascar  cook out southern 500', 'coke zero sugar 400', 'cook out 400', 'iowa corn 350', 'xfinity 500', 'freeway insurance 500'] },

  // ── Fighting ───────────────────────────────────────────────────────────────
  { slug: 'wwe',            label: 'WWE',            category: 'fighting', aliases: ['wwe'] },
  { slug: 'ufc-fight-night', label: 'UFC Fight Night', category: 'fighting', aliases: ['ufc fight night'] },

  // ── Entertainment ──────────────────────────────────────────────────────────
  { slug: 'concerts',           label: 'Concerts',           category: 'entertainment', aliases: ['concerts'] },
  { slug: 'opera',              label: 'Opera',              category: 'entertainment', aliases: ['opera'] },
  { slug: 'shows-and-musicals', label: 'Shows and Musicals', category: 'entertainment', aliases: ['shows and musicals'] },
  { slug: 'festivals',          label: 'Festivals',          category: 'entertainment', aliases: ['festivals', 'meo kalorama', 'rock in rio', 'tomorrowland'] },
];

/**
 * A category whose raw label IS the competition when the supplier gives no
 * second segment. XS2Event files Formula 1 and MotoGP as bare categories.
 */
export const CATEGORY_IMPLIES_COMPETITION = new Map([
  ['formula 1', 'formula-1'],
  ['motor gp', 'motogp'],
]);

/** Canonical supplier slugs. Anything unrecognised is slugged and passed through. */
export const SUPPLIERS = [
  { slug: 'sportsevents365', label: 'SportsEvents365', aliases: ['sportsevents365'], idPrefix: '179' },
  { slug: 'xs2event',        label: 'XS2Event',        aliases: ['xs2event'],        idPrefix: '144' },
];

/**
 * Club-type tokens dropped from either END of a team name when building a
 * dedupe key, so "Aberdeen" and "Aberdeen FC" match.
 *
 * Deliberately excludes anything that distinguishes two real clubs — United,
 * City, Rovers, Wanderers, Athletic, Rangers, County and friends are NOT here.
 * Dropping "United" would merge Manchester United into Manchester City.
 */
export const CLUB_TOKENS = new Set([
  'fc', 'afc', 'cf', 'sc', 'ac', 'fk', 'nk', 'cs', 'sk', 'bk', 'ik', 'if', 'ifk',
  'ss', 'ssc', 'as', 'rc', 'rcd', 'cd', 'ud', 'sd', 'kv', 'kaa', 'rsc', 'sv',
  'tsv', 'vfb', 'vfl', 'bsc', 'sl', 'gd', 'oh', 'club', 'calcio', 'футбол',
]);
