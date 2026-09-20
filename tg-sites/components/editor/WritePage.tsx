'use client';

/**
 * Say what the page is about, and have it written.
 *
 * ANDY, 17 SEP 2026: "Ive added the page, but there is nowhere for me to tell
 * the AI what the page is about and form it to write the content and source the
 * images". He was right. The whole-page writer only existed at the moment of
 * creation, behind the "Describe it with AI" start in the Add page composer.
 * Choose one of the designed pages instead, which is the obvious thing to do
 * when the list of them is the first thing you see, and you got a real design
 * carrying placeholder copy with nowhere to say what it was for.
 *
 * SO IT LIVES IN THE EMPTY PROPERTIES PANEL, which is what somebody is looking
 * at the moment they add a page and click nothing: a panel that until now said
 * "select a section and its settings appear here" and nothing else. The page is
 * the thing with no settings screen of its own, and this is the page-level
 * thing worth having.
 *
 * IT FILLS, IT DOES NOT REBUILD. See writePageAction: the sections that come
 * back are the sections that went in, with new words and new photographs. The
 * design they chose is not the assistant's to replace.
 */

import { useState } from 'react';

import { writePageAction } from '../../app/actions/ai';
import { MAX_PAGE_BRIEF } from '../../lib/ai/page-build';
import type { Page } from '../../lib/content/schema';

export function WritePage({
  page,
  onCommit,
}: {
  page: Page;
  onCommit: (next: (current: Page) => Page) => void;
}) {
  const [brief, setBrief] = useState('');
  const [photos, setPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function write() {
    const said = brief.trim();
    if (!said) {
      setError('Say what the page is about.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);

    const result = await writePageAction({
      title: page.title,
      brief: said,
      sections: page.sections,
      photos,
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    /*
     * ONE COMMIT, so the whole page is one step on the editor's own history and
     * Undo puts every word and every picture back together. The same contract
     * Luna Assist's Apply has, for the same reason.
     */
    onCommit((current) => ({ ...current, sections: result.sections }));

    /*
     * WHAT LANDED, NOT WHAT WAS ASKED FOR. This used to report the size of the
     * photo plan, which is the number of places a picture COULD have gone. A site
     * with no photo library configured was told "six pictures" and got none
     * (20 Sep 2026). writePageAction returns the count that was actually written
     * in, so a run that found nothing says so rather than claiming six.
     */
    if (result.pictures > 0) {
      setDone(
        `Written, and ${result.pictures === 1 ? 'a new picture' : `${result.pictures} new pictures`}. Undo puts it back.`,
      );
    } else if (photos) {
      setDone('Written. No new pictures came back, so the ones on the page are the ones that were there. Undo puts it back.');
    } else {
      setDone('Written. Undo puts it back.');
    }
  }

  return (
    <div className="ed-write">
      <p className="ed-write__lead">
        Say what this page is about and it will write the words into the design
        you chose, and find pictures to match.
      </p>

      <label className="ed-write__label" htmlFor="ed-write-brief">
        What is this page about?
      </label>
      <textarea
        id="ed-write-brief"
        className="ed-input ed-write__box"
        value={brief}
        placeholder="For example: Santorini for couples, where to stay on the caldera and the quieter east coast, and how we plan the days."
        maxLength={MAX_PAGE_BRIEF}
        rows={5}
        disabled={busy}
        onChange={(event) => {
          setBrief(event.target.value);
          setDone(null);
        }}
      />

      {/*
        Asked rather than assumed. A page somebody has already put their own
        photographs on should not have them swapped for stock because they
        wanted the words rewritten, and the only way to know which is which is
        to ask.
      */}
      <label className="ed-write__check">
        <input
          type="checkbox"
          checked={photos}
          disabled={busy}
          onChange={(event) => setPhotos(event.target.checked)}
        />
        <span>Find pictures to match</span>
      </label>

      {error && (
        <p className="ed-write__error" role="alert">
          {error}
        </p>
      )}
      {done && <p className="ed-write__done">{done}</p>}

      <button
        type="button"
        className="ed-btn"
        data-variant="primary"
        disabled={busy || !brief.trim()}
        onClick={write}
      >
        {busy ? 'Writing the page' : 'Write this page'}
      </button>

      {busy && (
        <p className="ed-write__note">
          It reads every heading and paragraph on the page and writes them
          together, so this takes a few seconds.
        </p>
      )}
    </div>
  );
}
