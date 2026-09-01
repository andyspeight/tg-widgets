'use client';

/**
 * The AI tab of the add-a-section dialog: describe a section, have it built.
 *
 * IT ADDS A NATIVE SECTION, not a preview of one. buildSectionAction returns a
 * Section in our own schema, already validated and sanitised, and this hands it
 * to the same insert path a preset or an import uses. So the moment it lands it
 * is selected on the canvas and editable by every control in the editor, which
 * is the whole promise: build it, then tweak it, with no second system.
 *
 * The panel itself is deliberately thin. It holds a description and a button,
 * shows the one failure the person can act on, and gets out of the way. All the
 * judgement, the palette, the brand, the validation and the repair, is on the
 * server where the key and the allowance are.
 */

import { useState } from 'react';

import { buildSectionAction, suggestNextSectionAction } from '../../app/actions/ai';
import type { Section } from '../../lib/content/schema';
import { Icon } from './Icon';

/**
 * A few openers, in the language of the job. They double as a hint of what the
 * builder is good at, and one click fills the box so an empty tab is never a
 * blank stare.
 */
const EXAMPLES = [
  'A hero for tailor-made trips to Greece, with an enquiry button',
  'Three reasons to book with us, each with an icon',
  'Our ABTA and ATOL protection as a row of trust badges',
  'How booking with us works, step by step',
];

export function AiPanel({
  onBuilt,
  pageSections,
  pageTitle,
}: {
  onBuilt: (section: Section) => void;
  /** The page so far, so the AI can propose what should come next. */
  pageSections?: Section[];
  pageTitle?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function suggest() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await suggestNextSectionAction({
        sections: pageSections ?? [],
        title: pageTitle ?? '',
      });
      if (result.ok) {
        onBuilt(result.section);
        return;
      }
      setError(result.error);
    } catch {
      setError('Something went wrong suggesting a section. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    const instruction = text.trim();
    if (!instruction || busy) return;

    setBusy(true);
    setError('');
    try {
      const result = await buildSectionAction({ instruction });
      if (result.ok) {
        // The insert selects it, so the dialog closes onto the new section ready
        // to edit. Nothing else to do here.
        onBuilt(result.section);
        return;
      }
      setError(result.error);
    } catch {
      setError('Something went wrong building that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed-ai-panel">
      <div className="ed-ai-panel__head">
        <Icon name="sparkle" size={24} />
        <h3>Describe the section you want</h3>
        <p>
          Say what it is for in your own words. It is built from your own blocks,
          so you can change every part of it after.
        </p>
      </div>

      <textarea
        className="ed-textarea"
        rows={3}
        value={text}
        placeholder="A hero for tailor-made trips to Greece, with a heading, a line about being planned by people who have been, and an enquiry button"
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
        aria-label="Describe the section"
      />

      <div className="ed-ai-panel__examples">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="ed-ai-panel__example"
            disabled={busy}
            onClick={() => setText(example)}
          >
            {example}
          </button>
        ))}
      </div>

      {error && (
        <p className="ed-help" role="alert">
          {error}
        </p>
      )}

      <div className="ed-ai-panel__go">
        <button
          type="button"
          className="ed-btn"
          data-variant="primary"
          disabled={busy || !text.trim()}
          onClick={() => void build()}
        >
          <Icon name="sparkle" size={14} />
          {busy ? 'Building it…' : 'Build it'}
        </button>
        {(pageSections?.length ?? 0) > 0 && (
          <button
            type="button"
            className="ed-btn"
            data-variant="ghost"
            disabled={busy}
            onClick={() => void suggest()}
            title="Let the AI propose the section that should come next on this page"
          >
            <Icon name="sparkle" size={14} />
            {busy ? 'Thinking…' : 'Suggest what comes next'}
          </button>
        )}
        {busy && (
          <span className="ed-ai-panel__wait">This takes a few seconds.</span>
        )}
      </div>
    </div>
  );
}
