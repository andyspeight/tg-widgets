import 'server-only';

/**
 * Describing one photograph, in the one place that does it.
 *
 * EXTRACTED RATHER THAN COPIED. describeImageAction has done this since the
 * image bank was built, for a client clicking a button in the picker. Publishing
 * now needs the same thing for a page's undescribed pictures (#239), and a
 * second copy of the cleaning would be two boundaries that drift: the cap, the
 * quotation marks a model wraps a sentence in, and the empty-answer case all
 * have to stay identical, because the difference between them would show up as
 * one route admitting text the other refuses.
 *
 * NO AUTH AND NO RATE LIMIT HERE, on purpose. Both callers have those and they
 * are not the same: the action checks the picture belongs to this site's bank,
 * and the publish path checks it a different way. Putting either in here would
 * mean one caller getting a check written for the other.
 */

import { ask, AiError } from './anthropic';
import { altPrompt, ALT_RULES, HOUSE_RULES, MAX_ALT } from './prompt';

/**
 * What a model said about a picture, made safe to store, or ''.
 *
 * Trimmed of the quotation marks a model wraps a sentence in even when told not
 * to, and capped. The cap is here as well as in the prompt because a prompt is a
 * request and this is the boundary.
 */
export function tidyAlt(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“‘']+|["”’']+$/g, '')
    .slice(0, MAX_ALT);
}

export interface AltAnswer {
  alt: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Describe one picture. Throws AiError the way ask does, so the button can show
 * a client why, and the publish path can swallow it.
 *
 * THE HOUSE RULES AND THE ALT RULES, AND NOT THE COMPANY PROFILE. Alt text says
 * what is in the picture. Given the profile a model writes "a couple enjoying a
 * luxury Someshop escape", which is a brochure caption and a lie to somebody who
 * cannot see the photograph. See ALT_RULES.
 */
export async function describePicture(url: string, filename: string): Promise<AltAnswer> {
  const answer = await ask(`${HOUSE_RULES}\n\n${ALT_RULES}`, altPrompt(filename), {
    image: { url },
  });

  return {
    alt: tidyAlt(answer.text),
    inputTokens: answer.inputTokens,
    outputTokens: answer.outputTokens,
  };
}

/**
 * A URL the model can actually be asked to fetch.
 *
 * The model fetches this itself, so it has to be one anybody can fetch. A blob
 * URL is; a data: URI is not a URL the API will follow, which is what the demo
 * doubles hand back, so a review copy fails honestly rather than timing out.
 */
export function fetchableByModel(url: string): boolean {
  return /^https:\/\//i.test(url);
}

export { AiError, MAX_ALT };
