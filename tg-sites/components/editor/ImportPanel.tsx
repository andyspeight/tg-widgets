'use client';

/**
 * Bringing a design in from Relume, Figma or the slicer.
 *
 * TWO STEPS, AND THE FIRST ONE IS NOT A COMMITMENT. Paste, then look at what we
 * made of it, then choose. An importer that dropped a whole page straight onto
 * the canvas would be one nobody dares press, because the only way to find out
 * what it does is to do it and then undo it forty times.
 *
 * THE PASTE IS NOT READ IN THIS BROWSER. The cleaning is parser backed, and
 * shipping a parser to everybody who opens the editor to serve the few who
 * paste a design is the wrong trade. previewImportAction does the work and
 * hands back sections; this screen only ever holds strings and the answer.
 *
 * WHAT WAS REMOVED IS SAID OUT LOUD. A design that arrives quietly missing its
 * contact form, its fonts and its animations is one somebody spends an
 * afternoon comparing against the original. Saying it up front costs three
 * lines and turns a mystery into a decision.
 */

import { useEffect, useState, useTransition } from 'react';

import { previewImportAction, type ImportPreview } from '../../app/actions/import';
import { readSlice } from '../../lib/import/slice';
import type { Section } from '../../lib/content/schema';
import { Icon } from './Icon';

const PLACEHOLDER_HTML =
  'Paste the HTML here.\n\nIn Relume: open a page, Export, then copy the HTML.';
const PLACEHOLDER_CSS =
  'Paste the stylesheet here, if you have one.\n\nWithout it the design keeps its structure but not its styling.';

/**
 * A section the Slicer sent, waiting in the editor to be added.
 *
 * `ts` is the stamp the extension put on it, and it is how a section is told
 * apart from the others and reported back as used once it lands, so the same
 * capture is not offered twice.
 */
interface IncomingSlice {
  ts: number;
  title: string;
  html: string;
  css: string;
}

