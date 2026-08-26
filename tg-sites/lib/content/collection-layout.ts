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

/**
 * Does this entry open with a banner of its own?
 *
 * WHY THE HEADER HAS TO BE ABLE TO STAND DOWN, and why this mirrors
 * hasBreadcrumbsBlock rather than inventing a mechanism.
 *
 * An entry's header is blog furniture: a title, a byline, a reading time and a
 * summary, drawn from the row rather than from the content. That is right for a
 * post and wrong for a destination page built to sit beside hand-built pages on
 * the same site, where every one of those opens with a banner SECTION carrying
 * its own breadcrumbs, an h1-styled heading block and one line of copy. Drawn
 * together you get both: the site's banner, and above it a bare title in a
 * different type treatment, a stray breadcrumb trail and the words "3 min read"
 * on a page about an island.
 *
 * So the content can take the job over, exactly as a breadcrumbs block takes the
 * trail over from the automatic one.
 *
 * THE TELL IS AN H1-STYLED HEADING IN THE FIRST SECTION. Not the background
 * picture, which was the first rule here and was wrong: a destination the corpus
 * holds no photograph for still opens with a banner, and it would have kept the
 * blog header and its reading time. The h1 is the honest signal, because the
 * header exists to supply the page's h1 and nothing else on an entry does. A
 * client who puts an h1 in their own opening section has likewise made their own
 * opening, and drawing the header over it would be the same mistake.
 */
export function carriesOwnBanner(tree: { sections?: unknown } | null | undefined): boolean {
  const sections = (tree as { sections?: unknown[] } | null)?.sections;
  if (!Array.isArray(sections) || sections.length === 0) return false;

  const first = sections[0] as {
    rows?: Array<{ columns?: Array<{ blocks?: unknown[] }> }>;
  };

  return (first?.rows ?? []).some((row) =>
    (row.columns ?? []).some((column) =>
      (column.blocks ?? []).some((block) => {
        const b = block as { type?: unknown; props?: { style?: unknown } };
        return b?.type === 'heading' && b?.props?.style === 'h1';
      }),
    ),
  );
}
