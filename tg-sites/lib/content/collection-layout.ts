/**
 * How a collection's published entries are laid out.
 *
 * ONE CHOICE PER COLLECTION, so a Blog can read like an article and a Tours
 * collection like a product page on the same site. See migration 0026 for why
 * it lives on the collection rather than in site settings or on each entry.
 *
 * THE THREE ARE STRUCTURALLY DIFFERENT, not three paddings. Standard is what
 * every site already has. Centred narrows the measure and centres the header,
 * which is the arrangement a long read wants. Hero leads with the picture at
 * full width and puts the title on it, which is what a tour or a destination
 * wants and what an article does not.
 *
 * TOTAL, like parseTheme and parseFieldDefs: anything this code has not heard
 * of, an empty string included, is the standard layout. That is what lets the
 * column default to '' with nothing backfilled, and it means a value written by
 * a newer deploy degrades to the safe look rather than to a blank page.
 */

export const ENTRY_LAYOUTS = ['standard', 'centred', 'hero'] as const;

export type EntryLayout = (typeof ENTRY_LAYOUTS)[number];

/** What each one is called in front of a client, and what it is for. */
export const ENTRY_LAYOUT_LABEL: Record<EntryLayout, string> = {
  standard: 'Standard',
  centred: 'Centred article',
  hero: 'Picture first',
};

export const ENTRY_LAYOUT_HINT: Record<EntryLayout, string> = {
  standard: 'The date, the title and the summary, then the picture. What every entry looks like today.',
  centred: 'A narrower column and a centred opening. Best for something somebody sits down to read.',
  hero: 'The picture fills the top with the title over it. Best for a tour or a destination.',
};

export function parseEntryLayout(value: unknown): EntryLayout {
  return typeof value === 'string' && (ENTRY_LAYOUTS as readonly string[]).includes(value)
    ? (value as EntryLayout)
    : 'standard';
}