export function ImportPanel({ onAdd }: { onAdd: (sections: Section[]) => void }) {
  const [html, setHtml] = useState('');
  const [css, setCss] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [incoming, setIncoming] = useState<IncomingSlice[]>([]);
  const [connected, setConnected] = useState(false);

  /*
   * SECTIONS SENT STRAIGHT FROM THE SLICER, with no copy-paste.
   *
   * The Slicer's bridge content script runs on this domain and hands whatever is
   * waiting to the page with postMessage; when this panel opens it also asks the
   * bridge to re-send, so a capture made before the tab was here still turns up.
   * Nothing arriving this way is trusted more than a paste: it goes through the
   * SAME previewImportAction, which sanitises it. The one check here is shape, so
   * a stray message on the page cannot make the list throw. See tg-slicer/bridge.js.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { source?: unknown; ready?: unknown; slices?: unknown } | null;
      if (!data || data.source !== 'tgs-slicer') return;

      // The bridge says hello even with an empty outbox, so we can show the
      // handoff is connected before anything has been captured.
      if (data.ready) setConnected(true);

      if (!Array.isArray(data.slices)) return;
      const clean: IncomingSlice[] = [];
      for (const raw of data.slices as unknown[]) {
        const slice = raw as Record<string, unknown>;
        if (typeof slice.html !== 'string' || !slice.html.trim()) continue;
        clean.push({
          ts: typeof slice.ts === 'number' ? slice.ts : Date.now() + clean.length,
          title: typeof slice.title === 'string' && slice.title ? slice.title : 'Captured section',
          html: slice.html,
          css: typeof slice.css === 'string' ? slice.css : '',
        });
      }
      if (clean.length) {
        setIncoming((current) => {
          const seen = new Set(current.map((entry) => entry.ts));
          return [...current, ...clean.filter((entry) => !seen.has(entry.ts))];
        });
      }
    };

    window.addEventListener('message', onMessage);
    // Ask the bridge for anything already waiting.
    window.postMessage({ source: 'tgs-sites', request: true }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const addSlice = (slice: IncomingSlice) => {
    setError(null);
    startTransition(async () => {
      const result = await previewImportAction({ html: slice.html, css: slice.css });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onAdd(result.data.sections.map((entry) => entry.section));
      // Tell the bridge it is used, so it is cleared from the outbox and never
      // offered again, then drop it from the list here.
      window.postMessage({ source: 'tgs-sites', consumed: [slice.ts] }, window.location.origin);
      setIncoming((current) => current.filter((entry) => entry.ts !== slice.ts));
    });
  };

  const read = () => {
    setError(null);
    startTransition(async () => {
      const result = await previewImportAction({ html, css });
      if (!result.ok) {
        setPreview(null);
        setError(result.error);
        return;
      }
      setPreview(result.data);
      // Everything ticked to start with. Somebody who pasted one section wants
      // that section, and somebody who pasted a page usually wants the page.
      setChosen(new Set(result.data.sections.map((_, index) => index)));
    });
  };

  const toggle = (index: number) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const add = () => {
    if (!preview) return;
    const sections = preview.sections
      .filter((_, index) => chosen.has(index))
      .map((entry) => entry.section);
    if (sections.length) onAdd(sections);
  };

  if (preview) {
    return (
      <div className="ed-import">
        <div className="ed-import__found">
          <h3>
            {preview.sections.length === 1
              ? 'One section found'
              : `${preview.sections.length} sections found`}
          </h3>
          <button type="button" className="ed-import__again" onClick={() => setPreview(null)}>
            Paste something else
          </button>
        </div>

        <ul className="ed-import__list">
          {preview.sections.map((entry, index) => (
            <li key={index}>
              <label className="ed-import__row">
                <input
                  type="checkbox"
                  checked={chosen.has(index)}
                  onChange={() => toggle(index)}
                />
                <span className="ed-import__name">{entry.label}</span>
                <span className="ed-import__slots">
                  {entry.slots === 1 ? '1 thing to edit' : `${entry.slots} things to edit`}
                </span>
              </label>
            </li>
          ))}
        </ul>

        {preview.removed.length > 0 && (
          <div className="ed-import__removed">
            <h4>Left behind</h4>
            <p>
              These cannot go on a live site, or belong somewhere else in here:{' '}
              {preview.removed.join(', ')}.
            </p>
          </div>
        )}

        <div className="ed-import__actions">
          <button
            type="button"
            className="ed-btn" data-variant="primary"
            disabled={chosen.size === 0}
            onClick={add}
          >
            {chosen.size === 1 ? 'Add 1 section' : `Add ${chosen.size} sections`}
          </button>
          <p className="ed-import__note">
            The words and the pictures stay editable. The layout and the styling
            come across as they were drawn.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ed-import">
      <div className="ed-import__intro">
        <Icon name="code" size={24} />
        <div>
          <h3>Paste a design</h3>
          <p>
            From Relume, Figma, or any site you have the code for. Captured a
            section with the Slicer? Paste it straight into the HTML box and it
            splits itself. We cut it into sections you can move, edit and delete
            like any other.
          </p>
        </div>
      </div>

      {/*
        Always shown, so the handoff is visible whether or not a capture is
        waiting. The badge turns on when the Slicer's bridge says hello, which
        is the one thing that tells you at a glance the wiring is live.
      */}
      <div className="ed-import__slicer">
        <h4>
          From the Slicer
          {connected && <span className="ed-import__slicer-live">connected</span>}
        </h4>
        {incoming.length > 0 ? (
          <>
            <ul>
              {incoming.map((slice) => (
                <li key={slice.ts}>
                  <span className="ed-import__slicer-name" title={slice.title}>{slice.title}</span>
                  <button
                    type="button"
                    className="ed-btn"
                    data-variant="primary"
                    disabled={pending}
                    onClick={() => addSlice(slice)}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
            <p className="ed-import__note">
              Captured with the Slicer on another site. Added straight in, no paste.
            </p>
          </>
        ) : (
          <p className="ed-import__note">
            {connected
              ? 'Ready and waiting. Capture a section on any site, click Send to Travelgenix Sites, and it turns up here to add on one click.'
              : 'Capture a section on another site with the Slicer, click Send to Travelgenix Sites, and it lands here with no copy-paste. Load the Slicer extension and open this editor to connect it.'}
          </p>
        )}
      </div>

      <label className="ed-import__field">
        <span>HTML</span>
        <textarea
          rows={8}
          value={html}
          spellCheck={false}
          placeholder={PLACEHOLDER_HTML}
          /*
            A Slicer bundle pasted here splits itself: readSlice pulls the markup
            and the stylesheet apart into the two boxes. Anything that is not a
            bundle (a person typing HTML) is left exactly where it was typed.
          */
          onChange={(event) => {
            const slice = readSlice(event.target.value);
            if (slice) {
              setHtml(slice.html);
              setCss(slice.css);
            } else {
              setHtml(event.target.value);
            }
          }}
        />
      </label>

      <label className="ed-import__field">
        <span>Stylesheet</span>
        <textarea
          rows={6}
          value={css}
          spellCheck={false}
          placeholder={PLACEHOLDER_CSS}
          onChange={(event) => setCss(event.target.value)}
        />
      </label>

      {error && <p className="ed-import__error">{error}</p>}

      <div className="ed-import__actions">
        <button
          type="button"
          className="ed-btn" data-variant="primary"
          disabled={pending || !html.trim()}
          onClick={read}
        >
          {pending ? 'Reading' : 'Read the design'}
        </button>
        <p className="ed-import__note">
          Nothing is added to your page until you have seen what we made of it.
        </p>
      </div>
    </div>
  );
}
