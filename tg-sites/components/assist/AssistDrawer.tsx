'use client';

/**
 * Luna Assist on the site dashboard: a button in the row of actions, and the
 * same conversation in a drawer down the right.
 *
 * A DRAWER RATHER THAN A SCREEN, which is direction A's answer on the dashboard
 * (docs/tg-sites-copilot-review.md, section 8): the person is looking at their
 * site's numbers and pages, and an assistant that takes the screen away from
 * them to answer a question about what is on it is the wrong trade. The
 * dashboard stays where it is and the conversation opens beside it.
 *
 * Mounted but closed costs nothing: the panel is not rendered until it is
 * opened, so no fetch and no state until somebody asks for it.
 */

import { useCallback, useEffect, useState } from 'react';

import { ASSISTANT_NAME } from '../../lib/assist/brand';
import { Icon } from '../editor/Icon';
import { AssistPanel } from './AssistPanel';

export function AssistDrawer({ siteName = null }: { siteName?: string | null }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, open]);

  return (
    <>
      <button type="button" className="sv-btn" onClick={() => setOpen(true)} aria-expanded={open}>
        <Icon name="sparkle" size={16} />
        {ASSISTANT_NAME}
      </button>

      {open && (
        <div className="ed-assist-scrim" role="presentation" onClick={close}>
          <div
            className="ed-assist-dock"
            role="dialog"
            aria-modal="true"
            aria-label={ASSISTANT_NAME}
            onClick={(event) => event.stopPropagation()}
          >
            <AssistPanel variant="drawer" siteName={siteName} onClose={close} />
          </div>
        </div>
      )}
    </>
  );
}
