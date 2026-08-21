/**
 * THE COASTWISE DEMONSTRATION SITE, whole.
 *
 * Andy, 21 Aug 2026: take the approved Coastwise homepage concept and build the
 * full site in the CMS, ready to show a client what the platform can do. The
 * world this implements is committed in designs/coastwise/DESIGN.md; read that
 * before changing copy or colour here. Two corrections from his review of the
 * concept are carried in: text never touches the viewport edge (every section
 * keeps the contained width and standard padding), and the home page holds a
 * clear, labelled slot for the booking search widget so the site can be made
 * bookable.
 *
 * WHY A COMMITTED FILE RATHER THAN CLICKS IN THE EDITOR: the demo is
 * reproducible. Run tools/build-coastwise.mjs and the whole site is rebuilt,
 * validated through the same parsePage + sanitisePage the editor saves through,
 * and emitted as seed JSON. Losing the database loses nothing.
 *
 * Every image path is /coastwise/<name>.jpg, served from public/ on the app's
 * own origin, the same self-hosting argument the font library documents: no
 * third-party host learns who visits a client's site, and nothing expires.
 */

import { newId } from '../lib/content/factory';
import type { Block, Column, Page, Row, Section, Seo } from '../lib/content/schema';
import { CONTENT_VERSION } from '../lib/content/schema';

/* ---------------------------------------------------------------- helpers */

type Props = Record<string, unknown>;

export function block(type: string, props: Props): Block {
  return { id: newId('b'), type, props } as Block;
}

function col(width: number, blocks: Block[], extra: Partial<Column> = {}): Column {
  return { id: newId('col'), width, blocks, ...extra } as Column;
}

function row(columns: Column[], gap: Props | string = 'l'): Row {
  return { id: newId('row'), gap, columns } as unknown as Row;
}

/** One column holding these blocks, the shape most sections take. */
function stack(blocks: Block[]): Row[] {
  return [row([col(100, blocks)])];
}

export function sec(partial: Partial<Section> & { rows: Row[] }): Section {
  return {
    id: newId('sec'),
    tone: 'light',
    width: 'contained',
    paddingY: 'l',
    minHeight: 0,
    ...partial,
  } as Section;
}

export function page(title: string, slug: string, seo: Seo, sections: Section[]): Page {
  return { version: CONTENT_VERSION, id: newId('pg'), title, slug, seo, sections } as Page;
}

/* ------------------------------------------------------------- the images */
/*
 * Twenty photographs carry the whole site, the way seven carried the concept.
 * Reuse is the concept's own discipline: the same dawn fjord seen on the home
 * hero returns on the Norwegian page, because it is the same voyage.
 *
 * They live in the tg-sites Supabase project's public 'coastwise' storage
 * bucket: the same infrastructure the CMS already depends on, stable URLs, and
 * no third-party host in a visitor's waterfall beyond the database we already
 * trust. Put there by the coastwise-seed edge function, 21 Aug 2026.
 */
const IMG_BASE =
  'https://qvzbothxlrzeklcvdhzp.supabase.co/storage/v1/object/public/coastwise';

export const IMG = {
  fjordDawn: `${IMG_BASE}/fjord-dawn.jpg`,
  openSea: `${IMG_BASE}/open-sea.jpg`,
  harbour: `${IMG_BASE}/harbour.jpg`,
  hebrides: `${IMG_BASE}/hebrides-shore.jpg`,
  deck: `${IMG_BASE}/deck-teak.jpg`,
  saloon: `${IMG_BASE}/saloon.jpg`,
  aerial: `${IMG_BASE}/aerial-channel.jpg`,
  dalmatia: `${IMG_BASE}/dalmatia.jpg`,
  faroe: `${IMG_BASE}/faroe-cliffs.jpg`,
  lycian: `${IMG_BASE}/lycian-coast.jpg`,
  ashore: `${IMG_BASE}/walking-ashore.jpg`,
  food: `${IMG_BASE}/food-quay.jpg`,
  wildlife: `${IMG_BASE}/wildlife.jpg`,
  charter: `${IMG_BASE}/charter-evening.jpg`,
  crewMaster: `${IMG_BASE}/crew-master.jpg`,
  crewChef: `${IMG_BASE}/crew-chef.jpg`,
  crewPurser: `${IMG_BASE}/crew-purser.jpg`,
  crewEngineer: `${IMG_BASE}/crew-engineer.jpg`,
  crewGuide: `${IMG_BASE}/crew-guide.jpg`,
  crewMate: `${IMG_BASE}/crew-mate.jpg`,
} as const;

/* ------------------------------------------------------------ the regions */

export function header(): { sections: Section[] } {
  return {
    sections: [
      sec({
        name: 'Header',
        tone: 'dark',
        width: 'wide',
        paddingY: 's',
        rows: [
          row(
            [
              col(30, [
                block('heading', { level: 'h4', html: 'COASTWISE', align: 'left' }),
              ], { align: 'centre' }),
              col(70, [
                block('nav', {
                  layout: 'row',
                  align: 'right',
                  gap: 'l',
                  collapse: 'phone',
                  uppercase: false,
                  items: [
                    { label: 'Voyages', href: '/destinations', newTab: false },
                    { label: 'Holidays', href: '/holidays', newTab: false },
                    { label: 'The ships', href: '/about', newTab: false },
                    { label: 'Our people', href: '/team', newTab: false },
                    { label: 'Check dates', href: '/#book', newTab: false },
                  ],
                }),
              ], { align: 'centre' }),
            ],
            'm',
          ),
        ],
      }),
    ],
  };
}

export function footer(): { sections: Section[] } {
  return {
    sections: [
      sec({
        name: 'Footer',
        tone: 'dark',
        width: 'wide',
        paddingY: 'l',
        rows: [
          row(
            [
              col(40, [
                block('heading', { level: 'h4', html: 'COASTWISE', align: 'left' }),
                block('text', {
                  html:
                    '<p>Small ship voyages on the Scottish, Norwegian, Faroese and Dalmatian coasts, and one warm one. Sailing since 2011.</p>',
                }),
                block('social', {
                  align: 'left',
                  size: 's',
                  items: [
                    { network: 'instagram', href: 'https://instagram.com' },
                    { network: 'facebook', href: 'https://facebook.com' },
                  ],
                }),
              ]),
              col(30, [
                block('heading', { level: 'h5', html: 'Voyages', align: 'left' }),
                block('nav', {
                  layout: 'column',
                  align: 'left',
                  gap: 's',
                  collapse: 'never',
                  items: [
                    { label: 'Western Isles', href: '/destinations/western-isles', newTab: false },
                    { label: 'Norwegian Narrows', href: '/destinations/norwegian-narrows', newTab: false },
                    { label: 'Dalmatian Backwater', href: '/destinations/dalmatian-backwater', newTab: false },
                    { label: 'Faroe and Shetland', href: '/destinations/faroe-and-shetland', newTab: false },
                    { label: 'The Lycian Shore', href: '/destinations/lycian-shore', newTab: false },
                  ],
                }),
              ]),
              col(30, [
                block('heading', { level: 'h5', html: 'Practical', align: 'left' }),
                block('nav', {
                  layout: 'column',
                  align: 'left',
                  gap: 's',
                  collapse: 'never',
                  items: [
                    { label: 'The ships', href: '/about', newTab: false },
                    { label: 'Our people', href: '/team', newTab: false },
                    { label: 'Talk to us', href: '/contact', newTab: false },
                    { label: 'Booking terms', href: '/terms', newTab: false },
                  ],
                }),
              ]),
            ],
            'xl',
          ),
          row([
            col(100, [
              block('divider', { style: 'line', spacing: 'm' }),
              block('copyright', {
                owner: 'Coastwise Voyages Ltd',
                startYear: 2011,
                symbol: 'symbol',
                suffix: 'ABTA Y2841 · ATOL 11627 · A Travelgenix demonstration site.',
                size: 's',
                align: 'left',
              }),
            ]),
          ]),
        ],
      }),
    ],
  };
}

/* ---------------------------------------------------------------- shared */

/**
 * The booking slot, kept as ONE function because it appears on more than one
 * page and has to look like the same counter wherever it is met. This is
 * Andy's second correction to the concept: the site must have somewhere for
 * the Travelify search widget so it can be made bookable. The section is
 * named so the slot is unmissable in the editor's outline, and the spacer is
 * the exact place the widget block drops in.
 */
function bookingSlot(): Section {
  return sec({
    name: 'Booking search — drop the Travelify widget here',
    tone: 'dark',
    anchor: 'book',
    paddingY: 'l',
    rows: [
      row([
        col(45, [
          block('heading', { level: 'h2', html: 'Check dates and cabins', align: 'left' }),
          block('text', {
            html: '<p>Pick a coast, a week and a cabin. The 2027 season is open.</p>',
          }),
        ], { align: 'centre' }),
        col(55, [
          // The widget lands here. Until it does, the spacer holds the room
          // so the section already has the shape the search box will take.
          block('spacer', { height: 'xl' }),
          block('button-group', {
            align: 'left',
            buttons: [
              { label: 'Talk to us instead', href: '/contact', variant: 'secondary', newTab: false },
            ],
          }),
        ], { align: 'centre' }),
      ], 'xl'),
    ],
  });
}

