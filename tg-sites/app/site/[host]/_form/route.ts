/**
 * The published site's one POST: a form submission.
 *
 * /_form is unreachable as a page address by construction (the slug rules
 * cannot produce an underscore), so this route shadows nothing. The middleware
 * rewrites every client-site request to /site/<hostname>/<path>, which is how
 * a plain <form action="/_form"> on any page of any tenant lands here with the
 * right host in the params.
 *
 * THE SHAPE OF A RESPONSE IS ALWAYS A REDIRECT back to the page the form sat
 * on, carrying a fragment the stylesheet turns into a state: #<id>-done shows
 * the thank-you, #<id>-err the error line. 303, so the browser re-requests
 * the page as a GET and a refresh never re-posts.
 *
 * WHAT A BOT SEES: success. The honeypot and the time trap refuse silently,
 * redirecting to -done without storing, because a bot told it failed retries
 * and one told it worked moves on. A person's genuinely broken submission
 * (a required field empty past the browser, an oversized paste) gets -err.
 *
 * The write itself goes through the definer function via the renderer role,
 * which cannot read this table or write any other: see migration 0025.
 */

import { headers } from 'next/headers';

import { getPublishedPage } from '../../../../lib/db/pages';
import { resolveTenantByHostname } from '../../../../lib/db/tenants';
import { storeSubmission } from '../../../../lib/db/forms';
import { findFormBlock, parseSubmission } from '../../../../lib/forms/submit';
import { notifySubmission } from '../../../../lib/forms/notify';

export const dynamic = 'force-dynamic';

/** The path of the page the form was on, taken from the referer ONLY when the
 * referer is this same site. Anything else falls back to the home page, which
 * loses nothing but the scroll position. */
function refererPath(referer: string | null, host: string): string {
  if (!referer) return '';
  try {
    const url = new URL(referer);
    if (url.hostname.toLowerCase() !== host.toLowerCase()) return '';
    return url.pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    return '';
  }
}

function backTo(path: string, fragment: string): Response {
  const location = `/${path}${fragment}`;
  return new Response(null, { status: 303, headers: { location } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ host: string }> },
): Promise<Response> {
  const { host: rawHost } = await params;
  const host = decodeURIComponent(rawHost);

  const tenantId = await resolveTenantByHostname(host);
  if (!tenantId) return new Response('Not found', { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const blockId = String(form.get('_block') ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(blockId)) return new Response('Bad request', { status: 400 });

  const path = refererPath((await headers()).get('referer'), host);
  const done = `#f-${blockId}-done`;
  const err = `#f-${blockId}-err`;

  // The page must exist, be published, and actually carry this form. That is
  // what keeps this route from storing anything a published form did not ask
  // for. A miss is a visible error: a real person can hit it when the page
  // was unpublished under them, and silence would strand them.
  const page = await getPublishedPage(tenantId, path);
  const declared = page ? findFormBlock(page.content, blockId) : null;
  if (!page || !declared) return backTo(path, err);

  const parsed = parseSubmission(form.entries(), declared, Date.now());
  if (!parsed.ok) {
    return backTo(path, parsed.refusal === 'silent' ? done : err);
  }

  const ua = ((await headers()).get('user-agent') ?? '').slice(0, 250);
  const stored = await storeSubmission(tenantId, {
    pageId: page.id,
    formBlockId: blockId,
    formName: declared.name,
    data: parsed.data,
    meta: { path: `/${path}`, ua },
  });

  // Over the rate cap reads as success to the visitor: the cap exists for
  // floods, and a flood is not owed an explanation.
  if (stored) {
    await notifySubmission({ host, form: declared, pageTitle: page.title, data: parsed.data });
  }

  return backTo(path, done);
}
