/**
 * The editor's icon set.
 *
 * Hand-drawn in the Lucide style: 24x24 box, 2px stroke, round caps and
 * joins, no fills. One family, one weight, so nothing looks borrowed.
 *
 * WHY THIS EXISTS
 * The first version used characters like ▤ ▭ ◆ ✕ as functional icons. They
 * render differently on every platform, cannot be styled properly, are
 * invisible to a screen reader, and read as clip art. The design rules ban
 * them outright. This replaces every one of them.
 *
 * Not fetched from the Lucide package: this is a shell with no build-time
 * icon dependency, and twenty-odd paths is smaller than the dependency.
 * Swap to the real package if the set grows much past this.
 */

import type { SVGProps } from 'react';

export type IconName =
  // structure
  | 'section'
  | 'columns'
  | 'chevron-right'
  | 'chevron-down'
  // blocks
  | 'heading'
  | 'text'
  | 'quote'
  | 'list'
  | 'sparkle'
  | 'image'
  | 'video'
  | 'gallery'
  | 'button'
  | 'buttons'
  | 'divider'
  | 'spacer'
  | 'code'
  // actions
  | 'plus'
  | 'more'
  | 'trash'
  | 'copy'
  | 'arrow-up'
  | 'arrow-down'
  | 'grip'
  | 'undo'
  | 'redo'
  | 'upload'
  | 'download'
  | 'check'
  | 'close'
  | 'search'
  | 'warning'
  | 'blank'
  // viewports
  | 'desktop'
  | 'tablet'
  | 'phone';

/**
 * Path data only. Every icon inherits stroke from the shared <svg>, so a
 * new one cannot accidentally arrive at a different weight.
 */
const PATHS: Record<IconName, string> = {
  section: 'M3 5h18M3 12h18M3 19h18',
  columns: 'M4 4h6v16H4zM14 4h6v16h-6z',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',

  heading: 'M6 4v16M18 4v16M6 12h12',
  text: 'M4 6h16M4 12h16M4 18h10',
  quote: 'M9 7H6a2 2 0 0 0-2 2v3h5V7zM19 7h-3a2 2 0 0 0-2 2v3h5V7zM4 12v2a3 3 0 0 0 3 3M14 12v2a3 3 0 0 0 3 3',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  sparkle: 'M12 3l2.1 5.4L19.5 10l-5.4 2.1L12 17.5l-2.1-5.4L4.5 10l5.4-1.6z',
  image: 'M3 5h18v14H3zM8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 19',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3z',
  gallery: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  button: 'M3 8h18v8H3zM8 12h8',
  buttons: 'M2 8h9v8H2zM13 8h9v8h-9z',
  divider: 'M3 12h18',
  spacer: 'M12 4v16M8 7l4-3 4 3M8 17l4 3 4-3',
  code: 'M8 6l-5 6 5 6M16 6l5 6-5 6',

  plus: 'M12 5v14M5 12h14',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  undo: 'M4 10h11a5 5 0 0 1 0 10h-5M4 10l5-5M4 10l5 5',
  redo: 'M20 10H9a5 5 0 0 0 0 10h5M20 10l-5-5M20 10l-5 5',
  upload: 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2M12 15V3M7 8l5-5 5 5',
  download: 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2M12 3v12M7 10l5 5 5-5',
  check: 'M4 12l5 5L20 6',
  // Triangle with a bar and a dot. Drawn rather than filled so it sits at the
  // same 2px weight as everything else and never reads as an error icon.
  warning: 'M12 4L2.5 20h19L12 4zM12 10v5M12 17.5v.5',
  close: 'M6 6l12 12M18 6L6 18',
  blank: '',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',

  desktop: 'M3 5h18v11H3zM8 20h8M12 16v4',
  tablet: 'M6 3h12v18H6zM11 18h2',
  phone: 'M8 3h8v18H8zM11 18h2',
};

/**
 * Icons that read as a solid shape rather than an outline. Kept to one
 * (sparkle) so the set stays visually consistent.
 */
const FILLED = new Set<IconName>(['sparkle']);

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /**
   * Icons are decorative by default: they sit next to a text label, or
   * inside a button that already carries an aria-label. Pass a label only
   * when the icon IS the whole meaning.
   */
  label?: string;
}

export function Icon({ name, size = 16, label, ...rest }: IconProps) {
  const path = PATHS[name];
  if (path === undefined) return null;

  // A deliberate empty icon, used to keep unticked menu rows aligned with
  // ticked ones. Renders the box without drawing in it.
  if (path === '') {
    return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" />;
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={FILLED.has(name) ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
    >
      <path d={path} />
    </svg>
  );
}