/** A page-top banner all inner pages share: photograph, one heading, one line. */
function banner(title: string, line: string, image: string, alt: string): Section {
  return sec({
    name: 'Banner',
    tone: 'dark',
    width: 'contained',
    paddingY: 'xl',
    minHeight: 420,
    backgroundImage: image,
    overlay: 45,
    kenBurns: true,
    rows: stack([
      block('breadcrumbs', { separator: 'slash', showHome: true, size: 's', align: 'left' }),
      block('heading', { level: 'h1', html: title, align: 'left' }),
      block('text', { html: `<p>${line}</p>` }),
    ]),
  });
}

/* ------------------------------------------------------------------ home */

export function home(): Page {
  const sections: Section[] = [
    // THE HERO. The concept's scroll film becomes the section background
    // slideshow: three photographs cycling behind the headline, pure CSS.
    sec({
      name: 'Hero',
      tone: 'dark',
      width: 'contained',
      paddingY: 'xl',
      minHeight: 640,
      backgroundImage: IMG.fjordDawn,
      backgroundSlides: [IMG.openSea, IMG.harbour],
      backgroundTransition: 'fade',
      backgroundInterval: 6,
      overlay: 40,
      reveal: true,
      revealStyle: 'rise',
      rows: stack([
        block('heading', {
          level: 'h1',
          html: 'Thirty-eight guests. No queue for anything.',
          align: 'left',
        }),
        block('text', {
          html:
            '<p>Seven nights along a coast a large ship cannot reach. We tie up in the village, not the terminal.</p>',
        }),
        block('button-group', {
          align: 'left',
          buttons: [
            { label: 'Three coasts, three ships', href: '/destinations', variant: 'primary', newTab: false },
            { label: 'Check dates', href: '#book', variant: 'secondary', newTab: false },
          ],
        }),
      ]),
    }),

    // Andy's correction no. 2: the bookable slot, straight after the hero.
    bookingSlot(),

    // The statement: what we actually do, and the numbers that prove it.
    sec({
      name: 'What we do',
      paddingY: 'xl',
      reveal: true,
      rows: [
        row([
          col(100, [
            block('heading', {
              level: 'h2',
              html: 'A coast is a sequence of small places. We go at the speed of the small places.',
              align: 'left',
            }),
          ]),
        ]),
        row(
          [
            col(55, [
              block('text', {
                html:
                  '<p>Coastwise runs three ships and nothing else. Each carries between twenty-six and forty-four guests, draws under four metres, and can lie alongside a stone quay that a 3,000-berth ship has to admire from six miles out.</p>' +
                  '<p>There is no theatre, no atrium, no photographer waiting at the gangway. There is a saloon with eight tables, a bar that runs on trust, and a bridge you are welcome on whenever the master says so. Dinner is whatever came aboard that morning at the last port.</p>' +
                  '<p>Our masters have sailed these waters an average of nineteen seasons. When the weather turns, they change the plan rather than the arrival time. That is the whole reason to travel this way.</p>',
              }),
            ]),
            col(45, [
              block('stats', {
                columns: '2',
                size: 'l',
                divided: true,
                align: 'left',
                items: [
                  { value: '38', label: 'Guests aboard MV Freya' },
                  { value: '12', label: 'Crew, all seasons' },
                  { value: '3.8', suffix: 'm', label: 'Draught, so village quays' },
                  { value: '19', label: 'Seasons, average, per master' },
                ],
              }),
            ]),
          ],
          'xl',
        ),
      ],
    }),

    // Why a small ship: the icon-led grid with the hover tint (Fancy Grid).
    sec({
      name: 'Why a small ship',
      tone: 'subtle',
      paddingY: 'xl',
      hoverTint: true,
      reveal: true,
      revealStagger: true,
      rows: stack([
        block('heading', { level: 'h2', html: 'What thirty-eight guests changes', align: 'left' }),
        block('cards', {
          source: 'typed',
          columns: '3',
          gap: 'm',
          style: 'tinted',
          lead: 'icon',
          iconAlign: 'left',
          iconColour: '#c8452c',
          imagePosition: 'top',
          radius: 'md',
          align: 'left',
          wholeCardLinks: false,
          items: [
            {
              src: '', icon: 'map', alt: '', label: '',
              title: 'The village, not the terminal',
              body: 'Under four metres of draught means the stone quay in the middle of town, kippers smoking fifty yards from the gangway.',
              linkLabel: '', linkHref: '',
            },
            {
              src: '', icon: 'compass', alt: '', label: '',
              title: 'Plans that bend',
              body: 'When the weather turns, the master changes the plan rather than the arrival time. A schedule is not the point of a coast.',
              linkLabel: '', linkHref: '',
            },
            {
              src: '', icon: 'quote', alt: '', label: '',
              title: 'One sitting, no seating plan',
              body: 'Eight tables and no rota. By Wednesday you have eaten with everyone aboard, whether you meant to or not.',
              linkLabel: '', linkHref: '',
            },
          ],
        }),
      ]),
    }),

    // Seven days, one rail: the Western Isles itinerary as a slider.
    sec({
      name: 'A week, day by day',
      paddingY: 'xl',
      rows: stack([
        block('heading', { level: 'h2', html: 'Seven nights, Oban to Stornoway', align: 'left' }),
        block('text', {
          html: '<p>One week of the Western Isles voyage, day by day. Every voyage page has its own.</p>',
        }),
        block('slider', {
          slideWidth: 'medium',
          tilt: 'none',
          gap: 'm',
          style: 'plain',
          ratio: '4/5',
          radius: 'md',
          rows: '1',
          scrollbar: 'bar',
          align: 'left',
          wholeCardLinks: false,
          items: [
            { src: IMG.harbour, alt: 'Oban harbour from the water', label: 'Day 01 · Oban', title: 'Board at four, sail at six', body: 'Kippers smoking on the quay as we clear the Sound of Kerrera.', linkLabel: '', linkHref: '' },
            { src: IMG.deck, alt: 'Teak deck and brass cleat', label: 'Day 02 · Tobermory', title: 'Alongside by nine', body: 'The distillery does a tasting for us before it opens to the road.', linkLabel: '', linkHref: '' },
            { src: IMG.hebrides, alt: 'White strand on Coll', label: 'Day 03 · At sea', title: 'Coll and the Cairns', body: 'Anchor off the white strand. Tenders ashore all afternoon; nobody else lands that day.', linkLabel: '', linkHref: '' },
            { src: IMG.aerial, alt: 'The ship threading between islands', label: 'Day 04 · Iona and Staffa', title: 'Fingal’s Cave at slack water', body: 'When you can hear the columns rather than the swell.', linkLabel: '', linkHref: '' },
            { src: IMG.openSea, alt: 'Open sea and low sun', label: 'Day 05 · Canna', title: 'Eleven residents, one post box', body: 'The best anchorage in the Small Isles. Dinner on deck if it holds.', linkLabel: '', linkHref: '' },
            { src: IMG.fjordDawn, alt: 'Still water at first light', label: 'Day 06 · Harris', title: 'Ashore at Rodel', body: 'A weaver in Drinishader works the loom while we stand in her shed.', linkLabel: '', linkHref: '' },
            { src: IMG.saloon, alt: 'The dining saloon at dusk', label: 'Day 07 · Stornoway', title: 'In at seven, ashore by nine', body: 'Breakfast aboard. Cars and the ferry are both a short walk.', linkLabel: '', linkHref: '' },
          ],
        }),
      ]),
    }),

    // Aboard: the deep band, with the three-image rotation.
    sec({
      name: 'Aboard',
      tone: 'dark',
      paddingY: 'xl',
      reveal: true,
      rows: [
        row(
          [
            col(45, [
              block('heading', { level: 'h2', html: 'Two decks, one table, and a door onto the water.', align: 'left' }),
              block('text', {
                html:
                  '<p>Cabins are plain and warm: oak, wool, a window that opens. Nobody dresses for dinner, and there is no fixed seating, so by Wednesday you have eaten with everyone aboard whether you meant to or not.</p>',
              }),
              block('tags', {
                style: 'bullets',
                size: 'm',
                colour: '',
                align: 'left',
                items: [
                  { label: 'Full board', href: '' },
                  { label: 'All landings', href: '' },
                  { label: 'No tipping', href: '' },
                ],
              }),
            ], { align: 'centre' }),
            col(55, [
              block('shifting-images', {
                interval: 5,
                height: 'medium',
                radius: 'md',
                items: [
                  { src: IMG.saloon, alt: 'The dining saloon at dusk, the coast passing outside' },
                  { src: IMG.deck, alt: 'Teak deck and rope detail' },
                  { src: IMG.fjordDawn, alt: 'First light from the bridge' },
                ],
              }),
            ]),
          ],
          'xl',
        ),
      ],
    }),

    // Three ships, three coasts: the stacked deck.
    sec({
      name: 'The voyages',
      paddingY: 'xl',
      rows: stack([
        block('heading', { level: 'h2', html: 'Three ships. Five coasts.', align: 'left' }),
        block('stacked-cards', {
          side: 'right',
          height: 'medium',
          radius: 'md',
          cardColour: '#f2efe9',
          items: [
            {
              src: IMG.hebrides, alt: 'Hebridean shoreline of black rock and clear water',
              title: 'Western Isles · MV Freya, 38 guests',
              body: 'Oban to Stornoway through the Small Isles, with landings on Coll, Canna and Staffa. The one to book if you want weather with your scenery. Seven nights, April to September, from £2,340.',
              linkLabel: 'See the voyage', linkHref: '/destinations/western-isles',
            },
            {
              src: IMG.fjordDawn, alt: 'A small ship entering a fjord at first light',
              title: 'Norwegian Narrows · MV Skua, 26 guests',
              body: 'Bergen to Ålesund the slow way, up the arms the express boats skip. Nine nights, four of them at anchor under something vertical. May to August, from £3,180.',
              linkLabel: 'See the voyage', linkHref: '/destinations/norwegian-narrows',
            },
            {
              src: IMG.dalmatia, alt: 'A limestone harbour on a Dalmatian island',
              title: 'Dalmatian Backwater · MV Nyren, 44 guests',
              body: 'Split to Dubrovnik by way of Vis, Lastovo and Šipan. Warm water, cold wine, and six nights of swimming off the stern before breakfast. June to October, from £1,895.',
              linkLabel: 'See the voyage', linkHref: '/destinations/dalmatian-backwater',
            },
          ],
        }),
      ]),
    }),

    // One guest, four voyages in. The whole case, in her words.
    sec({
      name: 'Guest words',
      tone: 'subtle',
      paddingY: 'xl',
      rows: stack([
        block('testimonials', {
          items: [
            {
              quote: 'We were alongside in Canna before I had finished my coffee. On the last cruise we took, that was a coach transfer.',
              name: 'Margaret Ellwood', detail: 'Hexham · MV Freya, June 2026 · fourth voyage', rating: 5,
            },
            {
              quote: 'The master turned us round in the night to miss a blow, and we woke up somewhere better. Nobody announced it. It was just done.',
              name: 'David Okafor', detail: 'Bristol · MV Skua, July 2026', rating: 5,
            },
            {
              quote: 'I swam before breakfast every day for six days. The chef bought octopus off a boy on the quay at Vis and that was dinner.',
              name: 'Sarah and Tom Whittle', detail: 'York · MV Nyren, September 2025', rating: 4.5,
            },
          ],
        }),
      ]),
    }),

    // The close: one picture, one line, one way in.
    sec({
      name: 'Closing',
      tone: 'dark',
      paddingY: 'xl',
      minHeight: 480,
      backgroundImage: IMG.aerial,
      overlay: 50,
      kenBurns: true,
      rows: stack([
        block('heading', { level: 'h2', html: 'Pick a coast. We will do the rest.', align: 'centre' }),
        block('button-group', {
          align: 'centre',
          buttons: [
            { label: 'Check dates and cabins', href: '#book', variant: 'primary', newTab: false },
            { label: 'Talk to us', href: '/contact', variant: 'secondary', newTab: false },
          ],
        }),
      ]),
    }),
  ];

  return page(
    'Home',
    '',
    {
      title: 'Coastwise — Small Ship Voyages',
      description:
        'Seven-night coastal voyages for thirty-eight guests. The Western Isles, the Norwegian narrows and the Dalmatian backwater, aboard ships small enough to tie up in the village.',
      noindex: false,
    },
    sections,
  );
}


