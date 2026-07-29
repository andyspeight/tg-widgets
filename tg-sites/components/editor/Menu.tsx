'use client';

/**
 * An overflow menu.
 *
 * Replaces rows of unlabelled icon buttons. Every action carries a word, the
 * trigger meets the 44px target, and it closes on Escape or an outside click.
 * Shared by the outline and the top bar so both behave the same.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type MenuItem =
  | { separator: true }
  | { heading: string; separator?: false }
  | {
      separator?: false;
      icon: IconName;
      label: string;
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

  useEffect(() => {
    if (!open) return;

    function onDown(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
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

      {open && (
        <div className="ed-menu" role="menu">
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
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
