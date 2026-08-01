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

import { useState, useTransition } from 'react';

import { previewImportAction, type ImportPreview } from '../../app/actions/import';
import type { Section } from '../../lib/content/schema';
import { Icon } from './Icon';

const PLACEHOLDER_HTML =
  'Paste the HTML here.\n\nIn Relume: open a page, Export, then copy the HTML.';
const PLACEHOLDER_CSS =
  'Paste the stylesheet here, if you have one.\n\nWithout it the design keeps its structure but not its styling.';

export function ImportPanel({ onAdd }: { onAdd: (sections: Section[]) => void }) {
  const [html, setHtml] = useState('');
  const [css, setCss] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
            From Relume, Figma, the slicer, or any site you have the code for. We
            cut it into sections you can move, edit and delete like any other.
          </p>
        </div>
      </div>

      <label className="ed-import__field">
        <span>HTML</span>
        <textarea
          rows={8}
          value={html}
          spellCheck={false}
          placeholder={PLACEHOLDER_HTML}
          onChange={(event) => setHtml(event.target.value)}
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
