import { createBlock, createSection } from './factory';
import { emptyItem, type CollectionItem } from './collection';
import { escapeHtml } from './sanitise';

/**
 * Turning a corpus record into the client's own page.
 *
 * ADOPTION HAPPENS ONCE AND THEN STOPS MATTERING. What this builds is a SEED:
 * a first draft in the client's collection that they then rewrite, restructure
 * and publish as theirs. No later sync touches any of it. That is the whole
 * point of the split described at the top of reference.ts, and it is why this
 * module deliberately produces something plain. A seed that arrived beautifully
 * art-directed would be a seed nobody edits, and forty agencies would publish
 * the same page again, which is the outcome the design exists to prevent.
 *
 * THE FACTS ARE NOT IN HERE. They live on the corpus row the item points at,
 * through the ref_kind and ref_source_id columns from migration 0029, and the
 * renderer joins them at read time. So this function is only ever concerned
 * with words, and it cannot accidentally freeze a visa rule into a client's
 * page.
 */

/** The seedable prose an exported corpus record carries. */
export interface CorpusProse {
  tagline?: string;
  heroIntro?: string;
  overview?: string;
}

/**
 * Corpus text, ready to sit inside a block's `html` prop.
 *
 * ESCAPED, NOT SANITISED, AND THE DIFFERENCE MATTERS. The prose is plain text
 * written by a person into an Airtable cell, and it reaches this process over
 * the network from another deployment. It is not markup and was never meant to
 * be, so the right treatment is to make it inert rather than to decide which of
 * its tags are permissible. An ampersand in "Sun & Sand" must survive as an
 * ampersand; anything that looks like a tag must arrive as the characters
 * somebody typed. sanitiseHtml would do the opposite job, keeping markup it
 * recognised, which is the wrong answer for a field that should contain none.
 *
 * Blank lines become paragraph breaks, because that is how the prose is written
 * and a wall of text is not what the author meant.
 */
export function proseToHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/\r\n?/g, '\n').trim();
  if (!clean) return '';

  return clean
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    // A single newline inside a paragraph is a soft wrap in the source, not a
    // new paragraph, so it becomes a space rather than a <br>.
    .map((para) => `<p>${escapeHtml(para.replace(/\n/g, ' '))}</p>`)
    .join('');
}

function textBlock(html: string) {
  const block = createBlock('text');
  block.props = { ...block.props, html };
  return block;
}

/**
 * The first draft of an adopted destination.
 *
 * NO HEADING BLOCK ON PURPOSE. The entry page already renders the item's title
 * above the sections, so a heading carrying the same words would publish the
 * place name twice. The lead paragraph is the hero intro and the body is the
 * overview, which is the order they were written to be read in.
 *
 * A record with no prose at all still produces a valid item rather than an
 * empty one that looks broken in the editor: the client gets a page with their
 * title and the facts panel, and writes the words themselves. That is a
 * legitimate outcome for an airport, which the corpus holds no overview for.
 */
export function seedItemFromCorpus(input: {
  name: string;
  prose?: CorpusProse;
}): CollectionItem {
  const prose = input.prose ?? {};
  const lead = proseToHtml(prose.heroIntro);
  const body = proseToHtml(prose.overview);

  const blocks = [lead, body].filter(Boolean).map(textBlock);

  const sections = [];
  if (blocks.length > 0) {
    const section = createSection('1');
    section.rows[0].columns[0].blocks = blocks;
    sections.push(section);
  }

  return {
    ...emptyItem(),
    title: input.name.trim().slice(0, 200) || 'Untitled',
    /*
     * The tagline is the card line and the search description, which is what
     * summary is for. Trimmed to the schema's own limit here rather than left
     * to be truncated on the way in, so what the client sees in the editor is
     * what was stored rather than a longer string that quietly lost its end.
     */
    summary: typeof prose.tagline === 'string' ? prose.tagline.trim().slice(0, 400) : '',
    sections,
  };
}
