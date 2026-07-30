/**
 * In-memory stand-ins for the media actions, for the standalone build only.
 *
 * THIS IS A TEST DOUBLE, NOT A SECOND IMPLEMENTATION. Nothing in the app imports
 * it. The picker is unchanged: it calls the same functions with the same
 * signatures and gets the same shapes back, and the `satisfies` clauses at the
 * bottom are what make that a checked claim rather than a hope.
 *
 * WHY IT IS WORTH HAVING FOR THIS FEATURE IN PARTICULAR
 *
 * The two services behind the real actions are both unreachable from the
 * environment this was built in: blob.vercel-storage.com and api.pexels.com are
 * refused by the egress policy. So the picker could not be opened in a browser at
 * all without these, and "it compiles" would have been the whole of the evidence.
 *
 * With them, the tab switching, the grid, the empty state, the confirm dialog, the
 * credit lines, the focus trap and every one of the two unconfigured panels can be
 * driven in a real browser. What still cannot be exercised here is the upload
 * itself and a live search, and those are named in the handover rather than
 * quietly counted as covered.
 *
 * The photographs below are the only fiction. They are data URIs, because the
 * standalone file runs from a static host with no network: a remote image would
 * show as a broken tile and read as a bug in the grid.
 */

import type { MediaItem, StockPhoto } from '../lib/media/types';

/**
 * A flat coloured square as a data URI, via an SVG.
 *
 * Small enough that forty of them do not bloat the file, and distinguishable
 * enough that "the tiles are in the wrong order" is something a person can see.
 */
function swatch(colour: string, label: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">` +
    `<rect width="400" height="300" fill="${colour}"/>` +
    `<text x="200" y="160" font-family="sans-serif" font-size="26" fill="#ffffff" ` +
    `text-anchor="middle">${label}</text></svg>`;
  // encodeURIComponent rather than base64: it stays readable in a diff, and an SVG
  // is text.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

let sequence = 0;

function item(partial: Partial<MediaItem> & { filename: string; url: string }): MediaItem {
  sequence += 1;
  return {
    id: `demo-media-${sequence}`,
    storageKey: `sites/demo/media/${partial.filename}`,
    mime: 'image/jpeg',
    bytes: 240_000,
    width: 2400,
    height: 1600,
    alt: '',
    source: 'upload',
    credit: {},
    // A fixed date, so a rebuild produces the same file. The build is compared
    // byte for byte by tools/verify-standalone.mjs.
    createdAt: new Date('2026-07-30T09:00:00Z'),
    ...partial,
  };
}

const bank: MediaItem[] = [
  item({
    filename: 'santorini-terrace.jpg',
    url: swatch('#1b6ca8', 'Santorini'),
    alt: 'A whitewashed terrace above the caldera at Santorini',
  }),
  item({
    filename: 'amalfi-steps.jpg',
    url: swatch('#0f7b6c', 'Amalfi'),
    alt: 'Steps down to the harbour at Amalfi',
  }),
  // Deliberately without alt text, so the "No description" warning in the grid is
  // visible in a review copy rather than being something nobody ever sees.
  item({ filename: 'hotel-pool.jpg', url: swatch('#8a5a2b', 'Pool'), bytes: 1_120_000 }),
  item({
    filename: 'dubai-skyline.jpg',
    url: swatch('#5b3a89', 'Dubai'),
    source: 'pexels',
    alt: 'The Dubai skyline at dusk',
    credit: {
      photographer: 'Jean-Luc Le Roux',
      photographerUrl: 'https://www.pexels.com/@jean-luc',
      providerUrl: 'https://www.pexels.com/photo/1004014/',
      providerId: '1004014',
    },
  }),
];

const PALETTE = ['#1b6ca8', '#0f7b6c', '#8a5a2b', '#5b3a89', '#a83e3e', '#2f6f4f'];

function stock(index: number): StockPhoto {
  const id = String(9000 + index);
  return {
    id,
    thumbUrl: swatch(PALETTE[index % PALETTE.length], `Photo ${index + 1}`),
    fullUrl: swatch(PALETTE[index % PALETTE.length], `Photo ${index + 1}`),
    width: 1880,
    height: 1300,
    description: `A demonstration photograph, number ${index + 1}`,
    credit: {
      providerId: id,
      photographer: `Photographer ${index + 1}`,
      photographerUrl: 'https://www.pexels.com/@someone',
      providerUrl: `https://www.pexels.com/photo/${id}/`,
    },
    averageColour: PALETTE[index % PALETTE.length],
  };
}

// ---------------------------------------------------------------------------

export async function loadMediaAction(offset = 0) {
  return {
    ok: true as const,
    data: {
      items: bank.slice(offset, offset + 48),
      hasMore: false,
      canUpload: true,
      canSearchStock: true,
      uploadPrefix: 'sites/demo/media/',
    },
  };
}

/**
 * There is no store to upload to, so this says so rather than pretending.
 *
 * A double that returned a fake success would make the standalone file claim a
 * capability it does not have, and somebody reviewing it would report the missing
 * picture afterwards as a bug.
 */
export async function recordUploadAction() {
  return {
    ok: false as const,
    error:
      'This is the review copy, which has no storage attached, so an upload cannot be saved. ' +
      'Everything else in this dialog is the real thing.',
  };
}

export async function searchStockAction(input: {
  query?: string;
  page?: number;
  orientation?: string | null;
}) {
  const page = Math.max(1, Number(input?.page ?? 1));
  // A query nobody could match, so the empty state is reachable in a review copy.
  const empty = String(input?.query ?? '').trim().toLowerCase() === 'nothing';

  return {
    ok: true as const,
    data: {
      photos: empty ? [] : Array.from({ length: 12 }, (_, i) => stock((page - 1) * 12 + i)),
      page,
      hasMore: page < 3,
      total: empty ? 0 : 36,
      alreadyImported: ['9001'],
    },
  };
}

export async function importStockAction(photo: StockPhoto) {
  const added = item({
    filename: `${photo.description.slice(0, 24)}.jpg`,
    url: photo.fullUrl,
    alt: photo.description,
    source: 'pexels',
    credit: photo.credit,
  });
  bank.unshift(added);
  return { ok: true as const, data: added };
}

export async function setMediaAltAction(id: string, alt: string) {
  const found = bank.find((entry) => entry.id === id);
  if (!found) return { ok: true as const, data: null };
  found.alt = alt;
  return { ok: true as const, data: { ...found } };
}

export async function deleteMediaAction(id: string) {
  const index = bank.findIndex((entry) => entry.id === id);
  if (index < 0) return { ok: false as const, error: 'That image is not in your library.' };
  bank.splice(index, 1);
  return { ok: true as const, data: { id } };
}

// ---------------------------------------------------------------------------

/*
 * Compile-time proof that the doubles still match the real thing.
 *
 * If a real action gains an argument, loses one, or changes its return type, this
 * file stops building and the standalone review copy cannot drift into testing a
 * different interface from the one that ships.
 */
import type * as real from '../app/actions/media';

const _load = loadMediaAction satisfies typeof real.loadMediaAction;
const _record = recordUploadAction satisfies (...args: Parameters<typeof real.recordUploadAction>) =>
  ReturnType<typeof real.recordUploadAction>;
const _search = searchStockAction satisfies typeof real.searchStockAction;
const _import = importStockAction satisfies typeof real.importStockAction;
const _alt = setMediaAltAction satisfies typeof real.setMediaAltAction;
const _delete = deleteMediaAction satisfies typeof real.deleteMediaAction;

void _load;
void _record;
void _search;
void _import;
void _alt;
void _delete;