/* ------------------------------------------------------- shared, inner pages */

/** The way every inner page closes: one line, two ways in. */
function closing(line: string): Section {
  return sec({
    name: 'Closing',
    tone: 'dark',
    paddingY: 'xl',
    rows: stack([
      block('heading', { level: 'h2', html: line, align: 'centre' }),
      block('button-group', {
        align: 'centre',
        buttons: [
          { label: 'Check dates and cabins', href: '/#book', variant: 'primary', newTab: false },
          { label: 'Talk to us', href: '/contact', variant: 'secondary', newTab: false },
        ],
      }),
    ]),
  });
}

/* ------------------------------------------------------------ destinations */

export function destinationsIndex(): Page {
  return page(
    'Voyages',
    'destinations',
    {
      title: 'Voyages — Coastwise',
      description: 'Five coasts, three small ships. Scotland, Norway, the Faroes, Dalmatia and the Lycian shore.',
      noindex: false,
    },
    [
      banner(
        'Five coasts. Three small ships.',
        'Every voyage below runs on a ship that draws under four metres and carries fewer than forty-five guests. Pick by weather, not by brochure.',
        IMG.openSea,
        'Open sea and a long swell in late afternoon',
      ),
      sec({
        name: 'The voyages',
        paddingY: 'xl',
        hoverLift: true,
        hoverZoom: true,
        reveal: true,
        revealStagger: true,
        rows: stack([
          block('cards', {
            source: 'typed',
            columns: '3',
            gap: 'm',
            style: 'bordered',
            imagePosition: 'top',
            lead: 'image',
            ratio: '4/3',
            radius: 'md',
            align: 'left',
            wholeCardLinks: true,
            items: [
              { src: IMG.hebrides, icon: '', alt: 'Hebridean shoreline', label: 'Scotland · 7 nights', title: 'Western Isles', body: 'Oban to Stornoway through the Small Isles. Weather with your scenery.', linkLabel: 'From £2,340', linkHref: '/destinations/western-isles' },
              { src: IMG.fjordDawn, icon: '', alt: 'A fjord at first light', label: 'Norway · 9 nights', title: 'Norwegian Narrows', body: 'Bergen to Ålesund up the arms the express boats skip.', linkLabel: 'From £3,180', linkHref: '/destinations/norwegian-narrows' },
              { src: IMG.dalmatia, icon: '', alt: 'A limestone island harbour', label: 'Croatia · 6 nights', title: 'Dalmatian Backwater', body: 'Split to Dubrovnik by way of Vis, Lastovo and Šipan.', linkLabel: 'From £1,895', linkHref: '/destinations/dalmatian-backwater' },
              { src: IMG.faroe, icon: '', alt: 'Sea cliffs in north light', label: 'North Atlantic · 8 nights', title: 'Faroe and Shetland', body: 'Lerwick to Tórshavn across the bird cliffs of the north.', linkLabel: 'From £2,890', linkHref: '/destinations/faroe-and-shetland' },
              { src: IMG.lycian, icon: '', alt: 'A pine-backed anchorage on the Lycian coast', label: 'Türkiye · 7 nights', title: 'The Lycian Shore', body: 'Fethiye to Kaş, swimming off the stern before breakfast.', linkLabel: 'From £1,760', linkHref: '/destinations/lycian-shore' },
            ],
          }),
        ]),
      }),
      closing('The right coast depends on the weather you want.'),
    ],
  );
}

/** The facts row every voyage page carries: nights, season, guests, fare. */
function voyageFacts(nights: string, season: string, ship: string, fare: string): Block {
  return block('stats', {
    columns: '4',
    size: 'm',
    align: 'left',
    divided: true,
    items: [
      { value: nights, suffix: '', label: 'Nights', detail: '' },
      { value: season, suffix: '', label: 'Season', detail: '' },
      { value: ship, suffix: '', label: 'Ship', detail: '' },
      { value: fare, suffix: '', label: 'From, per person', detail: '' },
    ],
  });
}

