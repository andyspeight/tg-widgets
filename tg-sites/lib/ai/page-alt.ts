import 'server-only';

/**
 * Describing the pictures on a page that is about to be published.
 *
 * The second half of the done-for-you SEO. lib/seo/alt-fill.ts finds which
 * pictures have no description and writes answers back into the tree; this is
 * what gets the answers.
 *
 * THE FIRST ANSWER IS FREE, AND OFTEN THE ONLY ONE NEEDED. Alt text belongs to
 * the picture rather than to the place it is used (lib/media/types.ts), so a
 * block with no description is usually an inheritance that did not happen rather
 * than a picture nobody has described. Checking the bank first costs one query
 * that was going to happen anyway and saves a model call every time it hits.
 *
 * IT WRITES TO THE BLOCK AND NEVER TO THE BANK. describeImageAction has carried
 * a rule since the image bank was built: it returns a sentence, it does not save
 * one, because a model that wrote straight into the database is one whose
 * mistakes are already published. Publishing is a narrower act than that. Filling
 * in the page being published is what the client asked for and is shown
 * afterwards; changing what a picture is called EVERYWHERE, off the back of one
 * page's publish, is a bigger thing than anybody asked for.
 *
 * IT NEVER THROWS AND NEVER BLOCKS, for the reason the search-listing writer
 * does not: publishing is the client's action. A refused slot, a timeout or a
 * picture the model cannot fetch leaves that picture undescribed and the page
 * published, which is the state it was in a moment before.
 */

import { describePicture, fetchableByModel } from './alt';
import { claimRequest, recordTokens } from '../db/ai';
import { listAllMedia } from '../db/media';

/**
 * How many pictures one publish will describe.
 *
 * A BOUND ON TWO THINGS AT ONCE: the wait, since these run together and the
 * publish waits for the slowest, and the day's AI allowance, which one publish
 * of one picture-heavy page should not be able to eat. Anything past this is
 * described on the next publish, or from the image bank, where the button has
 * always been.
 */
const MAX_PER_PUBLISH = 8;

/**
 * Descriptions for as many of these pictures as can be got, by URL.
 *
 * The map may be smaller than the list asked for, and empty is a perfectly good
 * answer. Every caller treats a missing entry as "leave that one alone".
 */
export async function describePageImages(
  tenantId: string,
  userId: string | undefined,
  urls: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (urls.length === 0) return out;

  try {
    // One read of the bank, which is tens of rows on a real site, and the only
    // query this makes. It answers both questions: does the picture belong to
    // this tenant, and does it already have a description.
    const bank = await listAllMedia(tenantId);
    const byUrl = new Map(bank.map((item) => [item.url, item]));

    const needed: Array<{ url: string; filename: string }> = [];

    for (const url of urls) {
      const item = byUrl.get(url);

      /*
       * A PICTURE THAT IS NOT IN THIS SITE'S BANK IS SKIPPED, and that is a
       * security boundary rather than tidiness. The model FETCHES the URL it is
       * given, so handing it an address that came out of stored content would be
       * letting a stored row point our outbound request wherever it liked. Only
       * addresses this tenant's own bank vouches for are ever sent.
       */
      if (!item) continue;

      // Already described in the bank: the block simply inherits it, which is
      // what should have happened when the picture was placed.
      const known = item.alt?.trim();
      if (known) {
        out.set(url, known);
        continue;
      }

      if (fetchableByModel(item.url)) needed.push({ url: item.url, filename: item.filename });
    }

    const asking = needed.slice(0, MAX_PER_PUBLISH);
    if (asking.length === 0) return out;

    /*
     * TOGETHER RATHER THAN ONE AFTER ANOTHER. Eight pictures described in turn
     * is eight round trips of waiting stacked on a publish; described together
     * it is one round trip of waiting. The cap above is what makes that safe to
     * do at all.
     */
    await Promise.all(
      asking.map(async (picture) => {
        try {
          const claim = await claimRequest(tenantId, { userId: userId ?? null, intent: 'alt' });
          // The day's allowance is gone. Stop asking, quietly: the picture stays
          // undescribed and the audit will say so, which is honest.
          if (!claim.allowed) return;

          const answer = await describePicture(picture.url, picture.filename);
          if (claim.id) {
            await recordTokens(tenantId, claim.id, {
              input: answer.inputTokens,
              output: answer.outputTokens,
            });
          }
          if (answer.alt) out.set(picture.url, answer.alt);
        } catch {
          // One picture failing is one picture undescribed, not a failed publish.
        }
      }),
    );

    return out;
  } catch (error) {
    console.error('[tg-sites] could not describe a page’s pictures', error);
    return out;
  }
}
