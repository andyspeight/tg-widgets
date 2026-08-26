'use client';

/**
 * Planning a site with the AI builder, then building the pages it proposed.
 *
 * THE PLAN IS SHOWN BEFORE ANYTHING IS BUILT, and that is the whole shape of
 * this screen. The model proposes a sitemap, the client edits it — renames a
 * page, rewrites what it is for, drops one, moves one — and only then does a
 * single page get created. Approving a list of eight lines takes a minute;
 * reading eight generated pages and deciding which to keep does not, and a
 * client who has watched eight wrong pages appear has already made up their mind
 * about the feature.
 *
 * ONE CALL PER PAGE, IN SEQUENCE. Eight page builds in one request would walk
 * into a serverless time limit, and a failure at page six would lose the five
 * that worked. Sequential also means the screen can name the page it is on,
 * which is what stops a minute-long wait reading as a hang.
 *
 * A FAILURE IS PER PAGE, NOT PER SITE. One page that would not build leaves the
 * rest standing and says which one, because the honest outcome of "seven of
 * eight built" is seven pages and a sentence, not an error.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { buildPlannedPageAction, planSiteAction } from '../../app/actions/ai';
import type { PlannedPage } from '../../lib/ai/site-build';
import { Icon } from '../editor/Icon';
import { Modal } from '../ui/Modal';

/** How far through the client is. */
type Stage = 'ask' | 'review' | 'building' | 'done';

/** What happened to one page once building started. */
type Progress = 'waiting' | 'building' | 'built' | 'failed' | 'skipped';

interface Row extends PlannedPage {
  progress: Progress;
  error?: string;
}

const MAX_BRIEF = 400;

