/**
 * Words, as the unit a heading arrives in and the unit the pointer finds.
 *
 * WHY (React Bits review, 15 Sep 2026, slice 3). The one thing on a hero that
 * never moved was the headline: a section's reveal lifts whole blocks, and S1
 * lifts blocks too. Split Text, Blur Text and the rest of the library's text
 * animations all rest on one move, wrapping each word (or letter) in its own
 * element so the stylesheet can stagger them. This is that move, done once, on
 * the server, over the SANITISED markup, so a heading with a bold word or a link
 * in it keeps both.
 *
 * A TOKENISER, NOT A PARSER. The markup this runs over has already been through
 * sanitiseHtml, so it holds only the inline tags that allows and no scripts,
 * comments or attributes with angle brackets in them. Tags are copied through
 * untouched; only the text between them is split, on whitespace, with the
 * whitespace itself kept as plain text so the words still wrap where they did.
 * An entity (&amp;) is never split inside, and in letters mode it is one letter.
 *
 * THE INNER SPAN is what lets a word rise out of a mask: the outer span clips,
 * the inner one moves. Every mode gets the same shape so the stylesheet has one
 * structure to address.
 *
 * ACCESSIBILITY. Words stay inline text a screen reader runs together as it
 * always did. Letters are the exception (some readers announce each element),
 * so the render puts the plain words in aria-label on the heading and hides the
 * split copy; plainText below is what it uses.
 */

import { escapeHtml } from './sanitise';

export type SplitMode = 'words' | 'letters';

export interface Split {
  /** The markup with every word (or letter) wrapped, counted with --i. */
  html: string;
  /** How many pieces were counted, so a stagger can be scaled. */
  count: number;
}

/** A tag, or a run of text between tags. */
const TOKENS = /<[^>]*>|[^<]+/g;
/** An entity as one unit, otherwise one code point. */
const UNITS = /&[#a-zA-Z0-9]+;|./gsu;

/** Past this many letters a heading arrives word by word instead: a paragraph of letters is a wall of spans. */
export const LETTERS_CAP = 120;

/** Where a heading's turning word goes. The same double-brace shape the loop's tokens use. */
export const TURN_TOKEN = '{{turn}}';

export function splitWords(html: string, mode: SplitMode = 'words'): Split {
  let out = '';
  let count = 0;
  for (const match of html.matchAll(TOKENS)) {
    const piece = match[0];
    if (piece.startsWith('<')) {
      out += piece;
      continue;
    }
    for (const part of piece.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        out += part;
        continue;
      }
      if (mode === 'letters' && !part.includes(TURN_TOKEN)) {
        const letters = (part.match(UNITS) ?? [])
          .map((unit) => `<span class="tgs-l" style="--i:${count++}">${unit}</span>`)
          .join('');
        out += `<span class="tgs-w">${letters}</span>`;
      } else {
        out += `<span class="tgs-w" style="--i:${count++}"><span class="tgs-wi">${part}</span></span>`;
      }
    }
  }
  return { html: out, count };
}

/** The words of some markup, tags dropped, whitespace collapsed, for an aria-label. */
export function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The turning words a client typed, one per line or comma separated: trimmed,
 * escaped, at most six, each at most forty characters. Six because the cycle is
 * 2.6 seconds a word and a visitor will not wait sixteen seconds to see the last
 * one; forty because a turning word is a destination, not a sentence.
 */
export function parseTurns(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,]+/)
    .map((word) => word.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => escapeHtml(word));
}

/**
 * The turning word's markup: the words stacked in one inline grid cell, so the
 * heading is as wide as its longest word and never jumps as they change. The
 * first is the one a screen reader gets; the rest are hidden from it, since
 * "Holidays to Greece Italy Portugal" is not the sentence.
 */
export function turnMarkup(words: readonly string[]): string {
  const inner = words
    .map((word, index) =>
      `<span class="tgs-turn__word" style="--i:${index}"${index > 0 ? ' aria-hidden="true"' : ''}>${word}</span>`)
    .join('');
  return `<span class="tgs-turn" data-count="${words.length}" style="--n:${words.length}">${inner}</span>`;
}

/**
 * Put the turning words into a heading: at the token if the client typed one,
 * otherwise after the heading's words. With one word there is nothing to turn,
 * so it simply stands where the token was; with none the token is dropped, so a
 * marker a client left in by mistake never reaches the page.
 */
export function withTurns(html: string, words: readonly string[]): string {
  const at = html.indexOf(TURN_TOKEN);
  if (words.length >= 2) {
    const markup = turnMarkup(words);
    return at === -1 ? `${html} ${markup}` : html.slice(0, at) + markup + html.slice(at + TURN_TOKEN.length);
  }
  const single = words[0] ?? '';
  return at === -1 ? html : html.slice(0, at) + single + html.slice(at + TURN_TOKEN.length);
}
