'use client';

/**
 * An overflow menu.
 *
 * Replaces rows of unlabelled icon buttons. Every action carries a word, the
 * trigger meets the 44px target, and it closes on Escape or an outside click.
 * Shared by the outline and the top bar so both behave the same.
 *
 * WHY THE PANEL IS PORTALLED OUT OF THE OUTLINE
 * The outline is a scroll pane (overflow-y: auto), and an absolutely-positioned
 * panel inside it is clipped by that scroll box: opening the menu on a section
 * showed only the top half of it (Andy, 7 Aug 2026). The panel is lifted out of
 * that scroll box so it draws in full wherever the trigger sits, and placed by
 * measurement the same way ItemToolbar places its popover: fixed to the
 * viewport, right edge under the trigger's right edge, clamped so it never runs
 * off an edge and lifting above the trigger when there is no room below. A
 * layout effect does the placing, so it never paints in the wrong spot first.
 *
 * IT IS PORTALLED TO .ed-root, NOT THE BODY. The editor's colours live in
 * variables on .ed-root (--ed-panel, --ed-line, the shadow), so a panel in the
 * bare body loses its background, border and shadow and reads as floating text
 * over the page (Andy, 7 Aug 2026, again). .ed-root fills the viewport and
 * carries no transform, so a fixed panel inside it is still placed against the
 * viewport, keeps the tokens and the current theme, and still escapes the
 * outline's overflow because it no longer sits inside it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export type MenuItem =
  | { separator: true }
  | { heading: string; separator?: false }
  | {
      separator?: false;
      icon: IconName;
      label: string;
      /**
       * A second, quieter value: a size, a shortcut, a count.
       *
       * Its own column rather than glued to the label with a separator. The
       * preview widths read "Small laptop · 1024px" as one string, which wrapped
       * to two lines in a 184px menu and left the numbers in a ragged column
       * nobody could compare. Right-aligned and tabular, they line up.
       */
      hint?: string;
      onClick: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** Set for items that form a choice. Renders a tick and marks the role. */
      checked?: boolean;
    };

export function Menu({
  label,
  items,
  icon = 'more',
  children,
}: {
  label: string;
  items: MenuItem[];
  icon?: IconName;
  /** Optional visible text on the trigger. Icon-only without it. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  /*
   * PLACE THE PANEL BY MEASUREMENT, the same idea as ItemToolbar's popover.
   *
   * The trigger's box gives the anchor; the panel's own box gives the size to
   * clamp. Right edge under the trigger's right edge (the old right: 0), a hair
   * below it, then held inside the window on every side. If it would run off the
   * bottom it lifts to sit above the trigger instead, and failing that it is
   * pinned to the top so the first items are always reachable. A layout effect,
   * so the clamp happens before the browser paints.
   */
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const trigger = wrap.current?.firstElementChild as HTMLElement | null;
      const menu = panel.current;
      if (!trigger || !menu) return;
      const t = trigger.getBoundingClientRect();
      const m = menu.getBoundingClientRect();
      const gap = 4;
      const margin = 8;

      let left = t.right - m.width;
      left = Math.max(margin, Math.min(left, window.innerWidth - m.width - margin));

      let top = t.bottom + gap;
      if (top + m.height > window.innerHeight - margin) {
        const above = t.top - gap - m.height;
        top = above >= margin ? above : Math.max(margin, window.innerHeight - m.height - margin);
      }
      setPos({ top, left });
    }
    place();
    /*
     * Reposition while it is open: a scroll in the outline (capture, so a scroll
     * in any ancestor counts) or a window resize would otherwise leave the panel
     * behind, floating away from its trigger.
     */
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onDown(event: MouseEvent) {
      const target = event.target as Node;
      // The panel is portalled out of wrap, so it needs its own check or a click
      // on the menu itself would count as an outside click.
      if (wrap.current?.contains(target)) return;
      if (panel.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /*
   * WHERE THE PANEL IS PAINTED. The nearest editor root, so it keeps the colour
   * variables and the theme; the bare body would strip its background and border
   * (see the header note). Always found for the outline and top-bar menus, which
   * both live under .ed-root; the body is a last resort that should not be hit.
   */
  const host =
    typeof document === 'undefined'
      ? null
      : wrap.current?.closest('.ed-root, .sv-root') ?? document.body;

  return (
    <div className="ed-menu-wrap" ref={wrap}>
      <button
        type="button"
        className="ed-btn"
        data-variant="ghost"
        data-icon={children ? undefined : 'true'}
        aria-label={children ? undefined : label}
        title={children ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={icon} size={18} />
        {children}
      </button>

      {open && host &&
        createPortal(
          <div
            ref={panel}
            className="ed-menu"
            role="menu"
            // Fixed to the viewport and placed by the layout effect. Hidden for
            // the one frame before it is measured, so it is never seen in the
            // wrong spot; right/top come from the inline style, not the sheet.
            style={
              pos
                ? { position: 'fixed', top: pos.top, left: pos.left, right: 'auto' }
                : { position: 'fixed', top: 0, left: 0, right: 'auto', visibility: 'hidden' }
            }
          >
            {items.map((item, index) => {
              if ('separator' in item && item.separator) return <hr key={index} />;
              if ('heading' in item) {
                return (
                  <p key={index} className="ed-menu__heading">
                    {item.heading}
                  </p>
                );
              }
              const isChoice = item.checked !== undefined;
              return (
                <button
                  key={index}
                  type="button"
                  role={isChoice ? 'menuitemradio' : 'menuitem'}
                  aria-checked={isChoice ? item.checked : undefined}
                  disabled={item.disabled}
                  data-variant={item.danger ? 'danger' : undefined}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                >
                  <Icon name={isChoice ? (item.checked ? 'check' : 'blank') : item.icon} size={16} />
                  <span className="ed-menu__label">{item.label}</span>
                  {item.hint && <span className="ed-menu__hint">{item.hint}</span>}
                </button>
              );
            })}
          </div>,
          host,
        )}
    </div>
  );
}
