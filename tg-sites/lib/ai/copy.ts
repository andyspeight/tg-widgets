/**
 * Turning what the model said into something that can go on a page.
 *
 * THE OUTPUT BOUNDARY. The prompt asks for plain copy and the model almost always
 * gives plain copy, and neither of those is a reason to trust what arrives. The
 * prompt has a client's own writing in it, changing what the model says is the
 * entire point of a prompt injection, and the answer is about to be put into a
 * contentEditable on a page somebody will publish.
 *
 * So the rule here is the same one the widget suite has followed for years: the
 * text is ESCAPED FIRST and the tags are added by us afterwards. Nothing that
 * arrived as a character ever reaches the page as markup. Even if the model were
 * talked into returning a script tag verbatim, it lands as visible words in a
 * paragraph, which is a bad sentence somebody deletes rather than an incident.
 *
 * sanitiseHtml runs over the result anyway. That is belt and braces on purpose:
 * this file builds the string, and a mistake in this file should still be caught
 * by the thing every other route into a page already goes through.
 *
 * WHY BULLETS ARE UNDERSTOOD AND NOTHING ELSE IS
 *
 * The prompt says no markdown. The model mostly obeys and occasionally starts a
 * list with a hyphen, because "give me three reasons to book with us" is a list
 * and it wants to be one. Stripping the hyphen turns that into three orphan lines
 * on the page, which is worse than either honouring it or leaving it alone.
 *
 * So lists are read, and that is where it stops. Bold, italics, links, headings
 * and tables are not, because each is another parser, and the fix for a model
 * emitting them is the prompt rather than more code here. Stray ** markers are
 * removed rather than converted, for the same reason.
 */

import { escapeHtml, sanitiseHtml } from '../content/sanitise';

/** The most paragraphs worth accepting from one answer. */
const MAX_BLOCKS = 40;

/**
 * What the toolbar needs, both ways.
 *
 * Two shapes rather than one, because the editor has two kinds of host. A text
 * block takes HTML. A heading is marked data-rt-plain and takes text only, so
 * handing it HTML would put visible angle brackets in a heading.
 */
export interface Copy {
  /** Ready to insert into a rich text host. */
  html: string;
  /** The same words with no markup, for a heading or a plain field. */
  text: string;
}

/**
 * The residue of markdown the prompt asked the model not to use.
 *
 * Emphasis markers only. Removing the characters leaves the words, which is the
 * right failure: "our **best** trips" becomes "our best trips" rather than losing
 * the word or showing the asterisks.
 */
function tidy(line: string): string {
  return line
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // A heading marker at the start of a line. The intent decides what element
    // this becomes, not the model.
    .replace(/^#{1,6}\s+/, '')
    .trim();
}

/** A line that is trying to be a bullet, and the text of it. */
function bullet(line: string): string | null {
  const match = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.*)$/.exec(line);
  return match ? match[1].trim() : null;
}

/**
 * Plain text from the model, as paragraphs and lists.
 *
 * Blank lines separate blocks, which is how the model writes when it is told to
 * answer in paragraphs. A single newline inside a block is treated as a line
 * break rather than a new paragraph, because that is usually a wrapped line.
 */
export function toHtml(input: unknown): string {
  const text = typeof input === 'string' ? input : '';
  if (!text.trim()) return '';

  const blocks: string[] = [];
  let list: string[] = [];

  const closeList = () => {
    if (list.length === 0) return;
    blocks.push(`<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const raw of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    if (blocks.length >= MAX_BLOCKS) break;

    const lines = raw.split('\n').map(tidy).filter(Boolean);
    if (lines.length === 0) continue;

    /*
     * A block is a list when EVERY line in it is a bullet. Mixed blocks are left
     * as prose: a paragraph that happens to start with a dash is a paragraph, and
     * guessing wrong turns somebody's sentence into a one-item list.
     */
    const bullets = lines.map(bullet);
    if (bullets.every((item) => item !== null)) {
      list.push(...(bullets as string[]));
      continue;
    }

    closeList();
    blocks.push(`<p>${lines.map(escapeHtml).join('<br />')}</p>`);
  }

  closeList();

  // Belt and braces. This file already escaped everything; the sanitiser is what
  // every other route into a page goes through, and this one should too.
  return sanitiseHtml(blocks.join(''));
}

/**
 * The same answer with no markup at all, for a heading.
 *
 * Not htmlToText(toHtml(text)), which would be a round trip through markup to
 * arrive back where it started. The bullet and emphasis markers still come off,
 * because a heading reading "- Greece and Cyprus" is the same bug in a different
 * element.
 *
 * ANYTHING TAG-SHAPED IS REMOVED RATHER THAN ESCAPED, which is the one real
 * difference from toHtml. This goes into a heading, and a heading is words. The
 * caller inserts it as text so a tag could not run either way, and that is not the
 * reason: this was found by a test asserting the sentence above, back when the
 * function only took the markers off and a heading could come back reading
 * "<script>fetch(...)</script>". Escaping would have made that safe and still
 * absurd.
 */
export function toText(input: unknown): string {
  const text = typeof input === 'string' ? input : '';
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => bullet(line) ?? tidy(line))
    .filter(Boolean)
    .join(' ')
    // Tag-shaped runs out, then the whitespace they leave behind.
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^\s]*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toCopy(input: unknown): Copy {
  return { html: toHtml(input), text: toText(input) };
}
