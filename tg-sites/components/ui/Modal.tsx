'use client';

/**
 * The only dialog in the product.
 *
 * There were four: the block picker, the layout picker, the new/rename page
 * form, and a native window.confirm for deleting. Each had its own scrim, its
 * own escape handling, its own idea of how a header looks, and only one of
 * them trapped focus. That is four places to fix a bug and four chances for
 * them to drift apart.
 *
 * Everything a dialog needs is here so no caller has to remember it:
 * focus moves in on open and back to whatever opened it on close, Tab cannot
 * leave, Escape closes, clicking the scrim closes, and the page behind cannot
 * scroll.
 */

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

import { Icon } from '../editor/Icon';

export type ModalSize = 'small' | 'large';

/**
 * Where the dialog sits.
 *
 * `center` is the dialog everything else in the product uses. `left` is a panel
 * that fills the left edge top to bottom and slides in, for the one screen where
 * a centred box is the wrong shape: the section picker, which is a long list you
 * browse against the page still visible beside it. Andy asked for that one to be
 * a drawer rather than a pop-up (3 Aug 2026). It is the same dialog underneath,
 * with the same scrim, focus trap and Escape, only anchored and sized
 * differently, so nothing about how it behaves has to be learned twice.
 */
export type ModalPlacement = 'center' | 'left';

interface ModalProps {
  title: string;
  /** One line under the title. Optional, and usually worth it. */
  description?: string;
  size?: ModalSize;
  placement?: ModalPlacement;
  onClose: () => void;
  children: ReactNode;
  /** The buttons. Rendered in a footer band so every dialog ends the same way. */
  footer?: ReactNode;
}

export function Modal({
  title,
  description,
  size = 'small',
  placement = 'center',
  onClose,
  children,
  footer,
}: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  /** Whatever had focus before this opened, so it can be given back. */
  const opener = useRef<HTMLElement | null>(null);

  const focusable = useCallback(
    () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
        .filter((el) => el.offsetParent !== null)
        /*
         * tabindex="-1" means "reachable by script, not by Tab", and the
         * selector above cannot express that: `button:not([disabled])` matches
         * a button whatever its tabindex, so the exclusion in the last clause
         * only covers elements that have nothing else to match on.
         *
         * It matters because a dialog whose form submits on Enter carries a
         * hidden submit button with tabindex="-1". Without this filter that
         * button joins the focus ring, so opening the dialog puts focus on an
         * invisible control and Tab cycles through a stop nobody can see.
         */
        .filter((el) => el.getAttribute('tabindex') !== '-1'),
    [],
  );

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;

    // Focus the first real control rather than the close button, so opening a
    // form puts the cursor where you were going to type anyway.
    const first = focusable().find((el) => !el.hasAttribute('data-modal-close'));
    (first ?? dialog.current)?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = overflow;

      /*
       * Give focus back to whatever opened this.
       *
       * The first version only restored if focus was still INSIDE the dialog,
       * which sounded careful and never once fired: by the time a cleanup
       * runs React has already detached the node, so activeElement has fallen
       * back to <body> and `contains` is false. Focus was silently dropped on
       * the body every time, which for a keyboard user means being dumped at
       * the top of the page after closing a dialog.
       *
       * The real question is whether anything else has claimed focus in the
       * meantime. If it has, leave it alone; that would be rude.
       */
      const active = document.activeElement;
      const focusWasDropped = active === null || active === document.body;
      if (focusWasDropped && opener.current?.isConnected) opener.current.focus();
    };
  }, [focusable]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, focusable]);

  return (
    <div
      className="tg-scrim"
      data-placement={placement}
      onMouseDown={(event) => {
        // mousedown, not click: a click that STARTED inside the dialog and
        // ended on the scrim (a sloppy drag off a text selection) should not
        // throw away what someone just typed.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="tg-modal"
        data-size={size}
        data-placement={placement}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="tg-modal__head">
          <div>
            <h2 className="tg-modal__title" id={titleId}>
              {title}
            </h2>
            {description && (
              <p className="tg-modal__desc" id={descriptionId}>
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            className="tg-modal__close"
            data-modal-close="true"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tg-modal__body">{children}</div>

        {footer && <footer className="tg-modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Confirming something you cannot undo.
 *
 * Replaces window.confirm, which cannot be styled, cannot say which page it
 * means in the product's own voice, and looks like the browser is telling you
 * off. It also blocks the main thread, which is a strange thing to do to
 * someone who is about to lose work.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="tg-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="tg-btn"
            data-variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {/*
        The body is deliberately empty. Everything worth saying fits in the
        title and the one line under it, and padding it out with a restatement
        would only make it likelier to be skimmed.
      */}
      <span className="tg-visually-hidden">{description}</span>
    </Modal>
  );
}
