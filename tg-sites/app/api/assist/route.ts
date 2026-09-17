/**
 * POST /api/assist: one turn of Luna Assist, streamed.
 *
 * A ROUTE HANDLER, NOT A SERVER ACTION, because an action cannot stream and a
 * person waiting for an answer should see it as it is written. Everything a
 * server action would check is checked here, in this order, before the model
 * is called: the key is configured; there is a session and it belongs to a
 * member of a site; the body is the shape expected; the ledger has room for
 * this person, this site and this month. Then the site and the open page are
 * loaded and the turn runs (lib/assist/service.ts), with each line of the
 * answer written to the response as it lands.
 *
 * THE RESPONSE IS NEWLINE-DELIMITED JSON: one object per line, {type: "text",
 * delta} while the answer is being written, then one of {type: "answer"},
 * {type: "question"} or {type: "error"}. A refusal before the turn starts is
 * an ordinary JSON response with a status, since nothing has been streamed.
 *
 * ROLE. Any member of the site may use the assistant (Andy, 16 Sep 2026:
 * client and staff), with the tools their capabilities allow. Slice 1 has
 * readers only, which every member may use; the filter is in
 * lib/assist/tools.ts and the writers arrive with slice 2.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { aiIsConfigured, converse, MODEL_BUILD } from '../../../lib/ai/anthropic';
import { ASSISTANT_NAME } from '../../../lib/assist/brand';
import { outlinePage, type PageOutline } from '../../../lib/assist/context';
import { refusalMessage } from '../../../lib/assist/limits';
import { MAX_MESSAGE, type SiteContext } from '../../../lib/assist/prompt';
import { runTool } from '../../../lib/assist/runners';
import { serveAssist } from '../../../lib/assist/service';
import { currentCapabilities } from '../../../lib/auth/capabilities';
import { isSignInRequired } from '../../../lib/auth/session';
import { claimAssistTurn, logAssist, readAssistAllowance, recordAssistUsage } from '../../../lib/db/assist';
import type { Page } from '../../../lib/content/schema';
import { getPage, listPages, listPagesForAudit } from '../../../lib/db/pages';
import { getSettings } from '../../../lib/db/settings';
import { getTenant, siteUrl } from '../../../lib/db/tenants';

export const runtime = 'nodejs';

/** A turn is a few model calls in a row; the route needs the room for all of them. */
export const maxDuration = 120;

const BodySchema = z.object({
  mode: z.enum(['plan', 'build']).default('plan'),
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  pageId: z.string().uuid().nullable().optional(),
  /* A section id is ours, not a uuid: lib/content ids are short strings. */
  sectionId: z.string().max(80).nullable().optional(),
  thread: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(20_000) }))
    .max(40)
    .default([]),
});

async function loadSite(tenantId: string): Promise<SiteContext> {
  const [tenant, url, settings, audit, summaries] = await Promise.all([
    getTenant(tenantId),
    siteUrl(tenantId),
    getSettings(tenantId),
    listPagesForAudit(tenantId),
    listPages(tenantId),
  ]);
  const changed = new Map(summaries.map((page) => [page.id, page.hasUnpublishedChanges]));
  return {
    name: settings.companyName || tenant?.name || 'this site',
    url,
    settings,
    pages: audit.map((page) => ({
      id: page.id,
      title: page.title,
      path: page.path ? `/${page.path}` : '/',
      published: page.published,
      changed: changed.get(page.id) ?? false,
    })),
  };
}

/**
 * A request from another site, carrying a member's cookie, must not spend a
 * turn. A JSON body normally forces a preflight that the missing CORS headers
 * fail, but a form posting text/plain does not, and request.json() would parse
 * it happily. So the origin has to be ours (or absent, as it is for a same-site
 * fetch in some browsers), the browser's own verdict is honoured when it gives
 * one, and the body has to say it is JSON.
 */
function crossSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return true;
    } catch {
      return true;
    }
  }
  const type = request.headers.get('content-type') ?? '';
  return !type.toLowerCase().startsWith('application/json');
}

