/**
 * Turning the content model into words an agent would use.
 *
 * The model has sections, rows, columns and blocks. A travel agent has a
 * page with parts on it, and some of those parts sit side by side. This
 * module is the whole of the translation, in one place, so the outline and
 * the properties pane can never disagree about what something is called.
 */

import type { Page, Section, Tone } from './schema';

export const TONE_WORDS: Record<Tone, string> = {
  light: 'White',
  subtle: 'Tinted',
  dark: 'Dark',
  accent: 'Brand',
};

/**
 * Name a section the way its owner would.
 *
 * Their own name wins. Failing that, borrow the first heading on it, which
 * is almost always what they would have called it anyway. Only fall back to
 * a number when the section has nothing to borrow from.
 */
export function sectionName(section: Section, index: number): string {
  if (section.name?.trim()) return section.name.trim();

  // Prefer the top-level heading over the first one in document order. A
  // hero usually opens with a small eyebrow ("Tailor-made travel") above the
  // real title ("Greece, planned properly"), and the title is the one they
  // would recognise in a list.
  let fallback = '';

  for (const row of section.rows) {
    for (const column of row.columns) {
      for (const block of column.blocks) {
        if (block.type !== 'heading') continue;
        const text = typeof block.props?.text === 'string' ? block.props.text.trim() : '';
        if (!text) continue;
        if (block.props?.level === 'h2') return text;
        if (!fallback) fallback = text;
      }
    }
  }

  return fallback || `Section ${index + 1}`;
}

/** Blocks in a section, for the collapsed summary. */
export function contentCount(section: Section): number {
  let total = 0;
  for (const row of section.rows) {
    for (const column of row.columns) total += column.blocks.length;
  }
  return total;
}

const COLUMN_COUNT_WORDS = [
  '',
  'Full width',
  'Two columns',
  'Three columns',
  'Four columns',
  'Five columns',
  'Six columns',
];

export function layoutWords(section: Section): string {
  if (section.rows.length === 0) return 'Empty';
  const widest = Math.max(...section.rows.map((row) => row.columns.length));
  return COLUMN_COUNT_WORDS[widest] ?? `${widest} columns`;
}

/** "Left" beats "Column 1" every time. */
export function columnWord(index: number, count: number): string {
  if (count === 2) return index === 0 ? 'Left' : 'Right';
  if (count === 3) return ['Left', 'Middle', 'Right'][index] ?? `Column ${index + 1}`;
  return `Column ${index + 1}`;
}

/** Name a section by its position in the page, for the properties header. */
export function sectionNameAt(page: Page, index: number): string {
  const section = page.sections[index];
  return section ? sectionName(section, index) : `Section ${index + 1}`;
}
