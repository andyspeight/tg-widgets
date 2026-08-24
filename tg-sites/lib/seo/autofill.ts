/**
 * Filling in a page's search listing for a client who would not have.
 *
 * WHAT THIS IS FOR. lib/seo/audit.ts checks a page and reports what is wrong
 * with it, which is the right thing to show somebody who knows what a meta
 * description is. Andy's clients are travel agents. A report that says "this
 * page has no search description" to somebody who does not know what one is, or
 * where to put it, is a list of homework rather than help.
 *
 * So of the audit's findings, the ones that are honest DERIVATIONS of content
 * the page already carries get written for the client. The title and the
 * description both are: the page's own words already say what it is about, and
 * turning those into one line and one sentence is a job a model does well.
 *
 * WHAT IS DELIBERATELY NOT AUTOMATED, and this is the important half. The audit
 * also reports thin content, missing headings, no questions answered and no
 * company profile. None of those can be derived from anything: writing them
 * would mean inventing claims about a real business, which is the one thing this
 * product must never do. They stay as findings on the /seo screen for a human.
 *
 * BLANKS ONLY, NEVER AN OVERWRITE. A client who wrote a poor title owns it and
 * may have reasons; a client who wrote nothing gets help. That rule is also what
 * makes the whole feature safe to run automatically: the worst it can do is fill
 * an empty field, and the client is shown what it wrote and can change it.
 */

import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX, TITLE_MIN } from './audit';
import type { Page } from '../content/schema';

/** What a page is missing that we can honestly write for it. */
export interface SeoGaps {
  title: boolean;
  description: boolean;
}

export function hasGap(gaps: SeoGaps): boolean {
  return gaps.title || gaps.description;
}

/**
 * What is blank on this page.
 *
 * A NOINDEX PAGE HAS NO GAPS. It has been hidden from search on purpose, so
 * writing it a search listing is work nobody asked for on a page nobody will
 * see. The audit takes the same view and stops at the same place.
 *
 * The page's own NAME is not a search title. It is what the client called the
 * page in their sidebar ("Contact", "About us"), which is a label rather than
 * the line somebody clicks in a result. So a page with a name and no search
 * title still has a gap.
 */
export function seoGaps(page: Page): SeoGaps {
  const seo = page.seo ?? { noindex: false };
  if (seo.noindex) return { title: false, description: false };

  return {
    title: (seo.title ?? '').trim() === '',
    description: (seo.description ?? '').trim() === '',
  };
}

/** What the writer came back with, before it has been checked. */
export interface SeoWritten {
  title?: string;
  description?: string;
}

/**
 * One line of a model's answer, made safe to store.
 *
 * A MODEL RETURNS PROSE AND THIS FIELD IS NOT PROSE. Quotation marks around the
 * whole answer, a trailing full stop on a title, a "Title:" label it repeated
 * back, and newlines from a model that decided to explain itself all have to go,
 * because what survives here is what appears in Google under the client's name.
 *
 * TRUNCATED AT A WORD, never mid-word. A description cut to exactly 160
 * characters ends "…and everything carried betwe", which is worse than the
 * shorter sentence. The cap is the schema's, and the audit's own MAX is the
 * target, so what we write passes the check that asked for it.
 */
function tidy(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';

  let text = raw
    .replace(/\s+/g, ' ')
    .trim()
    // A label the model repeated back at us.
    .replace(/^(?:search\s+)?(?:title|description|meta\s+description)\s*[:–-]\s*/i, '')
    .trim();

  // Matching quotes around the whole answer, of either kind.
  if (text.length > 1 && /^["'“‘]/.test(text) && /["'”’]$/.test(text)) {
    text = text.slice(1, -1).trim();
  }

  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * The writer's answer, checked.
 *
 * TOO SHORT IS DROPPED RATHER THAN STORED. A model that answers "Holidays" has
 * not written a title, it has failed, and storing it would satisfy the blank
 * while leaving the client worse off than the honest empty field the audit would
 * have flagged. The floors are the audit's own, so anything kept here passes the
 * check that sent us.
 */
export function cleanWritten(raw: unknown): SeoWritten {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out: SeoWritten = {};

  const title = tidy(source.title, TITLE_MAX);
  if (title.length >= TITLE_MIN) out.title = title;

  const description = tidy(source.description, DESCRIPTION_MAX);
  if (description.length >= DESCRIPTION_MIN) out.description = description;

  return out;
}

/** What was actually filled, for the panel that tells the client. */
export interface SeoFilled {
  title?: string;
  description?: string;
}

/**
 * The page with its blanks filled, and what was filled.
 *
 * Returns the SAME page object when nothing was written, so the caller can skip
 * the save entirely rather than storing a page identical to the one it had.
 */
export function applySeoFill(page: Page, written: SeoWritten): { page: Page; filled: SeoFilled } {
  const gaps = seoGaps(page);
  const filled: SeoFilled = {};

  if (gaps.title && written.title) filled.title = written.title;
  if (gaps.description && written.description) filled.description = written.description;

  if (!filled.title && !filled.description) return { page, filled };

  return {
    page: {
      ...page,
      seo: {
        ...(page.seo ?? { noindex: false }),
        ...(filled.title ? { title: filled.title } : {}),
        ...(filled.description ? { description: filled.description } : {}),
      },
    },
    filled,
  };
}

/** Whether anything was written, for a caller deciding whether to say so. */
export function wasFilled(filled: SeoFilled): boolean {
  return Boolean(filled.title || filled.description);
}

export { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX, TITLE_MIN };
