'use client';

/**
 * "Publish site": the overlay that puts the whole site live at once.
 *
 * WHY THIS EXISTS. Publishing has always been per unit, so an agent who edits
 * six pages and presses Publish on one is left with five reading "Live, with
 * unpublished edits". This closes that gap. It reads the plan once
 * (sitePublishPlanAction), then publishes each pending page and region in turn
 * through the SAME actions a single publish uses, so nothing about how a page
 * goes live is duplicated here: the search-listing fill, the audit snapshot and
 * the region's whole-site revalidate all still happen, item by item.
 *
 * ONE ITEM AT A TIME, ON PURPOSE. It is slower than a single bulk write would
 * be, and that is the point: the progress is real. Each row moves from waiting
 * to working to done as its own publish returns, so the bar measures work that
 * has actually happened rather than an animation timed to look busy. A site is
 * tens of pages, so the wait is seconds, and the overlay explains it.
 *
 * DRAFTS ARE LEFT ALONE. The plan only ever contains live pages with edits (see
 * lib/publish/site-plan.ts), so a page somebody is still building never goes
 * public from here. The overlay says how many it held back, because "publish the
 * whole site" and "leave my drafts alone" both have to be visibly true.
 *
 * Closing mid-run stops the rest rather than undoing what is done: each page's
 * publish is its own transaction, so the site is simply as far along as the bar
 * showed. The pages already done stay done.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { publishPageAction } from '../../app/actions/pages';
import { publishRegionAction } from '../../app/actions/regions';
import { sitePublishPlanAction } from '../../app/actions/publish-site';
import type { PageSummary } from '../../lib/db/pages';
import type { RegionName } from '../../lib/content/schema';
import type { SitePublishPlan } from '../../lib/publish/site-plan';
import { wasFilled } from '../../lib/seo/autofill';
import { Icon } from '../editor/Icon';
import { Modal } from './Modal';

/** What a site publish moves through, from opening to a finished sweep. */
type Phase = 'planning' | 'running' | 'done' | 'nothing' | 'error';

/** One row in the overlay: a page or a region, with where its publish has got to. */
type WorkState = 'pending' | 'working' | 'done' | 'failed';

type WorkItem =
  | { kind: 'page'; id: string; title: string }
  | { kind: 'region'; name: RegionName; title: string };

const REGION_LABEL: Record<RegionName, string> = {
  header: 'Header',
  footer: 'Footer',
};

/**
 * The plan as a flat worklist: pages in site order, then the regions.
 *
 * Pages first is deliberate and the "N pages updated" line at the end relies on
 * it: the settled rows at the front are the pages. The same builder feeds the
 * list you see and the loop that publishes, so the two can never disagree about
 * what is in the sweep or what order it runs.
 */
function buildItems(plan: SitePublishPlan): WorkItem[] {
  return [
    ...plan.pages.map((page) => ({ kind: 'page' as const, id: page.id, title: page.title || 'Untitled page' })),
    ...plan.regions.map((name) => ({ kind: 'region' as const, name, title: REGION_LABEL[name] })),
  ];
}

interface Props {
  onClose: () => void;
  /**
   * Each page as it goes live, so the screen that opened this can patch its own
   * copy: a dashboard row turns from "Live, with unpublished edits" to "Live",
   * the editor's own status catches up. Null when the page had vanished, which
   * the caller ignores.
   */
  onPagePublished?: (summary: PageSummary) => void;
  /** Each region as it goes live, for the same reason. */
  onRegionPublished?: (name: RegionName) => void;
}