export function SiteBuilder({
  onClose,
  existing,
}: {
  onClose: () => void;
  /**
   * The addresses already on this site, and whether anything is built on them.
   *
   * So the review step can say which planned pages would be left alone BEFORE
   * anybody presses build. The server refuses to build over content whatever
   * this says; this is here so the client is not surprised by the refusal.
   */
  existing: ReadonlyArray<{ slug: string; title: string; filled: boolean }>;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('ask');
  /** The home page's id, so Done can open what was just built. */
  const [homeId, setHomeId] = useState<string | null>(null);
  /** The planner looked and found nothing this site is short of. */
  const [nothingMissing, setNothingMissing] = useState(false);
  const [brief, setBrief] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const built = rows.filter((row) => row.progress === 'built').length;
  const failed = rows.filter((row) => row.progress === 'failed');
  const skipped = rows.filter((row) => row.progress === 'skipped');

  /** The page already on this site at that address, if anything is built there. */
  const clash = (slug: string) => existing.find((page) => page.slug === slug && page.filled);

  /**
   * A page already covering the same SUBJECT, wherever it lives.
   *
   * Address is not enough, and Andy's first real run proved it: the planner
   * offered "Voyages" to a site whose Voyages page sits at /destinations, so
   * nothing collided and a duplicate would have been built. The server can only
   * refuse on address, because that is the thing it can be certain about; a
   * matching NAME is a caution rather than a refusal, since somebody may well
   * want a second page with a similar title.
   */
  const sameName = (row: Row) => {
    const wanted = row.title.trim().toLowerCase();
    if (!wanted) return undefined;
    return existing.find(
      (page) => page.filled && page.slug !== row.slug && page.title.trim().toLowerCase() === wanted,
    );
  };

  async function plan() {
    setBusy(true);
    setError(null);
    const result = await planSiteAction({ brief });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.data.map((page) => ({ ...page, progress: 'waiting' as const })));
    setStage('review');
    setNothingMissing(result.data.length === 0);
  }

  function patch(index: number, next: Partial<Row>) {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...next } : row)));
  }

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    setRows(next);
  }

  /**
   * Build them one at a time, updating the row as each finishes.
   *
   * Reads from a local copy rather than from state: the loop needs the list as
   * it was when Build was pressed, and setRows inside it would otherwise be
   * racing the reads.
   */
  async function build() {
    const plannedPages = rows.map((row) => ({ ...row, progress: 'waiting' as const }));
    setRows(plannedPages);
    setStage('building');
    setError(null);

    for (let index = 0; index < plannedPages.length; index += 1) {
      const page = plannedPages[index];
      patch(index, { progress: 'building' });

      const result = await buildPlannedPageAction({
        title: page.title,
        slug: page.slug,
        purpose: page.purpose,
      });

      patch(
        index,
        result.ok
          ? { progress: 'built', error: undefined }
          : {
              // A page left alone is not a page that broke.
              progress: result.skipped ? 'skipped' : 'failed',
              error: result.error,
            },
      );

      if (result.ok && page.slug === '') setHomeId(result.data.id);
    }

    setStage('done');
  }

  /**
   * Finishing takes you to what was built, rather than back to a list.
   *
   * The dashboard seeds its pages into state on mount, so a refresh behind this
   * dialog would not show the new rows anyway — the same reason the starter
   * wizard navigates. Opening the home page is also simply the next thing
   * anybody wants to do.
   */
  function finish() {
    onClose();
    if (homeId) router.push(`/editor?page=${encodeURIComponent(homeId)}`);
    else router.refresh();
  }

  // -------------------------------------------------------------------------

  if (stage === 'ask') {
    return (
      <Modal
        title="Plan my site"
        description="The builder reads your company profile and proposes the pages this site needs. Nothing is created until you have looked at the plan."
        size="large"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="sv-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="sv-btn"
              data-variant="primary"
              disabled={busy}
              onClick={() => void plan()}
            >
              <Icon name="sparkle" size={16} />
              {busy ? 'Planning…' : 'Plan the pages'}
            </button>
          </>
        }
      >
        {error && (
          <p className="sv-msg" role="alert">
            {error}
          </p>
        )}

        <div className="sv-field">
          <label htmlFor="site-brief">Anything to add? (optional)</label>
          <textarea
            id="site-brief"
            rows={4}
            maxLength={MAX_BRIEF}
            value={brief}
            placeholder="We are dropping the cruise side this year and want the small-ship trips front and centre."
            onChange={(event) => setBrief(event.target.value)}
          />
          <small>
            Only what your profile does not already say. Leave it empty and the builder works from
            the profile on the Settings screen.
          </small>
        </div>
      </Modal>
    );
  }

  if (stage === 'review') {
    return (
      <Modal
        title="Does this look right?"
        description="Rename a page, change what it is for, or drop one. This is also the order they will be created in. Nothing has been built yet."
        size="large"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="sv-btn" disabled={busy} onClick={() => void plan()}>
              <Icon name="undo" size={16} />
              Plan again
            </button>
            <button
              type="button"
              className="sv-btn"
              data-variant="primary"
              disabled={busy || rows.length === 0}
              onClick={() => void build()}
            >
              <Icon name="sparkle" size={16} />
              {`Build ${rows.length} ${rows.length === 1 ? 'page' : 'pages'}`}
            </button>
          </>
        }
      >
        {error && (
          <p className="sv-msg" role="alert">
            {error}
          </p>
        )}

        <ul className="sv-plan">
          {rows.map((row, index) => (
            <li className="sv-plan__row" key={`${row.slug}-${index}`}>
              <div className="sv-plan__main">
                <div className="sv-field">
                  <label htmlFor={`plan-title-${index}`}>Page name</label>
                  <input
                    id={`plan-title-${index}`}
                    value={row.title}
                    maxLength={60}
                    onChange={(event) => patch(index, { title: event.target.value })}
                  />
                </div>

                <div className="sv-field">
                  <label htmlFor={`plan-purpose-${index}`}>What it is for</label>
                  <textarea
                    id={`plan-purpose-${index}`}
                    rows={2}
                    maxLength={240}
                    value={row.purpose}
                    placeholder="One sentence. This is the brief the page is built from."
                    onChange={(event) => patch(index, { purpose: event.target.value })}
                  />
                </div>

                <span className="sv-plan__path">
                  {row.slug === '' ? 'The home page' : `/${row.slug}`}
                </span>

                {clash(row.slug) ? (
                  <span className="sv-plan__clash">
                    <Icon name="warning" size={14} />
                    {`"${clash(row.slug)!.title}" is already here and has content on it, so this one
                      will be left alone. Rename it to build it somewhere else, or remove it.`}
                  </span>
                ) : sameName(row) ? (
                  <span className="sv-plan__clash">
                    <Icon name="warning" size={14} />
                    {`You already have a page called "${sameName(row)!.title}", at /${sameName(row)!.slug || ''}.
                      This one would be built as a second page. Remove it unless you meant that.`}
                  </span>
                ) : null}
              </div>

              <span className="sv-plan__tools">
                <button
                  type="button"
                  className="sv-btn"
                  data-variant="quiet"
                  data-icon="true"
                  disabled={index === 0}
                  aria-label={`Move ${row.title} up`}
                  onClick={() => move(index, -1)}
                >
                  <Icon name="arrow-up" size={16} />
                </button>
                <button
                  type="button"
                  className="sv-btn"
                  data-variant="quiet"
                  data-icon="true"
                  disabled={index === rows.length - 1}
                  aria-label={`Move ${row.title} down`}
                  onClick={() => move(index, 1)}
                >
                  <Icon name="arrow-down" size={16} />
                </button>
                <button
                  type="button"
                  className="sv-btn"
                  data-variant="quiet"
                  data-danger="true"
                  data-icon="true"
                  aria-label={`Remove ${row.title}`}
                  onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
                >
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </li>
          ))}
        </ul>

        {rows.length === 0 && (
          <p className="sv-empty__note">
            {nothingMissing
              ? 'Nothing obvious is missing. This site already covers what a site like it needs, so the builder had nothing to add.'
              : 'Every page has been removed. Plan again, or cancel and start from a blank page.'}
          </p>
        )}
      </Modal>
    );
  }

  // Building and done share a list, so the rows do not jump when it finishes.
  const finished = stage === 'done';

  return (
    <Modal
      title={finished ? 'Your site is built' : 'Building your site'}
      description={
        finished
          ? 'Everything arrived as a draft, so nothing is live until you publish it.'
          : 'One page at a time. This takes a moment per page.'
      }
      size="large"
      onClose={finished ? onClose : () => undefined}
      footer={
        finished ? (
          <button type="button" className="sv-btn" data-variant="primary" onClick={finish}>
            {homeId ? 'Open my home page' : 'Done'}
          </button>
        ) : undefined
      }
    >
      {/*
        * aria-live, because the only thing changing is a list of statuses. A
        * sighted person watches the ticks appear; without this nobody else knows
        * anything is happening at all.
        */}
      <ul className="sv-plan sv-plan--progress" aria-live="polite" aria-busy={!finished}>
        {rows.map((row) => (
          <li className="sv-plan__row" key={row.slug} data-progress={row.progress}>
            <span className="sv-plan__state" aria-hidden="true">
              {row.progress === 'built' && <Icon name="check" size={16} />}
              {row.progress === 'failed' && <Icon name="warning" size={16} />}
              {row.progress === 'skipped' && <Icon name="divider" size={16} />}
              {row.progress === 'building' && <span className="sv-spinner" />}
            </span>
            <span className="sv-plan__main">
              <span className="sv-plan__name">{row.title}</span>
              {row.error && <span className="sv-plan__why">{row.error}</span>}
            </span>
            <span className="sv-plan__status">
              {row.progress === 'waiting' && 'Waiting'}
              {row.progress === 'building' && 'Building'}
              {row.progress === 'built' && 'Built'}
              {row.progress === 'failed' && 'Not built'}
              {row.progress === 'skipped' && 'Left alone'}
            </span>
          </li>
        ))}
      </ul>

      {finished && (
        <p className="sv-plan__summary">
          {`${built} ${built === 1 ? 'page' : 'pages'} built.`}
          {skipped.length > 0
            && ` ${skipped.length} left alone, because ${skipped.length === 1 ? 'it' : 'they'} already had content.`}
          {failed.length > 0
            && ` ${failed.length} could not be built, and can be added by hand or planned again.`}
          {failed.length === 0 && ' Open any of them to change the words and the pictures.'}
        </p>
      )}
    </Modal>
  );
}