export function westernIsles(): Page {
  return page(
    'Western Isles',
    'western-isles',
    {
      title: 'Western Isles voyage — Coastwise',
      description: 'Seven nights, Oban to Stornoway, aboard MV Freya. Coll, Canna, Iona and Staffa, and dinner on deck if it holds.',
      noindex: false,
    },
    [
      banner(
        'Western Isles',
        'Oban to Stornoway through the Small Isles, aboard MV Freya. The one to book if you want weather with your scenery.',
        IMG.hebrides,
        'Hebridean shoreline of black rock and clear water',
      ),
      sec({
        name: 'The voyage',
        paddingY: 'xl',
        reveal: true,
        rows: [
          row([
            col(60, [
              block('text', {
                html:
                  '<p>The west of Scotland is a sequence of harbours nobody dredged for anything bigger than a fishing fleet, which is exactly why it suits us. Freya draws 3.8 metres, so she lies alongside at Tobermory and Rodel while the big ships sit off Oban landing tenders.</p>' +
                  '<p>The week is built round landings, not passages. Coll for the white strand, Staffa at slack water for Fingal’s Cave, Canna because eleven residents and one post box is a kind of perfection. When a blow comes through, the master swaps the days rather than cancelling one.</p>',
              }),
            ]),
            col(40, [
              block('rating', { rating: 4.9, showValue: true, count: 'from 212 guest reviews', size: 'm', colour: '', align: 'left' }),
              block('tags', {
                style: 'pills', size: 'm', colour: '', align: 'left',
                items: [
                  { label: 'Landings daily', href: '' },
                  { label: 'Full board', href: '' },
                  { label: 'Sea swimming', href: '' },
                  { label: 'Single cabins', href: '' },
                ],
              }),
            ]),
          ], 'xl'),
          row([col(100, [voyageFacts('7', 'Apr–Sep', 'MV Freya', '£2,340')])]),
        ],
      }),
      sec({
        name: 'Day by day',
        tone: 'subtle',
        paddingY: 'xl',
        rows: stack([
          block('heading', { level: 'h2', html: 'Seven days, day by day', align: 'left' }),
          block('slider', {
            slideWidth: 'medium', tilt: 'none', gap: 'm', style: 'plain', ratio: '4/5', radius: 'md',
            rows: '1', scrollbar: 'bar', align: 'left', wholeCardLinks: false,
            items: [
              { src: IMG.harbour, alt: 'Oban from the water', label: 'Day 01 · Oban', title: 'Board at four, sail at six', body: 'Kippers smoking on the quay as we clear the Sound of Kerrera.', linkLabel: '', linkHref: '' },
              { src: IMG.deck, alt: 'Teak deck detail', label: 'Day 02 · Tobermory', title: 'Alongside by nine', body: 'The distillery does a tasting for us before it opens to the road.', linkLabel: '', linkHref: '' },
              { src: IMG.hebrides, alt: 'The white strand on Coll', label: 'Day 03 · Coll', title: 'Nobody else lands today', body: 'Anchor off the strand, tenders ashore all afternoon.', linkLabel: '', linkHref: '' },
              { src: IMG.aerial, alt: 'The ship between islands', label: 'Day 04 · Iona and Staffa', title: 'Fingal’s Cave at slack water', body: 'When you can hear the columns rather than the swell.', linkLabel: '', linkHref: '' },
              { src: IMG.openSea, alt: 'Open water and low sun', label: 'Day 05 · Canna', title: 'The best anchorage in the Small Isles', body: 'Dinner on deck if it holds. It usually holds.', linkLabel: '', linkHref: '' },
              { src: IMG.fjordDawn, alt: 'Still water at dawn', label: 'Day 06 · Harris', title: 'Ashore at Rodel', body: 'A weaver in Drinishader works the loom while we stand in her shed.', linkLabel: '', linkHref: '' },
              { src: IMG.saloon, alt: 'The saloon at dusk', label: 'Day 07 · Stornoway', title: 'In at seven, ashore by nine', body: 'Breakfast aboard. Cars and the ferry are both a short walk.', linkLabel: '', linkHref: '' },
            ],
          }),
        ]),
      }),
      sec({
        name: 'The isles',
        paddingY: 'xl',
        rows: stack([
          block('heading', { level: 'h2', html: 'The isles, one by one', align: 'left' }),
          block('text', { html: '<p>Open one. The photograph is the argument.</p>' }),
          block('expanding-cards', {
            height: 'medium', radius: 'md', scrim: '#1b333d', scrimStrength: 55,
            items: [
              { src: IMG.hebrides, alt: 'The strand on Coll', title: 'Coll', body: 'A white strand with nobody on it, and machair behind.', linkLabel: '', linkHref: '' },
              { src: IMG.aerial, alt: 'Staffa from the air', title: 'Staffa', body: 'Fingal’s Cave, entered by tender at slack water.', linkLabel: '', linkHref: '' },
              { src: IMG.openSea, alt: 'The Small Isles in low sun', title: 'Canna', body: 'Eleven residents, one post box, the best anchorage in the Small Isles.', linkLabel: '', linkHref: '' },
              { src: IMG.fjordDawn, alt: 'Loch at first light', title: 'Harris', body: 'Rodel church, a weaver at her loom, and Luskentyre if the tide serves.', linkLabel: '', linkHref: '' },
            ],
          }),
        ]),
      }),
      sec({
        name: 'Guest words',
        tone: 'subtle',
        paddingY: 'l',
        rows: stack([
          block('quote', {
            text: 'We were alongside in Canna before I had finished my coffee. On the last cruise we took, that was a coach transfer.',
            attribution: 'Margaret Ellwood, Hexham',
            role: 'MV Freya, June 2026, fourth voyage',
          }),
        ]),
      }),
      closing('April sails first. September sails calmest.'),
    ],
  );
}

export function norwegianNarrows(): Page {
  return page(
    'Norwegian Narrows',
    'norwegian-narrows',
    {
      title: 'Norwegian Narrows voyage — Coastwise',
      description: 'Nine nights, Bergen to Ålesund aboard MV Skua, up the fjord arms the express boats skip.',
      noindex: false,
    },
    [
      banner(
        'Norwegian Narrows',
        'Bergen to Ålesund the slow way, aboard MV Skua. Nine nights, four of them at anchor under something vertical.',
        IMG.fjordDawn,
        'A small ship entering a fjord at first light',
      ),
      sec({
        name: 'The voyage',
        paddingY: 'xl',
        reveal: true,
        rows: [
          row([
            col(60, [
              block('text', {
                html:
                  '<p>The express boats do Bergen to Ålesund in a day. We take nine, because the point of a fjord is not the far end of it. Skua turns up the arms with no ferry service and anchors where the chart says there is room for exactly one ship, which there is, because she is the one ship.</p>' +
                  '<p>Four nights at anchor means four evenings when the engine stops and the water goes to glass and the only thing moving is the waterfall a mile up. Bring a book you have been meaning to read for years.</p>',
              }),
            ]),
            col(40, [
              block('rating', { rating: 4.8, showValue: true, count: 'from 147 guest reviews', size: 'm', colour: '', align: 'left' }),
              block('tags', {
                style: 'pills', size: 'm', colour: '', align: 'left',
                items: [
                  { label: 'Nights at anchor', href: '' },
                  { label: 'Midnight light', href: '' },
                  { label: 'Bridge open', href: '' },
                  { label: 'Full board', href: '' },
                ],
              }),
            ]),
          ], 'xl'),
          row([col(100, [voyageFacts('9', 'May–Aug', 'MV Skua', '£3,180')])]),
        ],
      }),
      sec({
        name: 'The arms',
        tone: 'subtle',
        paddingY: 'xl',
        rows: stack([
          block('heading', { level: 'h2', html: 'Three arms the timetables skip', align: 'left' }),
          block('half-overlay', {
            tint: '#1b333d', tintOpacity: 72, height: 'medium', transition: 'fade', interval: 7, arrows: true, dots: true,
            items: [
              { src: IMG.fjordDawn, alt: 'A narrow fjord at dawn', panelSrc: '', panelAlt: '', side: 'left', title: 'Hjørundfjord', body: 'The quiet one. Farms on ledges, a church by the water, and no road along most of it.' },
              { src: IMG.openSea, alt: 'Open water between headlands', panelSrc: '', panelAlt: '', side: 'left', title: 'Nordfjord', body: 'Out to the skerries and back in one tide, with the glacier above the whole way.' },
              { src: IMG.aerial, alt: 'The ship threading a channel', panelSrc: '', panelAlt: '', side: 'left', title: 'The inner leads', body: 'The sheltered thread between islands the coastal steamers used before anyone built roads.' },
            ],
          }),
        ]),
      }),
      sec({
        name: 'Guest words',
        paddingY: 'l',
        rows: stack([
          block('quote', {
            text: 'The master turned us round in the night to miss a blow, and we woke up somewhere better. Nobody announced it. It was just done.',
            attribution: 'David Okafor, Bristol',
            role: 'MV Skua, July 2026',
          }),
        ]),
      }),
      closing('June is the light. August is the warmth.'),
    ],
  );
}

export function dalmatianBackwater(): Page {
  return page(
    'Dalmatian Backwater',
    'dalmatian-backwater',
    {
      title: 'Dalmatian Backwater voyage — Coastwise',
      description: 'Six nights, Split to Dubrovnik aboard MV Nyren, by way of Vis, Lastovo and Šipan.',
      noindex: false,
    },
    [
      banner(
        'Dalmatian Backwater',
        'Split to Dubrovnik by way of the islands the ferries call at twice a week, aboard MV Nyren. Warm water, cold wine.',
        IMG.dalmatia,
        'A limestone harbour on a Dalmatian island',
      ),
      sec({
        name: 'The voyage',
        paddingY: 'xl',
        reveal: true,
        rows: [
          row([
            col(60, [
              block('text', {
                html:
                  '<p>The Dalmatian coast has a front, which is crowded, and a back, which is not. Nyren works the back: Vis, which was a closed military island until 1989 and still cooks like it never heard of tourism; Lastovo, a dark-sky reserve with one town and forty church towers; Šipan, where the Dubrovnik nobility built summer houses and then, usefully, left.</p>' +
                  '<p>The swimming ladder goes down before breakfast and comes up after dinner. In between there are stone harbours, konoba lunches and one very good market on the Riva at Split.</p>',
              }),
            ]),
            col(40, [
              block('rating', { rating: 4.7, showValue: true, count: 'from 189 guest reviews', size: 'm', colour: '', align: 'left' }),
              block('tags', {
                style: 'pills', size: 'm', colour: '', align: 'left',
                items: [
                  { label: 'Swim stops daily', href: '' },
                  { label: 'Konoba dinners', href: '' },
                  { label: 'Warm sea', href: '' },
                  { label: 'Six nights', href: '' },
                ],
              }),
            ]),
          ], 'xl'),
          row([col(100, [voyageFacts('6', 'Jun–Oct', 'MV Nyren', '£1,895')])]),
        ],
      }),
      sec({
        name: 'The islands',
        tone: 'subtle',
        paddingY: 'xl',
        rows: stack([
          block('heading', { level: 'h2', html: 'Three islands, front and back', align: 'left' }),
          block('text', { html: '<p>Turn a card over for the part the brochure leaves out.</p>' }),
          block('flip-cards', {
            columns: '3', gap: 'm', radius: 'md', height: 'medium', frontTone: '#1b333d', backTone: '#c8452c',
            items: [
              { src: IMG.dalmatia, alt: 'Vis harbour', title: 'Vis', body: 'Closed to outsiders until 1989. The fish is grilled the way the navy taught them, which is perfectly.', linkLabel: '', linkHref: '' },
              { src: IMG.aerial, alt: 'A channel between islands', title: 'Lastovo', body: 'A dark-sky reserve. After dinner the crew kill the deck lights and the Milky Way does the rest.', linkLabel: '', linkHref: '' },
              { src: IMG.charter, alt: 'An anchorage at dusk', title: 'Šipan', body: 'The nobility’s summer island. Their olive presses still work, and so does their wine.', linkLabel: '', linkHref: '' },
            ],
          }),
        ]),
      }),
      sec({
        name: 'Guest words',
        paddingY: 'l',
        rows: stack([
          block('quote', {
            text: 'I swam before breakfast every day for six days. The chef bought octopus off a boy on the quay at Vis and that was dinner.',
            attribution: 'Sarah and Tom Whittle, York',
            role: 'MV Nyren, September 2025',
          }),
        ]),
      }),
      closing('June for the swimming. October for the harvest.'),
    ],
  );
}

