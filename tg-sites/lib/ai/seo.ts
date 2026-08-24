import 'server-only';

/**
 * Writing a page's search listing from the page itself.
 *
 * The title and the description are the two lines somebody sees in Google before
 * they see the site, and they are the two things a travel agent building their
 * own page will not think to write. The page's own words already say what it is
 * about, so this reads them and turns them into one line and one sentence.
 *
 * READS THE PAGE, INVENTS NOTHING. That is the rule the whole feature rests on:
 * everything here is a summary of copy the client wrote, so there is no claim in
 * the output that was not already on the page. A model asked to "write a search
 * description for a travel company" would confidently promise airport transfers
 * nobody offers. Asked to summarise a page it has been handed, it cannot.
 *
 * ONE CALL FOR BOTH, because the title and the description have to agree with
 * each other and repeating one in the other wastes the only two lines there are.
 * Asking twice gets two independent answers that both open "Walking holidays in
 * the Western Isles".
 */

import { ask, AiError, MAX_ANSWER } from './anthropic';
import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX, TITLE_MIN } from '../seo/audit';
import { cleanWritten, type SeoGaps, type SeoWritten } from '../seo/autofill';

/**
 * The rules, in the shape ALT_RULES set: mandatory, numbered where order
 * matters, and specific about the failure rather than the ideal. A rule that
 * says "be concise" is decoration; one that says "under 60 characters" is a
 * constraint.
 */
const SEO_RULES = `You write the two lines that appear in a Google result for a
page on a travel company's website: the title and the description underneath it.

You will be given the words that are actually on the page. Everything you write
must be supported by those words.

RULES, ALL OF THEM MANDATORY:
- NEVER state a fact that is not on the page. No prices, no durations, no
  destinations, no "award winning", no "over 20 years", unless the page says so.
  If the page is vague, be vague. An accurate dull line beats an invented good one.
- The title is under ${TITLE_MAX} characters and at least ${TITLE_MIN}. Put the
  words somebody would actually search for at the front.
- The description is between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX}
  characters. One or two sentences. It says what somebody GETS from this page.
- The description must not repeat the title back. They are two lines, not one
  said twice.
- No marketing throat-clearing. "Discover", "Explore", "Nestled", "Whether you
  are", "Look no further" and "Welcome to" are all banned openings.
- UK English spelling. A harbour is not a harbor.
- No em dashes. No Oxford comma.
- Do not put the company name in the title unless the page is about the company.
  It is already beside every result.

Answer as JSON and nothing else, in exactly this shape:
{"title": "...", "description": "..."}`;

/**
 * What the model is given about the page.
 *
 * THE PAGE'S OWN WORDS, and the company name only so it knows whose page it is
 * and can avoid repeating it. The brand profile is deliberately NOT included:
 * this is a summary job, and handing it the client's marketing blurb is how the
 * blurb's claims end up in the description of a page that does not make them.
 */
function seoPrompt(pageName: string, companyName: string, text: string): string {
  const who = companyName.trim();
  return `Write the search title and description for this page.

The page is called "${pageName.trim().slice(0, 160)}" in the site's own menu,
which may or may not be a good search title.${who ? `\nThe company is ${who.slice(0, 120)}.` : ''}

These are the words on the page, in reading order:

---
${text}
---`;
}

/** The model's JSON, found even when it wrapped it in prose or a code fence. */
function parseAnswer(raw: string): unknown {
  const text = raw.trim();

  // A fenced block, which a model produces despite being asked not to.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1].trim() : text;

  // The first balanced-looking object, so a sentence either side is survivable.
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The search listing for a page, or nothing.
 *
 * NEVER THROWS. This runs inside a publish, and a publish is the client's action
 * and must not fail because ours did. A missing key, a timeout, a refusal, a
 * model that answered in prose: all of them come back as an empty object, the
 * page publishes with its blanks still blank, and the audit on the /seo screen
 * says so exactly as it did before. Failing quietly is right here and would be
 * wrong almost anywhere else.
 */
export async function writeSeo(
  gaps: SeoGaps,
  pageName: string,
  companyName: string,
  pageText: string,
): Promise<SeoWritten> {
  if (!gaps.title && !gaps.description) return {};
  // A page with nothing on it cannot be summarised, and asking would spend a
  // call to be told so.
  if (pageText.trim().length < 40) return {};

  try {
    const answer = await ask(SEO_RULES, seoPrompt(pageName, companyName, pageText), {
      maxTokens: Math.min(400, MAX_ANSWER),
    });
    const written = cleanWritten(parseAnswer(answer.text));

    // Only what was actually missing. A model handed one gap often answers both
    // anyway, and storing the half nobody asked for would be an overwrite.
    return {
      ...(gaps.title ? { title: written.title } : {}),
      ...(gaps.description ? { description: written.description } : {}),
    };
  } catch (error) {
    if (!(error instanceof AiError)) console.error('[tg-sites] seo writer failed', error);
    return {};
  }
}