export function PublishSiteDialog({ onClose, onPagePublished, onRegionPublished }: Props) {
  const [phase, setPhase] = useState<Phase>('planning');
  const [plan, setPlan] = useState<SitePublishPlan | null>(null);
  const [states, setStates] = useState<WorkState[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Pages whose search listing we filled in on the way, and pictures described. */
  const [seoPages, setSeoPages] = useState(0);
  const [altsFilled, setAltsFilled] = useState(0);

  // Callbacks in refs so the run loop never restarts when a parent passes a
  // fresh closure. The loop keys on the plan, not on these.
  const onPage = useRef(onPagePublished);
  const onRegion = useRef(onRegionPublished);
  onPage.current = onPagePublished;
  onRegion.current = onRegionPublished;

  /** Set only when the person closes the overlay, so the sweep stops issuing more. */
  const cancelled = useRef(false);
  /**
   * Guards against a second sweep. React 19 StrictMode runs a mount effect
   * twice in development, and this sweep issues real publishes: without the guard
   * the first page would publish twice and leave a duplicate in its history. A
   * ref survives the fake remount, so the second run is a no-op. Cancellation is
   * kept OUT of the effect cleanup for the same reason — a cleanup that stopped
   * the sweep would stop it on that fake unmount too — and lives on the ref
   * above, which only a real Close sets. A publish that lands after a real close
   * simply updates nothing (React drops state writes on an unmounted tree).
   */
  const started = useRef(false);

  const items = useMemo<WorkItem[]>(() => (plan ? buildItems(plan) : []), [plan]);

  // Read the plan, then publish each item in turn. Once, on open.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const mark = (index: number, next: WorkState) =>
      setStates((current) => {
        const copy = current.slice();
        copy[index] = next;
        return copy;
      });

    (async () => {
      try {
        const result = await sitePublishPlanAction();
        if (cancelled.current) return;
        if (!result.ok) {
          setError(result.error);
          setPhase('error');
          return;
        }

        const plan = result.data;
        setPlan(plan);
        const work = buildItems(plan);
        if (work.length === 0) {
          setPhase('nothing');
          return;
        }

        setStates(new Array(work.length).fill('pending'));
        setPhase('running');

        let seo = 0;
        let alts = 0;
        for (let i = 0; i < work.length; i += 1) {
          if (cancelled.current) return;
          mark(i, 'working');

          const item = work[i];
          let ok = false;
          try {
            if (item.kind === 'page') {
              const published = await publishPageAction(item.id);
              ok = published.ok;
              if (published.ok) {
                if (published.data.summary) onPage.current?.(published.data.summary);
                if (wasFilled(published.data.filled)) seo += 1;
                alts += published.data.altsFilled;
              }
            } else {
              const published = await publishRegionAction(item.name);
              ok = published.ok;
              if (published.ok) onRegion.current?.(item.name);
            }
          } catch {
            // A single publish that rejects at the transport level is this
            // item's failure, not the sweep's: mark it and carry on, so one
            // dropped request does not take the rest of the site with it.
            ok = false;
          }

          if (cancelled.current) return;
          mark(i, ok ? 'done' : 'failed');
        }

        if (cancelled.current) return;
        setSeoPages(seo);
        setAltsFilled(alts);
        setPhase('done');
      } catch {
        /*
         * The safety net for the ONE await the per-item catch above does not
         * cover: the plan read. sitePublishPlanAction turns its own errors into
         * a resolved { ok: false }, but a transport-level rejection (a dropped
         * connection, a 5xx, a stale server-action id right after a deploy)
         * rejects the promise instead. Without this the overlay would hang on
         * the planning spinner with nothing to close it back down. Nothing has
         * been published in this case, so it is safe to say so.
         */
        if (cancelled.current) return;
        setError('Something went wrong working out what to publish. Nothing was changed. Please try again.');
        setPhase('error');
      }
    })();
  }, []);

  const close = useCallback(() => {
    cancelled.current = true;
    onClose();
  }, [onClose]);

  const done = states.filter((s) => s === 'done').length;
  const failed = states.filter((s) => s === 'failed').length;
  const settled = done + failed;
  const total = states.length;
  const percent = total === 0 ? 0 : Math.round((settled / total) * 100);
  const publishedPages = plan
    ? Math.min(done, plan.pages.length) // pages are published first, so the first `done` are pages
    : 0;

  const title =
    phase === 'error'
      ? 'Could not publish'
      : phase === 'nothing'
        ? // A site whose only pending work is drafts is not "up to date": it has
          // pages that are simply not live yet, so say what is really going on.
          plan && plan.draftsHeldBack > 0
          ? 'Nothing to publish right now'
          : 'Everything is up to date'
        : phase === 'done'
          ? failed > 0
            ? 'Published, with some left to sort'
            : 'Your site is live'
          : 'Publishing your site';

  const description =
    phase === 'running'
      ? 'Putting every page with changes live. This stays open until it is finished.'
      : phase === 'planning'
        ? 'Working out what needs publishing.'
        : undefined;

  const siteUrl = plan?.siteUrl ?? null;

  return (
    <Modal
      title={title}
      description={description}
      onClose={close}
      footer={
        phase === 'running' || phase === 'planning' ? undefined : (
          <>
            {siteUrl && (
              <a
                className="tg-btn"
                data-variant="primary"
                href={siteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="eye" size={16} />
                View your site
              </a>
            )}
            <button type="button" className="tg-btn" onClick={close}>
              Close
            </button>
          </>
        )
      }
    >
      {phase === 'error' && (
        <p className="tg-pub__error" role="alert">
          {error}
        </p>
      )}

      {phase === 'nothing' && (
        <div className="tg-pub">
          <p className="tg-pub__lead">
            {plan && plan.draftsHeldBack > 0
              ? 'Your live pages already match what you have in the editor, so there is nothing to publish.'
              : 'Every live page already matches what you have in the editor. There is nothing waiting to publish.'}
          </p>
          {/*
            The held-back drafts, said here too. "Publish site" holding drafts
            back only counts as visibly true if the overlay says so even when it
            publishes nothing, which is exactly the state a brand-new site of
            drafts opens in.
          */}
          {plan && plan.draftsHeldBack > 0 && (
            <p className="tg-pub__note">
              {plan.draftsHeldBack === 1
                ? '1 page is still a draft and has been left as it is.'
                : `${plan.draftsHeldBack} pages are still drafts and have been left as they are.`}{' '}
              Publish a draft on its own when it is ready.
            </p>
          )}
        </div>
      )}

      {(phase === 'planning' || phase === 'running' || phase === 'done') && (
        <div className="tg-pub">
          {phase !== 'planning' && (
            <>
              <div
                className="tg-pub__bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={settled}
                aria-label="Publishing progress"
              >
                <span className="tg-pub__fill" style={{ width: `${percent}%` }} />
              </div>
              <p className="tg-pub__count">
                {phase === 'done'
                  ? failed > 0
                    ? `${done} of ${total} published. ${failed} could not be published.`
                    : `${done} of ${total} published.`
                  : `Publishing ${Math.min(settled + 1, total)} of ${total}.`}
              </p>
            </>
          )}

          {phase === 'planning' && (
            <p className="tg-pub__lead">
              <span className="tg-pub__spin" aria-hidden="true" />
              Working out what needs publishing.
            </p>
          )}

          {items.length > 0 && (
            <ul className="tg-pub__list">
              {items.map((item, i) => {
                const state = states[i] ?? 'pending';
                return (
                  <li key={item.kind === 'page' ? `p:${item.id}` : `r:${item.name}`} data-state={state}>
                    <span className="tg-pub__mark" aria-hidden="true">
                      {state === 'done' && <Icon name="check" size={15} />}
                      {state === 'failed' && <Icon name="warning" size={15} />}
                      {state === 'working' && <span className="tg-pub__spin" />}
                    </span>
                    <span className="tg-pub__name">{item.title}</span>
                    <span className="tg-pub__state">
                      {state === 'done'
                        ? 'Live'
                        : state === 'failed'
                          ? 'Not published'
                          : state === 'working'
                            ? 'Publishing'
                            : 'Waiting'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {phase === 'done' && (seoPages > 0 || altsFilled > 0) && (
            <p className="tg-pub__note">
              We also filled in a few things that were missing:{' '}
              {seoPages > 0 && (
                <>
                  a search listing on {seoPages} {seoPages === 1 ? 'page' : 'pages'}
                </>
              )}
              {seoPages > 0 && altsFilled > 0 && ', and '}
              {altsFilled > 0 && (
                <>
                  {altsFilled} {altsFilled === 1 ? 'picture description' : 'picture descriptions'}
                </>
              )}
              .
            </p>
          )}

          {plan && plan.draftsHeldBack > 0 && phase !== 'planning' && (
            <p className="tg-pub__note">
              {plan.draftsHeldBack === 1
                ? '1 page is still a draft and has been left as it is.'
                : `${plan.draftsHeldBack} pages are still drafts and have been left as they are.`}{' '}
              Publish a draft on its own when it is ready.
            </p>
          )}

          {phase === 'done' && failed === 0 && (
            <p className="tg-pub__lead">
              {publishedPages > 0
                ? `Your changes are live. ${publishedPages === 1 ? 'One page' : `${publishedPages} pages`} updated.`
                : 'Your changes are live.'}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