export function faroeShetland(): Page {
  return page(
    'Faroe and Shetland',
    'faroe-and-shetland',
    {
      title: 'Faroe and Shetland voyage — Coastwise',
      description: 'Eight nights, Lerwick to Tórshavn aboard MV Freya, across the bird cliffs of the north.',
      noindex: false,
    },
    [
      banner(
        'Faroe and Shetland',
        'Lerwick to Tórshavn across the top of the Atlantic, aboard MV Freya. The serious one, and the one the crew fight to work.',
        IMG.faroe,
        'Sea cliffs and birds in hard northern light',
      ),
      sec({
        name: 'The voyage',
        paddingY: 'xl',
        reveal: true,
        rows: [
          row([
            col(60, [
              block('text', {
                html:
                  '<p>This is the voyage for people who think they have seen coastline. Mykines has a million seabirds and eleven human residents. The cliffs at Enniberg drop 750 metres straight into the sea, and we idle beneath them with the engine at dead slow, because there is no other correct speed.</p>' +
                  '<p>It is also the voyage where the plan bends most. The master holds two routes in his head at all times and picks at dawn. You will not know which day the whales come. Neither do we. That is rather the point.</p>',
              }),
            ]),
            col(40, [
              block('rating', { rating: 4.9, showValue: true, count: 'from 96 guest reviews', size: 'm', colour: '', align: 'left' }),
              block('tags', {
                style: 'pills', size: 'm', colour: '', align: 'left',
                items: [
                  { label: 'Bird cliffs', href: '' },
                  { label: 'Whale watch', href: '' },
                  { label: 'Hard weather', href: '' },
                  { label: 'Eight nights', href: '' },
                ],
              }),
            ]),
          ], 'xl'),
          row([col(100, [voyageFacts('8', 'May–Jul', 'MV Freya', '£2,890')])]),
        ],
      }),
      sec({
        name: 'Practical',
        tone: 'subtle',
        paddingY: 'xl',
        rows: stack([
          block('heading', { level: 'h2', html: 'The questions everyone asks', align: 'left' }),
          block('accordion', {
            style: 'separated', single: true, openFirst: true, textColour: '',
            items: [
              { title: 'How rough does it get?', body: 'Between the islands, sheltered. The two open crossings are chosen by forecast, not by calendar, and the master will sit one out in harbour rather than take a bad one. Bring the tablets and you will probably not need them.' },
              { title: 'What do I pack?', body: 'Layers, a real waterproof, boots you can wade a tender landing in. The ship carries spares of everything anyone has ever forgotten.' },
              { title: 'Will we land on Mykines?', body: 'On about four voyages in five. It needs a settled swell, which is why the plan holds two spare days. When it comes off, it is the best landing of the season.' },
              { title: 'Is there daylight?', body: 'In June, functionally all of it. The saloon has blackout blinds and the bar stays open until the last guest concedes.' },
            ],
          }),
        ]),
      }),
      closing('Book the whole eight nights. The weather needs room to be generous.'),
    ],
  );
}

export function lycianShore(): Page {
  return page(
    'The Lycian Shore',
    'lycian-shore',
    {
      title: 'Lycian Shore voyage — Coastwise',
      description: 'Seven nights, Fethiye to Kaş aboard MV Nyren. Pine-backed anchorages, ruins at the waterline, warm sea.',
      noindex: false,
    },
    [
      banner(
        'The Lycian Shore',
        'Fethiye to Kaş along the pine-backed coast of ancient Lycia, aboard MV Nyren. Our one warm-water winter escape.',
        IMG.lycian,
        'A pine-backed anchorage on the Lycian coast',
      ),
      sec({
        name: 'The voyage',
        paddingY: 'xl',
        reveal: true,
        rows: [
          row([
            col(60, [
              block('text', {
                html:
                  '<p>Lycia buried its dead in cliff tombs facing the sea, which tells you the sea was the road. It still is: half the ruins on this coast have no land access worth the name, so a shallow-draught ship is not a luxury here, it is the only ticket.</p>' +
                  '<p>The pattern is simple. Sail early, anchor by ten, swim, lunch under the awning, ruin in the late afternoon when the stone goes gold, dinner ashore or on deck. Repeat until improved.</p>',
              }),
            ]),
            col(40, [
              block('rating', { rating: 4.8, showValue: true, count: 'from town town reviews', size: 'm', colour: '', align: 'left' }),
              block('tags', {
                style: 'pills', size: 'm', colour: '', align: 'left',
                items: [
                  { label: 'Ruins by sea', href: '' },
                  { label: 'October warmth', href: '' },
                  { label: 'Deck dining', href: '' },
                  { label: 'Seven nights', href: '' },
                ],
              }),
            ]),
          ], 'xl'),
          row([col(100, [voyageFacts('7', 'Apr–May · Oct', 'MV Nyren', '£1,760')])]),
        ],
      }),
      sec({
        name: 'The detail',
        tone: 'subtle',
        paddingY: 'xl',
        rows: stack([
          block('heading', { level: 'h2', html: 'The ship, the route, the food', align: 'left' }),
          block('tabs', {
            style: 'underline', align: 'left', textColour: '',
            items: [
              { title: 'The ship', body: 'MV Nyren, forty-four guests, the awning rigged the whole voyage. The swimming ladder lives down. Cabins are cooled the quiet way: stone-coloured blinds and a ship designed to face her stern to the afternoon sun.' },
              { title: 'The route', body: 'Fethiye, Gemiler Island and its Byzantine chapels, the long beach at Patara by tender, sunken Kekova where the harbour walls of a drowned town slide under the hull, then Kaş. Two nights at anchor, the rest alongside.' },
              { title: 'The food', body: 'A Turkish chef joins for the season. Mezze at lunch, one fish a day bought over the rail, and a farewell dinner in a chandlery-turned-restaurant in Kaş that we will not name here because it seats twenty.' },
            ],
          }),
        ]),
      }),
      closing('October. Everyone says October.'),
    ],
  );
}

/* ------------------------------------------------------------ holiday types */

export function holidaysIndex(): Page {
  return page(
    'Holidays',
    'holidays',
    {
      title: 'Ways to travel — Coastwise',
      description: 'Island hopping, wildlife at sea, food and foraging, walking ashore and private charter, all by small ship.',
      noindex: false,
    },
    [
      banner(
        'Ways to travel',
        'The same three ships, five different reasons to be aboard. Pick the one that sounds like your kind of week.',
        IMG.deck,
        'Teak deck and brass in morning light',
      ),
      sec({
        name: 'The five',
        paddingY: 'xl',
        hoverLift: true,
        hoverZoom: true,
        reveal: true,
        revealStagger: true,
        rows: stack([
          block('cards', {
            source: 'typed',
            columns: '3',
            gap: 'm',
            style: 'bordered',
            imagePosition: 'top',
            lead: 'image',
            ratio: '4/3',
            radius: 'md',
            align: 'left',
            wholeCardLinks: true,
            items: [
              { src: IMG.aerial, icon: '', alt: 'The ship between islands', label: 'The classic', title: 'Island hopping', body: 'A new harbour most days, and the sea in between.', linkLabel: 'How it works', linkHref: '/holidays/island-hopping' },
              { src: IMG.wildlife, icon: '', alt: 'Seabirds over the water', label: 'Eyes up', title: 'Wildlife at sea', body: 'Whales, sea eagles and a million seabirds, from deck height.', linkLabel: 'What you might see', linkHref: '/holidays/wildlife-at-sea' },
              { src: IMG.food, icon: '', alt: 'Produce handed aboard at a quay', label: 'The galley', title: 'Food and foraging', body: 'Dinner is whatever came aboard that morning.', linkLabel: 'How dinner happens', linkHref: '/holidays/food-and-foraging' },
              { src: IMG.ashore, icon: '', alt: 'Walkers on a shore path', label: 'Boots on', title: 'Walking ashore', body: 'Proper walks from the water line, and a ship to come home to.', linkLabel: 'The walks', linkHref: '/holidays/walking-ashore' },
              { src: IMG.charter, icon: '', alt: 'The ship at anchor at dusk', label: 'The whole ship', title: 'Private charter', body: 'Twenty-six to forty-four of your own people, one ship, your plan.', linkLabel: 'Take the ship', linkHref: '/holidays/private-charter' },
            ],
          }),
        ]),
      }),
      closing('Not sure which? Say roughly who is coming, and we will say which week.'),
    ],
  );
}

