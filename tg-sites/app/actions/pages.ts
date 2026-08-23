'use server';

/**
 * Everything the editor is allowed to ask the database to do.
 *
 * A server action is a public HTTP endpoint with a nice syntax. Anyone can
 * call any of these with any arguments they like, so two rules hold
 * throughout and there are no exceptions to either:
 *
 *   1. THE TENANT IS NEVER AN ARGUMENT. It comes from the session, server
 *      side. If a caller could pass a tenant id, the entire row level
 *      security layer would reduce to "please pass your own id".
 *
 *   2. Every id from the caller is treated as a guess. Nothing here checks
 *      ownership by hand, because it does not need to: every query runs
 *      inside withTenant, so an id belonging to another tenant matches no
 *      row and comes back null. Failing closed is the default rather than
 *      something each function remembers to do.
 */

import { revalidatePath } from 'next/cache';

import {
  createPage,
  deletePage,
  getPage,
  listPages,
  listPublishes,
  publishPage,
  restorePublish,
  saveDraft,
  unpublishPage,
  updatePageMeta,
  type PageSummary,
  type PageWithContent,
  type PublishRecord,
} from '../../lib/db/pages';
import { slugify } from '../../lib/content/slug';
import { pageTemplateSections, pageTemplateSpec } from '../../lib/content/page-templates';
import { fillPagePhotos } from '../../lib/media/photo-fill';
import { importDesignedFonts } from '../../lib/content/designed-fonts';
import { parsePage } from '../../lib/content/schema';
import { sanitisePage } from '../../lib/content/sanitise-page';
import { getSettings } from '../../lib/db/settings';
import { pageText } from '../../lib/seo/audit';
import {
  applySeoFill,
  hasGap,
  seoGaps,
  wasFilled,
  type SeoFilled,
} from '../../lib/seo/autofill';
import { writeSeo } from '../../lib/ai/seo';
import { changeScope } from '../../lib/content/change-scope';
import { currentUserId, requireTenantId } from '../../lib/auth/session';
import {
  currentCapabilities,
  isPermissionError,
  PermissionError,
  requireCapability,
} from '../../lib/auth/capabilities';

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Run an action and turn a thrown error into a message the editor can show.
 *
 * Server actions reject with an opaque "an error occurred" in production,
 * which is right for a stack trace and useless for "that slug is taken". The
 * cases worth naming are named; anything else stays generic on purpose.
 */
async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/**
 * A save refused for want of a capability is the member's to see, spelt out
 * rather than hidden behind the generic message. requireCapability and the
 * content-only check below both raise it. Named first, before the Postgres and
 * session cases, because it is a policy answer rather than a fault.
 */