export async function POST(request: Request): Promise<Response> {
  if (!aiIsConfigured()) {
    return NextResponse.json({ error: `${ASSISTANT_NAME} is not switched on for this site yet.` }, { status: 503 });
  }
  if (crossSite(request)) {
    return NextResponse.json({ error: 'That request did not come from this site.' }, { status: 403 });
  }

  let tenantId: string;
  let userId: string;
  let caps: Awaited<ReturnType<typeof currentCapabilities>>['caps'];
  try {
    ({ tenantId, userId, caps } = await currentCapabilities());
  } catch (error) {
    if (isSignInRequired(error)) {
      return NextResponse.json({ error: 'Your session has ended. Sign in again to carry on.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'This account is not a member of a site yet.' }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Say what you would like, in a message.' }, { status: 400 });
  }
  const body = parsed.data;
  const model = MODEL_BUILD;

  const allowancePence = await readAssistAllowance(tenantId);
  const claim = await claimAssistTurn(tenantId, { userId, mode: body.mode, model, allowancePence });
  if (!claim.allowed) {
    const reason = claim.reason ?? 'tenant';
    await logAssist(tenantId, { userId, usageId: null, pageId: body.pageId ?? null, mode: body.mode, kind: 'refused', detail: { reason } });
    return NextResponse.json({ error: refusalMessage(reason) }, { status: 429 });
  }

  const site = await loadSite(tenantId);
  let page: PageOutline | null = null;
  let pageTree: Page | null = null;
  let pageId: string | null = null;
  let sectionId: string | null = null;
  if (body.pageId && site.pages.some((entry) => entry.id === body.pageId)) {
    const found = await getPage(tenantId, body.pageId);
    if (found) {
      pageId = found.id;
      pageTree = found.content;
      page = outlinePage(found.content, site.pages.find((entry) => entry.id === found.id)?.path ?? '/');
      /* A section the page does not have is dropped rather than refused: the
         person moved on, or deleted it, and neither is worth an error. */
      if (body.sectionId && page.sections.some((section) => section.id === body.sectionId)) {
        sectionId = body.sectionId;
      }
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      };
      try {
        const result = await serveAssist(
          { tenantId, userId, mode: body.mode, model, message: body.message, pageId, sectionId, thread: body.thread, site, page, pageTree, caps },
          {
            claim: async () => claim,
            converse: (system, messages, opts) => converse(system, messages, opts),
            runTool: (name, input) => runTool(name, input, { tenantId, pageId, site }),
            record: (usageId, usage, pence) => recordAssistUsage(tenantId, usageId, usage, pence),
            log: (event) => logAssist(tenantId, event),
            onText: (delta) => send({ type: 'text', delta }),
          },
        );
        if (result.kind === 'answer') {
          send({ type: 'answer', text: result.text, pence: result.pence, toolsUsed: result.toolsUsed });
        } else if (result.kind === 'question') {
          send({ type: 'question', text: result.text, question: result.question.question, options: result.question.options, pence: result.pence, toolsUsed: result.toolsUsed });
        } else if (result.kind === 'proposal') {
          /*
           * The operations go to the browser because the EDITOR applies them:
           * through its own history, as one step, so Undo is the Undo the
           * person already knows and there is still one path that writes a
           * page. They are checked again on the way back in (see
           * app/actions/assist.ts), because anything that has been to a
           * browser is input again when it returns.
           */
          send({
            type: 'proposal',
            text: result.text,
            changes: result.proposal.changes,
            operations: result.proposal.operations,
            refused: result.proposal.refused,
            pence: result.pence,
            toolsUsed: result.toolsUsed,
          });
        } else if (result.kind === 'refused') {
          send({ type: 'error', message: result.message });
        } else {
          send({ type: 'error', message: result.message, pence: result.pence });
        }
      } catch (error) {
        console.error('[tg-sites] assistant route failed', error);
        send({ type: 'error', message: 'The assistant could not answer that. Try again in a moment.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