export function islandHopping(): Page {
  return page(
    'Island hopping',
    'island-hopping',
    {
      title: 'Island hopping by small ship — Coastwise',
      description: 'A new harbour most days. How a Coastwise week actually runs, hour by hour.',
      noindex: false,
    },
    [
      banner(
        'Island hopping',
        'A new harbour most days, the sea in between, and never once packing your bag mid-week.',
        IMG.aerial,
        'The ship threading a channel between islands',
      ),
      sec({
        name: 'How a week runs',
        paddingY: 'xl',
        reveal: true,
        rows: [
          row([
            col(55, [
              block('text', {
                html:
                  '<p>Island hopping by ferry is a logistics hobby. Island hopping by small ship is the same coastline with the logistics deleted: your hotel comes with you, dinner is aboard or ashore as the harbour deserves, and the crossing happens while you are at lunch.</p>',
              }),
              block('steps', {
                layout: 'down', marker: 'number', connector: true,
                items: [
                  { title: 'Morning', body: 'Sail early or lie in. The galley does both sittings without being asked.' },
                  { title: 'Midday', body: 'Alongside or at anchor somewhere new. Ashore by gangway or tender.' },
                  { title: 'Afternoon', body: 'The island. A walk, a distillery, a beach with nobody on it.' },
                  { title: 'Evening', body: 'Back aboard for dinner, or a konoba ashore. The bar runs on trust either way.' },
                ],
              }),
            ]),
            col(45, [
              block('image', { src: IMG.harbour, alt: 'A harbour town from the water', ratio: '4/5', fit: 'cover', radius: 'md' }),
            ]),
          ], 'xl'),
        ],
      }),
      sec({
        name: 'Where it works best',
        tone: 'subtle',
        paddingY: 'xl',
        hoverTint: true,
        rows: stack([
          block('heading', { level: 'h2', html: 'Three coasts built for it', align: 'left' }),
          block('cards', {
            source: 'typed', columns: '3', gap: 'm', style: 'tinted', imagePosition: 'top', lead: 'image',
            ratio: '4/3', radius: 'md', align: 'left', wholeCardLinks: true,
            items: [
              { src: IMG.hebrides, icon: '', alt: 'Hebridean shore', label: '7 nights', title: 'Western Isles', body: 'Five islands, four landings, one distillery.', linkLabel: 'From £2,340', linkHref: '/destinations/western-isles' },
              { src: IMG.dalmatia, icon: '', alt: 'Dalmatian harbour', label: '6 nights', title: 'Dalmatian Backwater', body: 'Three islands and two city rivas, warm the whole way.', linkLabel: 'From £1,895', linkHref: '/destinations/dalmatian-backwater' },
              { src: IMG.lycian, icon: '', alt: 'Lycian anchorage', label: '7 nights', title: 'The Lycian Shore', body: 'Anchorages and ancient harbours, swimming in between.', linkLabel: 'From £1,760', linkHref: '/destinations/lycian-shore' },
            ],
          }),
        ]),
      }),
      closing('One bag, unpacked once.'),
    ],
  );
}

export function wildlifeAtSea(): Page {
  return page(
    'Wildlife at sea',
    'wildlife-at-sea',
    {
      title: 'Wildlife at sea — Coastwise',
      description: 'Whales, sea eagles and a million seabirds from deck height, with a naturalist aboard on every northern voyage.',
      noindex: false,
    },
    [
      banner(
        'Wildlife at sea',
        'A ship this size does not scatter what it approaches. You watch from deck height, engine at dead slow, kettle on.',
        IMG.wildlife,
        'Seabirds working the water beside the ship',
      ),
      sec({
        name: 'The case',
        paddingY: 'xl',
        reveal: true,
        rows: [
          row([
            col(60, [
              block('text', {
                html:
                  '<p>Wildlife boats give you ninety minutes and a wet coat. A small ship gives you the whole week: the minke that surfaces beside the hull at breakfast, the sea eagle that works the same headland every evening, the hour at Enniberg when the air is more bird than sky.</p>' +
                  '<p>A naturalist sails on every northern departure. Not a lecturer with a projector: a person with binoculars who knows which ledge, which tide, which month.</p>',
              }),
            ]),
            col(40, [
              block('icon-item', { icon: 'eye', title: 'Deck-height viewing', body: 'Four metres off the water, not forty. You see the eye, not the back.', align: 'left' }),
              block('icon-item', { icon: 'compass', title: 'The master diverts', body: 'A blow on the horizon outranks the timetable. It is that kind of ship.', align: 'left' }),
              block('icon-item', { icon: 'sparkle', title: 'A naturalist aboard', body: 'On every Scottish, Faroese and Norwegian departure.', align: 'left' }),
            ]),
          ], 'xl'),
        ],
      }),
      sec({
        name: 'By season',
        tone: 'subtle',
        paddingY: 'xl',
        rows: stack([
          block('heading', { level: 'h2', html: 'What you might see, and when', align: 'left' }),
          block('accordion', {
            style: 'separated', single: false, openFirst: true, textColour: '',
            items: [
              { title: 'April and May', body: 'The cliffs fill. Puffins back on the ledges, gannets diving off Shetland, porpoise in every sound. The Hebrides at their busiest above the waterline.' },
              { title: 'June and July', body: 'Whale months. Minke reliably, humpback increasingly, orca if the herring run inshore. Mykines at full strength, all million of it.' },
              { title: 'August and September', body: 'Sea eagles teaching their young along the Norwegian arms, dolphins riding the bow most passages, and the first big rafts of shearwaters heading south.' },
            ],
          }),
        ]),
      }),
      sec({
        name: 'Guest words',
        paddingY: 'l',
        rows: stack([
          block('quote', {
            text: 'An orca surfaced between us and the cliffs and the master just took the engine out of gear. Twenty minutes. Nobody spoke.',
            attribution: 'Ruth Calder, Edinburgh',
            role: 'Faroe and Shetland, June 2026',
          }),
        ]),
      }),
      closing('Bring binoculars. We carry spares, but bring yours.'),
    ],
  );
}

export function foodAndForaging(): Page {
  return page(
    'Food and foraging',
    'food-and-foraging',
    {
      title: 'Food and foraging — Coastwise',
      description: 'Dinner is whatever came aboard that morning. How the galley works a coast, quay by quay.',
      noindex: false,
    },
    [
      banner(
        'Food and foraging',
        'There is no menu cycle. There is a chef, a coast, and whatever came over the rail that morning.',
        IMG.food,
        'Crates of produce handed aboard at a stone quay',
      ),
      sec({
        name: 'How dinner happens',
        paddingY: 'xl',
        reveal: true,
        rows: [
          row([
            col(55, [
              block('steps', {
                layout: 'down', marker: 'number', connector: true,
                items: [
                  { title: 'The quay, early', body: 'The chef is first down the gangway in every harbour. Langoustines at Tobermory, octopus at Vis, a cheese in Norway nobody can pronounce and everybody reorders.' },
                  { title: 'The galley, all day', body: 'One chef, one helper, eight tables. Bread proves while we sail. You will smell the day’s decision by eleven.' },
                  { title: 'The table, at eight', body: 'One sitting, no seating plan, the day’s catch and the day’s story. The wine list is short and right.' },
                ],
              }),
            ]),
            col(45, [
              block('image', { src: IMG.saloon, alt: 'The dining saloon at dusk', ratio: '4/5', fit: 'cover', radius: 'md' }),
            ]),
          ], 'xl'),
        ],
      }),
      sec({
        name: 'Guest words',
        tone: 'subtle',
        paddingY: 'l',
        rows: stack([
          block('quote', {
            text: 'The chef bought a box of chanterelles off two children in Geiranger and rewrote dinner on the spot. Best thing I ate all year.',
            attribution: 'Priya Nair, London',
            role: 'Norwegian Narrows, August 2025',
          }),
          block('tags', {
            style: 'bullets', size: 'm', colour: '', align: 'left',
            items: [
              { label: 'One sitting', href: '' },
              { label: 'Short wine list', href: '' },
              { label: 'Dietary needs fed properly', href: '' },
            ],
          }),
        ]),
      }),
      closing('Come hungry. Leave with a recipe you will never quite replicate.'),
    ],
  );
}