function explain(error: unknown): string {
  if (isPermissionError(error)) return error.message;

  const message = error instanceof Error ? error.message : String(error);

  // Postgres unique violation. The only one this schema can raise on a page
  // is a duplicate slug under the same parent.
  if (message.includes('23505') || message.includes('duplicate key')) {
    return 'A page already has that address. Try a different one.';
  }
  if (message.includes('pages_slug_check') || message.includes('violates check constraint')) {
    return 'That address has characters it cannot use. Lowercase letters, numbers and hyphens only.';
  }
  // Raised by requireSite when a signed-in person belongs to no site, and by
  // SignInRequired when the cookie has run out. Both are worth showing as
  // written: one needs an invitation, the other needs signing in again, and
  // "something went wrong" would send somebody looking for a bug.
  if (message.startsWith('This account is not a member')) return message;
  if (message.startsWith('Your session has ended')) return message;
  if (message.startsWith('Refusing to save')) return message;
  if (message.includes('own parent')) return 'A page cannot sit inside itself.';
  // The folder move rules, worth showing as written on the rare race that reaches
  // the server past the drag UI: a page filed into its own branch, or nested so
  // deep the address runs out.
  if (
    message.startsWith('A page cannot go inside') ||
    message.startsWith('That would nest') ||
    message.startsWith('That page is not here')
  ) {
    return message;
  }

  console.error('[tg-sites] action failed', error);
  return 'Something went wrong saving that. Nothing was changed.';
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listPagesAction(): Promise<ActionResult<PageSummary[]>> {
  return attempt(async () => listPages(await requireTenantId()));
}

export async function getPageAction(
  pageId: string,
): Promise<ActionResult<PageWithContent | null>> {
  return attempt(async () => getPage(await requireTenantId(), pageId));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createPageAction(input: {
  title: string;
  slug?: string;
  parentId?: string | null;
  template?: string;
}): Promise<ActionResult<PageWithContent>> {
  // The template id is the only thing here that becomes page content, and it is
  // looked up against the closed registry: an unknown or missing id builds the
  // blank page (pageTemplateSections returns null), so nothing a caller sends
  // reaches the page except by naming a template we built.
  const templateId = String(input.template ?? '');
  const sections = (await pageTemplateSections(templateId)) ?? undefined;

  const result = await attempt(async () => {
    const tenantId = await requireCapability('pages');

    /*
     * The template's photographs, fetched into this client's media before the
     * page is written, so an About page arrives with its banner picture rather
     * than a grey frame. Best effort inside the fill itself (it never throws):
     * with no photo key or no store the page is simply added unphotographed,
     * exactly as it always was.
     */
    if (sections) {
      const spec = pageTemplateSpec(templateId);
      if (spec) await fillPagePhotos(tenantId, spec, sections);
    }

    return createPage(
      tenantId,
      {
        title: String(input.title ?? '').slice(0, 200),
        slug: slugify(input.slug ?? input.title ?? ''),
        parentId: input.parentId ?? null,
        sections,
      },
      (await currentUserId()) ?? undefined,
    );
  });

  if (result.ok) {
    revalidatePath('/sites');
    // A designed template carries its own typefaces; load them into this site so
    // the design's type is exact. Best effort, after the page is written, so a
    // font that will not import never fails adding the page.
    const template = String(input.template ?? '');
    if (template.startsWith('design-')) {
      await importDesignedFonts(await requireTenantId(), template.slice('design-'.length));
    }
  }
  return result;
}

export async function renamePageAction(
  pageId: string,
  changes: { title?: string; slug?: string },
): Promise<ActionResult<PageSummary | null>> {
  const result = await attempt(async () =>
    updatePageMeta(await requireCapability('pages'), pageId, {
      title: changes.title?.slice(0, 200),
      // Undefined leaves the slug alone. An empty string is a real value: it
      // is the home page. So the two cannot be collapsed.
      slug: changes.slug === undefined ? undefined : slugify(changes.slug),
    }),
  );

  if (result.ok) revalidatePath('/sites');
  return result;
}

/**
 * File a page into a folder, or back out to the top level.
 *
 * A folder is just a page, so a move is a re-parent: updatePageMeta swaps the
 * parent id and, because the address changes, writes the redirects that keep the
 * old links working, all in one transaction. It also enforces the one-level rule
 * (a folder must be top level, a folder cannot be filed away), so a caller
 * reaching past the drag UI cannot build a second level. `parentId` null means
 * the top level; a page id means file it inside that page.
 */
export async function movePageAction(
  pageId: string,
  parentId: string | null,
): Promise<ActionResult<PageSummary | null>> {
  const result = await attempt(async () =>
    updatePageMeta(await requireCapability('pages'), pageId, { parentId }),
  );
  if (result.ok) revalidatePath('/sites');
  return result;
}

export async function deletePageAction(pageId: string): Promise<ActionResult<boolean>> {
  const result = await attempt(async () =>
    deletePage(await requireCapability('pages'), pageId, (await currentUserId()) ?? undefined),
  );
  if (result.ok) revalidatePath('/sites');
  return result;
}

/**
 * Save the editor's draft.
 *
 * `page` arrives from the browser and is treated as hostile: saveDraft parses
 * it against the schema, normalises the column widths and runs the whole tree
 * through the sanitiser before a single byte reaches the database.
 *
 * AND IT IS GATED BY CAPABILITY, which is the whole point of the permissions
 * epic. `content` is the floor: without it there is no saving at all. A member
 * who has `content` but not `structure` may still save, but only a CONTENT
 * change, worked out by comparing the incoming page to the one already stored
 * (lib/content/change-scope.ts): the same words, photos and links they could
 * always edit, and not a section added, moved or restyled. `seo` guards the
 * page's search settings the same way. A member with `structure` skips the
 * comparison entirely, so the common case pays nothing for it. The editor hides
 * the controls a content-only client lacks, but the editor is a courtesy and
 * this is the control: a server action is a public endpoint.
 */
export async function saveDraftAction(
  pageId: string,
  page: unknown,
): Promise<ActionResult<PageSummary | null>> {
  return attempt(async () => {
    const { tenantId, userId, caps } = await currentCapabilities();
    if (!caps.has('content')) throw new PermissionError('content');

    // Only a member who cannot freely restructure or change SEO needs the stored
    // page fetched and the change classified. Everyone else saves as before.
    if (!caps.has('structure') || !caps.has('seo')) {
      const parsed = parsePage(page);
      if (!parsed.ok) {
        throw new Error(`Refusing to save a malformed page: ${parsed.errors.join('; ')}`);
      }
      const current = await getPage(tenantId, pageId);
      // A missing page means saveDraft will change nothing anyway, so there is
      // nothing to gate: let it fall through and no-op.
      if (current) {
        const scope = changeScope(sanitisePage(current.content), sanitisePage(parsed.page));
        if (scope.structure && !caps.has('structure')) {
          throw new PermissionError('structure');
        }
        if (scope.seo && !caps.has('seo')) {
          throw new PermissionError('seo');
        }
      }
    }

    return saveDraft(tenantId, pageId, page, userId || undefined);
  });
}

/** What a publish did, including anything it wrote for the client. */
export interface PublishOutcome {
  summary: PageSummary | null;
  /** The search title and description we filled in, if any. Shown, never silent. */
  filled: SeoFilled;
}

/**
 * Fill a page's search listing before it is published.
 *
 * BEFORE, because publishPage copies the draft to the live copy: writing this
 * afterwards would leave the published page carrying the blanks until the next
 * publish, which is exactly the page anybody looking would see.
 *
 * NEVER THROWS, AND NEVER BLOCKS. Publishing is the client's action. If the
 * read, the model or the save fails, the page still publishes and its blanks
 * stay blank, which is precisely the state it was in a moment ago. The /seo
 * screen will report them as it always did. That is why every step here is
 * inside one try and the catch answers with an empty result rather than
 * rethrowing.
 */
async function fillSeoBeforePublish(
  tenantId: string,
  pageId: string,
  userId: string | undefined,
): Promise<SeoFilled> {
  try {
    const record = await getPage(tenantId, pageId);
    if (!record) return {};

    const gaps = seoGaps(record.content);
    if (!hasGap(gaps)) return {};

    const settings = await getSettings(tenantId);
    const written = await writeSeo(
      gaps,
      record.content.title,
      settings.companyName,
      pageText(record.content),
    );

    const { page, filled } = applySeoFill(record.content, written);
    if (!wasFilled(filled)) return {};

    // Through saveDraft rather than a bespoke update, so what we wrote goes
    // through the same parse and sanitise a client's own save does.
    await saveDraft(tenantId, pageId, page, userId);
    return filled;
  } catch (error) {
    console.error('[tg-sites] could not write the search listing before publishing', error);
    return {};
  }
}

export async function publishPageAction(
  pageId: string,
): Promise<ActionResult<PublishOutcome>> {
  const tenantId = await requireCapability('publish');
  const userId = (await currentUserId()) ?? undefined;

  const filled = await fillSeoBeforePublish(tenantId, pageId, userId);

  const result = await attempt(async () => publishPage(tenantId, pageId, userId));

  if (result.ok) {
    revalidatePath('/sites');
    revalidatePath('/preview');
    return { ok: true, data: { summary: result.data, filled } };
  }
  return result;
}

export async function unpublishPageAction(
  pageId: string,
): Promise<ActionResult<PageSummary | null>> {
  const result = await attempt(async () =>
    unpublishPage(await requireCapability('publish'), pageId),
  );

  if (result.ok) {
    revalidatePath('/sites');
    revalidatePath('/preview');
  }
  return result;
}

// ---------------------------------------------------------------------------
// History and rollback
// ---------------------------------------------------------------------------

/** Every publish we still hold for a page, newest first. */
export async function listPublishesAction(
  pageId: string,
): Promise<ActionResult<PublishRecord[]>> {
  return attempt(async () => listPublishes(await requireTenantId(), pageId));
}

/**
 * Put an old version back as the draft.
 *
 * Both ids come from the caller and both are guesses, which is fine: the query
 * matches on publish id AND page id, inside withTenant, so a wrong or borrowed id
 * restores nothing rather than restoring the wrong thing. Rule 2 at the top of this
 * file, with one addition, because the tenant policy alone would not stop one page
 * of a tenant being restored from another page's history.
 *
 * NOT revalidated, deliberately, unlike publish and unpublish. This changes the
 * draft and leaves the live site exactly as it was, so there is nothing public to
 * rebuild. The editor reloads the page it is holding, which is a client concern.
 */
export async function restorePublishAction(
  pageId: string,
  publishId: string,
): Promise<ActionResult<PageWithContent | null>> {
  // Restore replaces the whole draft with an old snapshot, structure and all, so
  // it is the `structure` capability's to allow, not `content`'s.
  return attempt(async () =>
    restorePublish(
      await requireCapability('structure'),
      pageId,
      publishId,
      (await currentUserId()) ?? undefined,
    ),
  );
}

// ---------------------------------------------------------------------------

// The slug helper lives in lib/content/slug.ts so the dialog and this
// action derive the same address from the same name.

