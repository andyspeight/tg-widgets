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
  | 'grid'
  | 'crumbs'
  | 'file'
  | 'read-more'
  | 'copyright'
  | 'shape'
  | 'coupon'
  | 'whatsapp'
  | 'chevron-right'
  | 'chevron-down'
  // blocks
  | 'heading'
  | 'text'
  | 'quote'
  | 'list'
  | 'nav'
  | 'social'
  | 'steps'
  | 'stats'
  | 'logos'
  | 'cards'
  | 'accordion'
  | 'tabs'
  | 'slider'
  | 'table'
  | 'sparkle'
  | 'image'
  | 'video'
  | 'gallery'
  | 'map'
  | 'compare'
  | 'testimonial'
  | 'audio'
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
  | 'arrow-left'
  | 'arrow-right'
  | 'panel-left'
  | 'panel-right'
  | 'grip'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'list-ordered'
  | 'clear-format'
  | 'text-colour'
  | 'highlight'
  | 'align-left'
  | 'align-centre'
  | 'align-right'
  | 'history'
  | 'undo'
  | 'redo'
  | 'upload'
  | 'download'
  | 'check'
  | 'close'
  | 'search'
  | 'theme'
  | 'warning'
  | 'edit'
  | 'eye'
  | 'link'
  | 'link-off'
  | 'blank'
  // people
  | 'user'
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
  // Four cells: what a grid is, and distinct from `columns` at a glance,
  // which is two tall bars.
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  // A short run, a chevron, a longer run: a trail. Deliberately not `nav`,
  // which is three equal dashes, and not a plain chevron.
  crumbs: 'M3 12h4M9.5 9l2.5 3-2.5 3M15 12h6',
  // A sheet with a folded corner. Deliberately not a download arrow, which is
  // the action; this is the thing.
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  // Three full lines, a short one, and a chevron down: text that carries on
  // below. Deliberately not `text`, which is four equal rules.
  'read-more': 'M4 5h16M4 10h16M4 15h9M9 19l3 3 3-3',
  // A circle with a c in it, drawn rather than set as a character: an icon set
  // of stroked paths with one glyph in it would sit at a different weight.
  copyright: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M14.6 9.6a3.4 3.4 0 1 0 0 4.8',
  // A circle and a square, overlapping: the two shapes that are the block,
  // rather than one of them standing for all six.
  shape: 'M9 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9M11 11h9v9h-9z',
  // A ticket with a notch out of each side, which is what a coupon looks like
  // everywhere it has ever been printed.
  coupon: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 8 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-8M10 9v6',
  // A speech bubble with a tail at the bottom left, which is the shape
  // WhatsApp uses. Drawn in the set's own 2px stroke rather than lifted from
  // the brand mark: a filled green logo among 67 outlined icons reads as a
  // sticker somebody pasted on.
  whatsapp: 'M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l2-5.4A8.5 8.5 0 1 1 21 11.5M9 9.5c0 3 2.5 5.5 5.5 5.5',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',

  heading: 'M6 4v16M18 4v16M6 12h12',
  text: 'M4 6h16M4 12h16M4 18h10',
  quote: 'M9 7H6a2 2 0 0 0-2 2v3h5V7zM19 7h-3a2 2 0 0 0-2 2v3h5V7zM4 12v2a3 3 0 0 0 3 3M14 12v2a3 3 0 0 0 3 3',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  // Three separated dashes on one line: a row of links. Deliberately not the
  // burger, which is `section`, and not full-width rules, which is `text`.
  nav: 'M3 12h4M10 12h4M17 12h4',
  // Three linked circles: a row of accounts, which is what the block is. Not
  // the share glyph, which is one node branching to two and means sending
  // this page somewhere rather than pointing at an account.
  social: 'M6 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM23 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  // Three markers down the left with a line through them, and a line of words
  // beside each. The connector is what tells it apart from `list`.
  steps: 'M6 4v16M6 5.5a1.5 1.5 0 1 0 0 .01M6 12a1.5 1.5 0 1 0 0 .01M6 18.5a1.5 1.5 0 1 0 0 .01M11 5.5h9M11 12h9M11 18.5h9',
  // Three tall figures with a short word under each: the shape of a stats row
  // seen from across the room. Not `table`, which is a ruled grid, and not
  // `chart`, because nothing here plots anything.
  stats: 'M4 5v9M12 8v6M20 4v10M3 18h2M11 18h2M19 18h2',
  // Three rounded badges on one line, the middle one taller, which is the point:
  // logos have no common ratio and this block gives them a common HEIGHT.
  // Deliberately not `gallery`, whose four equal squares are the very thing a
  // logo strip must not be.
  logos: 'M2 9h5.5v6H2zM9.5 7h5v10h-5zM17 9h5.5v6H17z',
  // Two cards, each with a picture area above a line of words. Deliberately not
  // `columns`, which is the same two boxes with nothing in them, and not
  // `gallery`, which is four squares.
  cards: 'M3 4h8v16H3zM13 4h8v16h-8zM3 11h8M13 11h8',
  // Stacked bars, the top one opened to show a line under it.
  accordion: 'M3 4h18v4H3zM3 12h18v8H3zM6 16h9',
  // A row of tabs with the first one joined to the panel below.
  tabs: 'M3 8h6v3H3zM10 8h5v3h-5zM16 8h5v3h-5zM3 11h18v9H3z',
  // A wide middle panel with the edges of its neighbours showing.
  slider: 'M7 5h10v14H7zM3.5 8v8M20.5 8v8',
  // A grid with a ruled header row and a ruled first column.
  table: 'M3 5h18v14H3zM3 9h18M9 9v10',
  sparkle: 'M12 3l2.1 5.4L19.5 10l-5.4 2.1L12 17.5l-2.1-5.4L4.5 10l5.4-1.6z',
  image: 'M3 5h18v14H3zM8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 19',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3z',
  gallery: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  // A folded map, panels and fold lines. Not the pin, which would read as a
  // single location marker rather than the map the block draws.
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  // A framed pane split down the middle with arrows pushing out from the seam:
  // two pictures and a divider you drag. Not `columns`, whose halves are empty.
  compare: 'M4 5h16v14H4zM12 3v18M8.5 10l-2 2 2 2M15.5 10l2 2-2 2',
  // A speech bubble with a small face and two lines: someone quoted. Not `quote`,
  // which is the bare marks, and not `social`, which is linked accounts.
  testimonial: 'M4 5h16v10H8l-4 4V5zM9.8 9.2a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 0 0-2.6 0M14 9h3M14 12h3',
  // Five bars of a waveform, tall in the middle: a sound clip. Not `stats`, whose
  // bars sit on a baseline and mean a chart.
  audio: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2',
  button: 'M3 8h18v8H3zM8 12h8',
  // An eye: the whole-site preview. The almond and a pupil, drawn in arcs like
  // the social and testimonial marks so it sits at the same weight.
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
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
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  // A window with one side ruled off: the panel on that edge of the editor.
  'panel-left': 'M3 4h18v16H3zM9 4v16',
  'panel-right': 'M3 4h18v16H3zM15 4v16',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  /*
   * A clock with an anticlockwise arrow, which is the conventional history mark.
   * Deliberately NOT the undo arrow: this editor already uses that for undoing the
   * last edit, and one glyph meaning both "step back one change" and "browse every
   * published version" would be a worse icon than no icon.
   */
  /*
   * The text formatting set. Letterforms drawn as paths at the same 2px weight
   * as the rest, rather than the characters B, I and a bulleted dot the rich
   * text toolbar used to use. Those render differently on every platform, are
   * invisible to a screen reader and read as clip art, which is what the note
   * at the top of this file is about. The toolbar was the last place in the
   * editor still doing it.
   */
  bold: 'M6.5 12H14a4 4 0 0 1 0 8H7a.5.5 0 0 1-.5-.5V4.5A.5.5 0 0 1 7 4h6a4 4 0 0 1 0 8',
  italic: 'M19 4h-8M13 20H5M15 4 9 20',
  underline: 'M6 4v6a6 6 0 0 0 12 0V4M4 20h16',
  strikethrough: 'M16 4H9.5a3.5 3.5 0 0 0-2.6 5.8M13.5 14A3.5 3.5 0 0 1 14 20H6M3 12h18',
  'list-ordered': 'M10 6h11M10 12h11M10 18h11M4 4h1.5v4.5M3.5 8.5h3M3 14.5c0-1 1-1.5 2-1.5s1.5.7 1.5 1.4c0 1.3-3 1.9-3 4.1H6.5',
  // A capital T with a stroke through it: remove the formatting, keep the text.
  'clear-format': 'M4.5 6.5V4.5h11v2M10 4.5V15M7.5 19.5h5M15.5 14.5l6 6M21.5 14.5l-6 6',
  // An A over a bar, which is the shape everybody already reads as text colour.
  'text-colour': 'M4 16.5 9.5 4h1.5l5.5 12.5M6.5 12h8M4 20.5h16',
  // A marker nib over the same bar.
  highlight: 'M13 4.5l6.5 6.5-7 7H6l-1.5-1.5L13 4.5ZM4 21.5h16',
  'align-left': 'M4 6h16M4 11h10M4 16h16M4 21h10',
  'align-centre': 'M4 6h16M7 11h10M4 16h16M7 21h10',
  'align-right': 'M4 6h16M10 11h10M4 16h16M10 21h10',
  history: 'M3.5 9a9 9 0 1 1 .6 5M3.5 4.5V9H8M12 7.5V12l3.5 2',
  undo: 'M4 10h11a5 5 0 0 1 0 10h-5M4 10l5-5M4 10l5 5',
  redo: 'M20 10H9a5 5 0 0 0 0 10h5M20 10l-5-5M20 10l-5 5',
  upload: 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2M12 15V3M7 8l5-5 5 5',
  download: 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2M12 3v12M7 10l5 5 5-5',
  check: 'M4 12l5 5L20 6',
  // A pencil. Drawn at the same 2px weight as the rest of the set.
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 6.5l3 3',
  // Two links of a chain, joined. Its broken twin below drops the middle bar.
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  'link-off': 'M9 15l-2 2a3.5 3.5 0 0 1-5-5l2-2M15 9l2-2a3.5 3.5 0 0 1 5 5l-2 2M3 3l18 18',
  // Triangle with a bar and a dot. Drawn rather than filled so it sits at the
  // same 2px weight as everything else and never reads as an error icon.
  warning: 'M12 4L2.5 20h19L12 4zM12 10v5M12 17.5v.5',
  close: 'M6 6l12 12M18 6L6 18',
  blank: '',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  // A moon crescent: the light / dark switch, night side out.
  theme: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',

  // A head and shoulders, same 24x24 box and 2px stroke as the rest.
  // Drawn open at the bottom so it reads as a person rather than a filled
  // avatar chip, which at 16px turns into a grey blob.
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 21a7.5 7.5 0 0 1 15 0',
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
