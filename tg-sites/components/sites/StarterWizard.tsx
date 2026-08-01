'use client';

/**
 * Four questions, and then a site.
 *
 * THE ANSWER TO "I HAVE SIGNED UP, NOW WHAT". Before this, a new site was one
 * blank page and a picker of 73 section presets, which is the same problem Wix
 * solves with 800 templates you then fight for a fortnight. The presets were
 * never the missing piece.
 *
 * ONE SCREEN, NOT A THREE STEP FLOW. There are four questions. A wizard with a
 * progress bar and a Next button for four questions is ceremony, and ceremony is
 * exactly the bloat this product is meant not to have.
 *
 * THE THREE FIELDS ARE SITE SETTINGS, prefilled from them and saved back to
 * them. They are the same three the writing assistant reads, the structured data
 * publishes, and the Being found report complains about when they are blank. So
 * this is not a form somebody fills in and throws away: it is a friendlier front
 * door to the highest-value fields in the product. Nobody types them twice.
 *
 * NOTHING IS PUBLISHED, and the screen says so. The pages arrive as drafts, the
 * client reads them, changes what is wrong, and publishes when they are ready.
 *
 * ON SUCCESS IT OPENS THE EDITOR at the new home page rather than returning to
 * a list. "Here is your site" is the point of the whole thing, and a dashboard
 * showing five new rows is a worse answer than the site itself.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { applyStarterAction } from '../../app/actions/starters';
import { STARTERS } from '../../lib/content/starters';
import { Icon } from '../editor/Icon';
import { Modal } from '../ui/Modal';

export interface StarterProfile {
  company: string;
  town: string;
  about: string;
}

export function StarterWizard({
  profile,
  onClose,
}: {
  /** Whatever is already in settings, so nothing is asked twice. */
  profile: StarterProfile;
  onClose: () => void;
}) {
  const router = useRouter();

  const [choice, setChoice] = useState(STARTERS[0].id);
  const [company, setCompany] = useState(profile.company);
  const [town, setTown] = useState(profile.town);
  const [about, setAbout] = useState(profile.about);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const starter = STARTERS.find((entry) => entry.id === choice) ?? STARTERS[0];

  function build() {
    setMessage(null);
    startTransition(async () => {
      const result = await applyStarterAction(choice, { company, town, about });

      if (!result.ok) {
        setMessage(result.error);
        return;
      }

      /*
       * Straight into the editor at the home page. push rather than refresh,
       * because the dashboard seeds its list into state on mount and would not
       * pick up five new rows without a navigation anyway.
       */
      if (result.data.homePageId) {
        router.push(`/editor?page=${encodeURIComponent(result.data.homePageId)}`);
        return;
      }

      onClose();
      router.refresh();
    });
  }

  return (
    <Modal
      title="Build me a site"
      description="Four questions, and you will have something to edit rather than a blank page."
      size="large"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tg-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="tg-btn"
            data-variant="primary"
            onClick={build}
            disabled={busy}
          >
            {busy ? 'Building' : 'Build my site'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          build();
        }}
      >
        {message && (
          <p className="sv-msg" role="alert">
            <Icon name="warning" size={16} />
            {message}
          </p>
        )}

        {/*
          Radio inputs inside labels, rather than clickable divs with
          aria-pressed. A radio group is what this is, so a screen reader
          announces "1 of 2" and the arrow keys move between them for free.
        */}
        <fieldset className="sw-choices">
          <legend className="tv-field__label">How much site do you want?</legend>

          {STARTERS.map((entry) => (
            <label key={entry.id} className="sw-choice" data-picked={entry.id === choice}>
              <input
                type="radio"
                name="starter"
                value={entry.id}
                checked={entry.id === choice}
                onChange={() => setChoice(entry.id)}
              />
              <span>
                <strong>{entry.label}</strong>
                <span className="sw-choice__note">{entry.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/*
          WHAT THEY WILL GET, LISTED. Five new pages appearing without warning is
          a product doing something to somebody. Listed first, it is a product
          doing something for them.
        */}
        <ul className="sw-summary">
          {starter.summary.map((line) => (
            <li key={line}>
              <Icon name="check" size={14} />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="sv-field">
          <label htmlFor="sw-company">What is the business called?</label>
          <input
            id="sw-company"
            value={company}
            maxLength={120}
            placeholder="Sunvil Travel"
            autoComplete="off"
            onChange={(event) => setCompany(event.target.value)}
          />
          <small>
            Goes on the pages, and it is what we tell AI engines the business is
            called. Without it they cannot say whose website this is.
          </small>
        </div>

        <div className="sv-field">
          <label htmlFor="sw-town">Which town or city are you in?</label>
          <input
            id="sw-town"
            value={town}
            maxLength={80}
            placeholder="Leeds"
            autoComplete="off"
            onChange={(event) => setTown(event.target.value)}
          />
          <small>
            Leave it blank if you are online only. It helps an assistant answer
            "who near me arranges this".
          </small>
        </div>

        <div className="sv-field">
          <label htmlFor="sw-about">What do you arrange, and who for?</label>
          <textarea
            id="sw-about"
            rows={4}
            value={about}
            maxLength={1200}
            placeholder={
              'Tailor-made holidays to Greece and Cyprus, mostly for couples and '
              + 'families in their forties and up. Every trip is put together by '
              + 'somebody who has been there.'
            }
            onChange={(event) => setAbout(event.target.value)}
          />
          <small>
            One or two sentences in your own words. They go on the pages and they
            are the facts the writing assistant will stay inside afterwards.
          </small>
        </div>

        {/*
          Said before the button, not after. Somebody who thinks this puts a site
          with placeholder copy on their live domain will not press it.
        */}
        <p className="sw-note">
          <Icon name="check" size={16} />
          <span>
            Nothing goes live. Every page arrives as a draft for you to read and
            change, and the words in them are prompts telling you what to write
            there. You publish when you are happy.
          </span>
        </p>

        <button type="submit" className="tg-visually-hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}