export function walkingAshore(): Page {
  return page(
    'Walking ashore',
    'walking-ashore',
    {
      title: 'Walking ashore — Coastwise',
      description: 'Proper walks from the waterline, graded honestly, with a ship to come home to.',
      noindex: false,
    },
    [
      banner(
        'Walking ashore',
        'The ship does the miles at sea so your boots can do the ones that matter ashore.',
        IMG.ashore,
        'Walkers on a coastal path above the anchorage',
      ),
      sec({
        name: 'The walks',
        paddingY: 'xl',
        reveal: true,
        rows: stack([
          block('text', {
            html:
              '<p>Every landing has a walk, every walk has a grade, and the grades are honest. A guide goes with every graded walk; the ungraded stroll to the pub needs no supervision and gets none. The ship moves round to meet you, so the good walks are one way.</p>',
          }),
          block('table', {
            headerRow: true, firstColumnHeader: true, style: 'lined', caption: 'A sample week of walks, Western Isles voyage.', textColour: '',
            data:
              'Walk\tGrade\tDistance\tThe reward\n' +
              'Tobermory lighthouse path\tEasy\t3 km\tThe town, the bay, and a dram at the end\n' +
              'Coll strand and machair\tEasy\t5 km\tA mile of white sand with nobody on it\n' +
              'Staffa clifftop circuit\tModerate\t4 km\tThe cave from above, puffins in June\n' +
              'Canna to Compass Hill\tModerate\t7 km\tThe Small Isles laid out like a chart\n' +
              'Harris, Rodel to Drinishader\tStrong\t12 km\tThe weaving sheds, and the east coast bays',
          }),
          block('tooltip', {
            text: 'How we grade',
            tip: 'Easy is under two hours on made paths. Moderate has climbs and rough ground. Strong is a full walking day and needs boots that have already been walked in.',
            position: 'above',
            align: 'left',
          }),
        ]),
      }),
      closing('Boots in the hold, dram in the saloon.'),
    ],
  );
}

export function privateCharter(): Page {
  return page(
    'Private charter',
    'private-charter',
    {
      title: 'Private charter — Coastwise',
      description: 'Take the whole ship: twenty-six to forty-four of your own people, one crew, your plan.',
      noindex: false,
    },
    [
      banner(
        'Private charter',
        'Twenty-six to forty-four of your own people, one ship, one crew, and a plan drawn round you.',
        IMG.charter,
        'The ship at anchor at dusk, lights on',
      ),
      sec({
        name: 'The ships',
        paddingY: 'xl',
        reveal: true,
        rows: stack([
          block('text', {
            html:
              '<p>A charter is not a cruise with your name on it. The route is drawn with you, the galley plans round your table, and the only fixed points are where we start, where we finish and how the tide runs. Families take Freya. Societies take Skua for the birds. Weddings, so far without exception, take Nyren.</p>',
          }),
          block('tabs', {
            style: 'underline', align: 'left', textColour: '',
            items: [
              { title: 'MV Freya · 38', body: 'The Scottish ship. Nineteen cabins, the snug library, and the only hull of the three strengthened for the Faroes run. From £41,000 for seven nights, whole ship, full board.' },
              { title: 'MV Skua · 26', body: 'The small one, and the quiet one. Thirteen cabins, a saloon that becomes one long table, and the shallowest draught in the fleet. From £34,000 for seven nights.' },
              { title: 'MV Nyren · 44', body: 'The warm-water ship. Twenty-two cabins, the stern platform and awning, and a galley built for long dinners. From £46,000 for seven nights.' },
            ],
          }),
          block('read-more', {
            html:
              '<p>The fine print, plainly: the fare covers ship, crew, full board and standard landings. Fuel is included up to 1,200 nautical miles a week, which no charter has yet exceeded. Harbour dues are at cost. The bar is stocked to your list and settled at the end. A provisional date holds for fourteen days while you gather your people, and the deposit is a fifth.</p><p>What we do not do: fireworks, jet skis, or eighteenth birthdays. The crew have veto over weather, always, everywhere. That veto is most of what you are paying for.</p>',
            lines: 3,
            moreLabel: 'The fine print',
            lessLabel: 'Enough',
            fade: true,
            align: 'left',
          }),
          block('button', { label: 'Start a charter conversation', href: 'mailto:charter@coastwise.example', variant: 'primary', size: 'm', align: 'left', newTab: false }),
        ]),
      }),
      closing('One ship, your people, and a coast to yourselves.'),
    ],
  );
}

/* ---------------------------------------------------------------- about */

export function about(): Page {
  return page(
    'The ships',
    'about',
    {
      title: 'The ships and the story — Coastwise',
      description: 'Three ships, one idea, sailing since 2011. Who we are and why the ships stay small.',
      noindex: false,
    },
    [
      banner(
        'Three ships, one idea',
        'Coastwise exists because two ferry officers kept a list of every harbour their employer was too big to enter. In 2011 they bought a ship that fitted.',
        IMG.harbour,
        'A west-coast harbour town seen from the water',
      ),
      sec({
        name: 'The story',
        paddingY: 'xl',
        reveal: true,
        rows: [
          row([
            col(55, [
              block('text', {
                html:
                  '<p>The first Freya was a Norwegian fjord ferry with thirty years of service and a hull like a bank vault. We spent a winter refitting her in Leith: nineteen cabins where the car deck was, a saloon where the cafeteria was, and the bridge left exactly as we found it, because it worked.</p>' +
                  '<p>The idea has not changed since. Buy sound working ships, refit them warm rather than grand, and keep them small enough that the plan can bend. Skua joined in 2014 for the narrow water. Nyren joined in 2019 for the warm.</p>' +
                  '<p>We are still run from a shed on Oban harbour, on purpose. The people who answer the phone can see the weather you are asking about.</p>',
              }),
            ]),
            col(45, [
              block('image', { src: IMG.deck, alt: 'Teak deck and brass, kept right', ratio: '4/5', fit: 'cover', radius: 'md' }),
            ]),
          ], 'xl'),
        ],
      }),
      sec({
        name: 'The years',
        tone: 'subtle',
        paddingY: 'xl',
        rows: stack([
          block('heading', { level: 'h2', html: 'Fifteen years, four decisions', align: 'left' }),
          block('steps', {
            layout: 'down', marker: 'number', connector: true,
            items: [
              { title: '2011 — Freya', body: 'The first ship, and the winter in Leith that set the pattern: warm, not grand.' },
              { title: '2014 — Skua', body: 'Twenty-six berths for the water Freya could not reach. The Norwegian arms became a voyage.' },
              { title: '2019 — Nyren', body: 'The warm-water ship. Dalmatia first, then the Lycian shore. The awning was her refit’s biggest single expense, and worth it.' },
              { title: '2024 — The refusal', body: 'We were offered a fourth ship, larger, at a good price. We said no. Thirty-eight guests is not a stage we are at. It is the idea.' },
            ],
          }),
        ]),
      }),
      sec({
        name: 'The numbers',
        paddingY: 'xl',
        rows: stack([
          block('stats', {
            columns: '4', size: 'l', align: 'centre', divided: true,
            items: [
              { value: '3', suffix: '', label: 'Ships, and no plans for four', detail: '' },
              { value: '108', suffix: '', label: 'Berths across the fleet', detail: '' },
              { value: '61', suffix: '%', label: 'Guests who have sailed before', detail: '' },
              { value: '2011', suffix: '', label: 'Sailing since', detail: '' },
            ],
          }),
        ]),
      }),
      sec({
        name: 'Guest words',
        tone: 'subtle',
        paddingY: 'l',
        rows: stack([
          block('quote', {
            text: 'It is the only holiday we take where the owner might carry your bag up the gangway and the master might pour your nightcap.',
            attribution: 'Alan and Josie Metcalfe, Kendal',
            role: 'Eleven voyages since 2015',
          }),
        ]),
      }),
      closing('The ships are small. The welcome is not.'),
    ],
  );
}

/* ----------------------------------------------------------------- team */

export function team(): Page {
  return page(
    'Our people',
    'team',
    {
      title: 'Our people — Coastwise',
      description: 'The masters, the galley and the shed on Oban harbour. The people a small ship actually runs on.',
      noindex: false,
    },
    [
      banner(
        'The people the ships run on',
        'Twelve crew to a ship, and a shed on Oban harbour. These are the ones you will meet first.',
        IMG.saloon,
        'The dining saloon at dusk',
      ),
      sec({
        name: 'The crew',
        paddingY: 'xl',
        hoverLift: true,
        reveal: true,
        revealStagger: true,
        rows: stack([
          block('cards', {
            source: 'typed', columns: '3', gap: 'm', style: 'bordered', imagePosition: 'top', lead: 'image',
            ratio: '4/5', radius: 'md', align: 'left', wholeCardLinks: false,
            items: [
              { src: IMG.crewMaster, icon: '', alt: 'Ewan MacAskill at the bridge window', label: 'Master, MV Freya', title: 'Ewan MacAskill', body: 'Twenty-six seasons in the Hebrides. Reads a sky faster than a forecast, and has been right more often than the forecast.', linkLabel: '', linkHref: '' },
              { src: IMG.crewMate, icon: '', alt: 'Ingrid Solheim on deck', label: 'Master, MV Skua', title: 'Ingrid Solheim', body: 'Grew up piloting her father’s fjord ferry. Knows which arms hold their glass at dusk, and anchors there.', linkLabel: '', linkHref: '' },
              { src: IMG.crewEngineer, icon: '', alt: 'Ante Kovačić in the engine room doorway', label: 'Master, MV Nyren', title: 'Ante Kovačić', body: 'Split-born, navy-trained. Swears the Adriatic has two hundred anchorages and has personally slept in ninety of them.', linkLabel: '', linkHref: '' },
              { src: IMG.crewChef, icon: '', alt: 'Marta Reid in the galley', label: 'Head of galley', title: 'Marta Reid', body: 'Cooked in two starred kitchens and left both for a galley with a view. First down the gangway in every harbour.', linkLabel: '', linkHref: '' },
              { src: IMG.crewGuide, icon: '', alt: 'Tom Ellery with binoculars', label: 'Naturalist', title: 'Tom Ellery', body: 'Sails every northern departure. Can tell a minke from a swell at a mile, and will wake you for it if you asked.', linkLabel: '', linkHref: '' },
              { src: IMG.crewPurser, icon: '', alt: 'Fiona Bell at the shed door', label: 'The shed, Oban', title: 'Fiona Bell', body: 'Answers the phone, holds the plan, and has re-routed more holidays around more weather than anyone afloat.', linkLabel: '', linkHref: '' },
            ],
          }),
        ]),
      }),
      sec({
        name: 'How we work',
        tone: 'subtle',
        paddingY: 'xl',
        rows: [
          row([
            col(33, [
              block('icon-item', { icon: 'compass', title: 'Masters decide', body: 'Weather calls are made on the bridge, never in the office. The office agrees with the bridge.', align: 'left' }),
            ]),
            col(33, [
              block('icon-item', { icon: 'heart', title: 'Crew stay', body: 'Most of the crew return season after season. Ask Marta about her ninth spring provisioning run.', align: 'left' }),
            ]),
            col(34, [
              block('icon-item', { icon: 'phone', title: 'A person answers', body: 'The shed keeps ship’s hours, seven days in season. You will not meet a phone menu.', align: 'left' }),
            ]),
          ], 'l'),
        ],
      }),
      closing('Come and meet the rest aboard.'),
    ],
  );
}

