'use client';

/**
 * The control that replaced "type a single character".
 *
 * TWO WAYS IN, ONE VALUE. The button opens the library; the box beside it takes
 * whatever somebody types. They write to the same prop, because the stored
 * value has always been a plain string and the renderer decides at draw time
 * whether it names an icon or is a character to print.
 *
 * WHY THE BOX IS STILL HERE, when the library has 1,817 icons in it. The same
 * reason ImageField still accepts a URL: a client who wants a flag, or a
 * currency symbol, or the one emoji their brand uses, should not be told that
 * the thing they can see on their keyboard is unavailable. It is also the
 * escape hatch for an icon we have not thought of, and it is what keeps every
 * page built before 1 Aug 2026 working without a migration.
 *
 * IT NEVER FOCUSES OR SCROLLS AS PART OF DRAWING ITSELF. The properties pane
 * redraws on every keystroke, so a control that grabbed focus while rendering
 * would take the cursor out of the box being typed into. The picker focuses
 * its own search box, but that happens on a click opening a dialog, which is a
 * real action rather than a redraw.
 */

import { useState } from 'react';

import { isIconName } from '../../lib/content/icons';
import { ContentIcon } from '../render/content-icon';
import { Icon } from './Icon';
import { IconPicker } from './IconPicker';

export function IconField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const named = isIconName(value);

  return (
    <>
      <div className="if-row">
        <button
          type="button"
          className="if-preview"
          onClick={() => setPicking(true)}
          aria-label={named ? `Icon: ${value}. Choose another` : 'Choose an icon'}
        >
          {/*
            What the page will actually draw, drawn the same way. The preview
            is the real renderer rather than a picture of one, so a character
            looks like a character here too and nobody is surprised on publish.
          */}
          {named ? (
            <ContentIcon name={value} className="if-preview__icon" />
          ) : (
            <span className="if-preview__char">{value || <Icon name="sparkle" size={18} />}</span>
          )}
        </button>

        <button type="button" className="tg-btn if-choose" onClick={() => setPicking(true)}>
          {named ? 'Change' : 'Choose an icon'}
        </button>

        <input
          className="ed-input if-typed"
          type="text"
          value={value}
          maxLength={60}
          aria-label="Icon name or a character"
          placeholder="or type an emoji"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>

      {picking && (
        <IconPicker
          value={value}
          onChoose={(name) => {
            onChange(name);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
