'use client';

/**
 * Every version of this page we still hold, and a way back to any of them.
 *
 * WHAT RESTORE ACTUALLY DOES, because the word promises more than it should.
 *
 * It puts the old version into the DRAFT and leaves the live page alone. Somebody
 * opening this is already having a bad day: they published something wrong and want
 * Tuesday back. Restoring straight to live would be a second unreviewed publish
 * inside a minute, made by the person least able to check it calmly. So it lands in
 * the draft, they look at it, and they press Publish like any other change.
 *
 * It also goes through the editor's own commit, so Ctrl+Z undoes a restore like
 * anything else. That is why there is no confirm dialog in front of it: the action
 * is reversible, and a confirm on a reversible action trains people to click through
 * confirms on irreversible ones.
 *
 * WHY IT DOES NOT SAY WHO PUBLISHED EACH VERSION, except for you. auth_users is
 * self-only by policy, deliberately, so this screen can identify the signed-in
 * person and nobody else without a new query scoped by shared membership. That is a
 * real feature and not this one. Showing a raw user id in the meantime would be
 * worse than showing nothing.
 */

import { useEffect, useState } from 'react';

import { listPublishesAction, restorePublishAction } from '../../app/actions/pages';
import type { Page } from '../../lib/content/schema';
import { Modal } from '../ui/Modal';
import { Icon } from './Icon';

interface Entry {
  id: string;
  userId: string | null;
  title: string | null;
  createdAt: Date;
}

interface Props {
  pageId: string;
  /** The signed-in person, so their own entries can be marked. Null when unknown. */
  currentUserId: string | null;
  onRestore: (page: Page) => void;
  onClose: () => void;
}

/**
 * Dates in full rather than "3 days ago".
 *
 * Relative time reads well and is the wrong choice here. The question being asked is
 * "put it back to how it was on Tuesday", and "3 days ago" makes somebody count
 * backwards on their fingers to answer it. en-GB explicitly, because the default
 * locale is the SERVER's in some renders and a date that reads 03/07 to one person
 * and 07/03 to another is worse than either.
 */
const WHEN = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'full',
  timeStyle: 'short',
});

export function PublishHistory({ pageId, currentUserId, onRestore, onClose }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    listPublishesAction(pageId).then((result) => {
      // The modal can be closed before this resolves, and setting state on a gone
      // component is a warning in the console and a bug nobody can reproduce.
      if (!live) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEntries(result.data.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })));
    });

    return () => {
      live = false;
    };
  }, [pageId]);

  async function restore(entry: Entry) {
    setError(null);
    setRestoring(entry.id);

    const result = await restorePublishAction(pageId, entry.id);
    setRestoring(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.data) {
      // Null rather than an error: the page or the version is gone. Says so plainly
      // instead of leaving the dialog looking like it did nothing.
      setError('That version is no longer there. Close this and open it again.');
      return;
    }

    onRestore(result.data.content);
    onClose();
  }

  return (
    <Modal
      title="Version history"
      description="Every time this page is published we keep a copy. Putting one back replaces your draft and leaves the live page as it is, until you publish."
      size="large"
      onClose={onClose}
      footer={
        <button type="button" className="tg-btn" onClick={onClose}>
          Close
        </button>
      }
    >
      {error && (
        <p className="ph-error" role="alert">
          <Icon name="warning" size={16} />
          {error}
        </p>
      )}

      {entries === null && !error && <p className="ph-quiet">Looking up the history…</p>}

      {entries?.length === 0 && (
        <p className="ph-quiet">
          This page has not been published yet, so there is nothing to go back to. Once
          you publish, every version is kept here.
        </p>
      )}

      {entries && entries.length > 0 && (
        <ol className="ph-list">
          {entries.map((entry, index) => (
            <li className="ph-item" key={entry.id}>
              <div className="ph-item__what">
                <span className="ph-item__title">{entry.title || 'Untitled page'}</span>
                <span className="ph-item__when">
                  {WHEN.format(entry.createdAt)}
                  {currentUserId && entry.userId === currentUserId && ' · by you'}
                </span>
              </div>

              {/*
                The newest entry is what is on the live site right now, so restoring
                it would be a no-op dressed up as a rescue. Labelled instead.
              */}
              {index === 0 ? (
                <span className="ph-item__live">Live now</span>
              ) : (
                <button
                  type="button"
                  className="tg-btn"
                  disabled={restoring !== null}
                  onClick={() => restore(entry)}
                >
                  {restoring === entry.id ? 'Putting it back' : 'Put this back'}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