/* --------------------------------------------------------------- contact */

export function contact(): Page {
  return page(
    'Talk to us',
    'contact',
    {
      title: 'Talk to us — Coastwise',
      description: 'The shed on Oban harbour: phone, email, WhatsApp and the kettle. Ship’s hours, seven days in season.',
      noindex: false,
    },
    [
      banner(
        'Talk to us',
        'The shed on the North Pier, Oban. The people who answer can see the weather you are asking about.',
        IMG.harbour,
        'Oban harbour from the water',
      ),
      sec({
        name: 'Ways in',
        paddingY: 'xl',
        reveal: true,
        rows: [
          row([
            col(45, [
              block('heading', { level: 'h3', html: 'The shed', align: 'left' }),
              block('text', {
                html:
                  '<p>Coastwise Voyages Ltd<br />The Shed, North Pier<br />Oban PA34 5QD<br />Scotland</p>' +
                  '<p>Ship’s hours: eight until six, seven days, April to October. Winter, we keep office hours and one eye on the refit list.</p>',
              }),
              block('button-group', {
                align: 'left',
                buttons: [
                  { label: '+44 1631 500 000', href: 'tel:+441631500000', variant: 'secondary', newTab: false },
                  { label: 'hello@coastwise.example', href: 'mailto:hello@coastwise.example', variant: 'secondary', newTab: false },
                ],
              }),
              block('whatsapp', {
                phone: '+441631500000',
                message: 'Hello Coastwise. I am looking at a voyage and would like to ask about',
                label: 'WhatsApp the shed',
                look: 'button',
                corner: 'right',
                align: 'left',
              }),
            ]),
            col(55, [
              block('map', { address: 'North Pier, Oban PA34 5QD, Scotland', zoom: 15, height: 380, radius: 'md', caption: 'The shed is the one with the ensign.' }),
            ]),
          ], 'xl'),
        ],
      }),
      sec({
        name: 'Asked often',
        tone: 'subtle',
        paddingY: 'xl',
        rows: stack([
          block('heading', { level: 'h2', html: 'Asked often', align: 'left' }),
          block('accordion', {
            style: 'separated', single: true, openFirst: false, textColour: '',
            items: [
              { title: 'Can I hold a cabin while we decide?', body: 'Yes. A named cabin holds for seven days, no card required. Ring or WhatsApp and Fiona will do it while you are on the line.' },
              { title: 'Do you take solo travellers?', body: 'Gladly. Freya and Skua both carry true single cabins at a modest supplement, not a doubled fare. About a fifth of any sailing is travelling solo.' },
              { title: 'What about reduced mobility?', body: 'Honestly, ship by ship: Nyren has a lift and two step-free cabins; Freya and Skua are ships of stairs. Tell us what you need and we will tell you plainly which ship fits.' },
              { title: 'Is my money protected?', body: 'Yes. ABTA Y2841 for the sea, ATOL 11627 where we sell you the flight too. The deposit sits in trust until you sail.' },
            ],
          }),
        ]),
      }),
      closing('Or just ring. It is usually quicker.'),
    ],
  );
}

/* ----------------------------------------------------------------- terms */

export function terms(): Page {
  return page(
    'Booking terms',
    'terms',
    {
      title: 'Booking terms — Coastwise',
      description: 'The terms of carriage, in plain English first and full clauses second.',
      noindex: false,
    },
    [
      sec({
        name: 'Terms',
        width: 'narrow',
        paddingY: 'xl',
        rows: stack([
          block('breadcrumbs', { separator: 'slash', showHome: true, size: 's', align: 'left' }),
          block('heading', { level: 'h1', html: 'Booking terms', align: 'left' }),
          block('text', {
            html:
              '<p>The plain version first: you pay a fifth to book and the rest ten weeks out. If we cancel, you get everything back. If the weather rewrites the route, that is the nature of a coast and not a fault. Your money is protected the whole way: <b>ABTA Y2841</b>, <b>ATOL 11627</b>.</p>',
          }),
          block('tooltip', {
            text: 'What ATOL covers',
            tip: 'If we stop trading, the Civil Aviation Authority’s scheme refunds package bookings that include a flight, or brings you home if you are already away.',
            position: 'above',
            align: 'left',
          }),
          block('accordion', {
            style: 'separated', single: true, openFirst: true, textColour: '',
            items: [
              {
                title: '1. Booking and payment',
                body: 'A booking exists when we confirm it in writing and the deposit of 20 per cent has arrived. The balance is due 70 days before sailing. Book inside 70 days and the whole fare is due at once. A held cabin, uncommitted, lapses quietly after seven days.',
              },
              {
                title: '2. If you cancel',
                body: 'More than 70 days out you lose the deposit. Between 70 and 29 days, half the fare. Inside 28 days, the whole fare, because a small ship cannot resell a cabin the way an aeroplane resells a seat. Travel insurance exists for exactly this, and we will decline to confirm any booking that does not have it.',
              },
              {
                title: '3. If we cancel',
                body: 'If we cancel a voyage for any reason other than your non-payment, you choose: everything back, or any other sailing with a berth free, with any difference in fare refunded or waived. We do not cancel for weather. We re-route for weather, which is different, and covered next.',
              },
              {
                title: '4. Weather and the route',
                body: 'The itinerary is a plan, not a promise. The master may change the route, the order, the anchorages and the landings at any time for weather, tide or safety, and that judgement is final. No refund arises from a route changed at sea. In fifteen seasons no voyage has ever failed to sail; several have become better stories than the plan.',
              },
              {
                title: '5. Aboard',
                body: 'The master’s word is law on safety matters, the bridge is open at the master’s pleasure, and a guest whose conduct endangers the ship or wrecks the peace of it can be landed at the next port, fare forfeit. It has happened twice in fifteen years. Both times everyone else applauded.',
              },
              {
                title: '6. Your protection',
                body: 'Sea-only fares are protected by ABTA bond Y2841. Packages that include flights are protected under ATOL 11627. Deposits sit in a client trust account until the voyage sails. The contract is with Coastwise Voyages Ltd, registered in Scotland, and Scots law applies.',
              },
              {
                title: '7. The demonstration note',
                body: 'This is a Travelgenix demonstration site. Coastwise is a concept brand: the ships, fares, reviews and these terms are illustrative, written to show how a real operator’s site can carry real terms plainly.',
              },
            ],
          }),
          block('button', { label: 'Ask about a clause', href: '/contact', variant: 'secondary', size: 'm', align: 'left', newTab: false }),
        ]),
      }),
    ],
  );
}

/* ------------------------------------------------------------- the export */

export function pages(): Page[] {
  return [
    home(),
    destinationsIndex(),
    westernIsles(),
    norwegianNarrows(),
    dalmatianBackwater(),
    faroeShetland(),
    lycianShore(),
    holidaysIndex(),
    islandHopping(),
    wildlifeAtSea(),
    foodAndForaging(),
    walkingAshore(),
    privateCharter(),
    about(),
    team(),
    contact(),
    terms(),
  ];
}

/** Which pages sit inside which folder, for parent_id at seed time. */
export const FOLDERS: Record<string, string[]> = {
  destinations: ['western-isles', 'norwegian-narrows', 'dalmatian-backwater', 'faroe-and-shetland', 'lycian-shore'],
  holidays: ['island-hopping', 'wildlife-at-sea', 'food-and-foraging', 'walking-ashore', 'private-charter'],
};

export function regions(): Record<string, { sections: Section[] }> {
  return { header: header(), footer: footer() };
}
