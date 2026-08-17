'use client';

/**
 * The activity tab: a running list of what has happened to this site.
 *
 * SELF-CONTAINED, LOADED WHEN OPENED, the same shape as the domains and custom
 * code panels. It reads its own list on mount rather than being handed one as a
 * prop, so the history is never in the settings page's payload for a tab nobody
 * opened, and a read happens once when the tab is first looked at.
 *
 * READ ONLY, AND IT SHOWS. There is no button here that changes anything: an
 * event is written by the mutation that caused it, never from this screen, so the
 * panel has no save bar and the settings screen hides its global one on this tab.
 * The actor and the wording arrive already resolved from the server (see
 * app/actions/activity.ts and lib/activity/log.ts); this only lays them out and
 * turns the timestamp into "3 hours ago".
 */

import { useEffect, useState, useTransition } from 'react';

import { listActivityAction } from '../../app/actions/activity';
import { absoluteDate, relativeTime, type ActivityLine } from '../../lib/activity/log';
import { Icon, type IconName } from '../editor/Icon';

/** The icon and colour band for each kind of event. */
function look(action: ActivityLine['action']): { icon: IconName; kind: string } {
  switch (action) {
    case 'page.create':
      return { icon: 'plus', kind: 'create' };
    case 'page.delete':
      return { icon: 'trash', kind: 'delete' };
    case 'page.publish':
      return { icon: 'check', kind: 'publish' };
  }
}

export function ActivityPanel() {
  const [lines, setLines] = useState<ActivityLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      try {
        setLines(await listActivityAction());
      } catch {
        // The one way this fails in practice is a session that ran out between
        // opening the screen and opening the tab. Say something a person can act
        // on rather than leaving the reading note up for ever.
        setError('We could not read the activity just now. Reload the page to try again.');
      }
    });
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <section className="tv-group" aria-label="Activity">
        <p className="sv-msg" role="alert">
          <Icon name="warning" size={16} />
          {error}
        </p>
      </section>
    );
  }

  if (!lines) return <p className="tv-note">Reading your activity…</p>;

  return (
    <section className="tv-group" aria-label="Activity">
      <p className="tv-note">
        What has happened to your site lately, newest first. Pages created,
        deleted and published show here, so you always know who changed what.
      </p>

      {lines.length === 0 ? (
        <p className="tv-note">
          Nothing yet. The moment somebody creates, deletes or publishes a page it
          will show up here.
        </p>
      ) : (
        <ol className="st-activity">
          {lines.map((line) => (
            <ActivityRow key={line.id} line={line} />
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function ActivityRow({ line }: { line: ActivityLine }) {
  const { icon, kind } = look(line.action);
  // Coerced rather than trusted: a Date survives the action boundary, but a
  // string would too, and new Date(aDate) is a no-op so this costs nothing.
  const when = new Date(line.createdAt);

  return (
    <li className="st-activity__row">
      <span className="st-activity__icon" data-kind={kind} aria-hidden="true">
        <Icon name={icon} size={15} />
      </span>
      <div className="st-activity__body">
        <p className="st-activity__summary">{line.summary}</p>
        <p className="st-activity__meta">
          {line.actor ? (
            <span className="st-activity__who">{line.actor}</span>
          ) : (
            // Slice one only ever records a member's own action, so a line with
            // nobody to name is one whose member has since left the site. A later
            // slice that records an event no person triggered should revisit this.
            <span className="st-activity__who st-activity__who--none">A former member</span>
          )}
          <span className="st-activity__dot" aria-hidden="true">
            ·
          </span>
          <time dateTime={when.toISOString()} title={absoluteDate(when)}>
            {relativeTime(when)}
          </time>
        </p>
      </div>
    </li>
  );
}
