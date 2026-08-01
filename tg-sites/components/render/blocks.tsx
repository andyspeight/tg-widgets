/**
 * The rendered form of every built-in block.
 *
 * These are plain components with no server-only code, so the published page
 * renders them on the server and the editor preview renders the same ones on
 * the client. One implementation, so the preview cannot drift from the
 * published output.
 *
 * Every one of them treats props as hostile. Props arrive from stored JSON
 * that a client typed into, so each block reads what it needs with a typed
 * accessor and falls back to a default rather than trusting the shape.
 */

import type { CSSProperties, ReactElement } from 'react';
import { escapeHtml, safeUrl, sanitiseHtml } from '../../lib/content/sanitise';
import { parseTable } from '../../lib/content/table';
import { resolveVideo } from '../../lib/content/video';
import { socialNetwork } from '../../lib/content/social';
import { safeWidgetId, widgetKind } from '../../lib/content/widgets';
import { SocialIcon } from './social-icons';

type Props = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Prop accessors
// ---------------------------------------------------------------------------

function str(props: Props, key: string, fallback = ''): string {
  const value = props[key];
  return typeof value === 'string' ? value : fallback;
}

function bool(props: Props, key: string, fallback = false): boolean {
  const value = props[key];
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(props: Props, key: string, allowed: readonly T[], fallback: T): T {
  const value = props[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function list(props: Props, key: string): Props[] {
  const value = props[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Props => !!item && typeof item === 'object');
}

/**
 * A number from a prop, held inside sane bounds.
 *
 * The fallback covers a missing value AND a NaN, because a height that arrives
 * as the string "four hundred" should give a box of the default size rather than
 * a box of NaN pixels, which collapses to nothing and reads as the block having
 * failed to load.
 */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** 'auto' means let the image size itself, anything else is an aspect ratio. */
function ratioStyle(ratio: string): CSSProperties {
  return ratio === 'auto' ? {} : { aspectRatio: ratio.replace('/', ' / ') };
}

const ALIGNS = ['left', 'centre', 'right'] as const;
const RADII = ['none', 'sm', 'md', 'lg', 'full'] as const;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * The four visual sizes this block used to have, mapped onto the seven styles.
 *
 * A heading saved before the styles existed carries size: 's' | 'm' | 'l' | 'xl'.
 * Dropping those would resize every heading on every existing page, so they are
 * read and translated. New headings store a style directly.
 */
const LEGACY_SIZE_TO_STYLE = { xl: 'h1', l: 'h2', m: 'h3', s: 'h4' } as const;

export function HeadingBlock({
  props,
  editingHost = false,
}: {
  props: Props;
  /** See TextBlock. A heading is typed in place too, it just holds no markup. */
  editingHost?: boolean;
}): ReactElement {
  // The TAG. Still h2 to h4 only: the page title owns the single h1, and a
  // client must not be able to make a second one or skip a level.
  const level = oneOf(props, 'level', ['h2', 'h3', 'h4'] as const, 'h2');

  /*
   * The STYLE, which is how it looks, and is not the tag.
   *
   * Reading `style` first and falling back to the old `size` means a page saved
   * either way renders, and a page saved the old way keeps the size it had.
   */
  const chosen = props.style;
  const style =
    typeof chosen === 'string' && /^h[1-6]$/.test(chosen)
      ? chosen
      : LEGACY_SIZE_TO_STYLE[oneOf(props, 'size', ['s', 'm', 'l', 'xl'] as const, 'm')];

  const Tag = level;

  /*
   * A HEADING HOLDS MARKUP NOW, and the two props are both read on purpose.
   *
   * It used to hold `text`, a plain string the renderer escaped, which is why
   * the formatting toolbar was kept away from headings: bold inside one could
   * not have survived a save. Andy asked for the toolbar on every style of text
   * on 31 Jul 2026, and this is what makes that honest rather than a button that
   * appears to work.
   *
   * `html` FIRST, `text` AS THE FALLBACK, escaped. That is the whole migration:
   * every heading written before today has only `text`, and it keeps rendering
   * exactly as it did. Nothing has to be rewritten in the database, and a page
   * saved by an older deploy still renders. The same shape as the style/size
   * fallback a few lines up, for the same reason.
   *
   * 'heading' mode, not 'richtext'. A p, a ul or another heading inside an h2 is
   * invalid, and a browser does not refuse it, it hoists the block element out
   * and the back half of the heading falls out with it. See sanitise.ts.
   */
  const stored = sanitiseHtml(props.html, 'heading');
  const html = stored || escapeHtml(str(props, 'text'));

  /*
   * Typed in place, like the paragraph, and for the same reason: the words are
   * on the canvas, so that is where people reach for them.
   *
   * data-rt-oneline rather than the old data-rt-plain. The attribute used to do
   * two jobs, read textContent back AND refuse Enter, and only the second one
   * still applies: a heading is one line, and letting Enter through has the
   * browser put a div inside it. The read-back is now innerHTML like any other
   * rich host, which is the change that makes the toolbar work here.
   */
  if (editingHost) {
    return (
      <Tag
        className="tgs-heading"
        data-style={style}
        data-rt-host=""
        data-rt-oneline=""
        suppressHydrationWarning
      />
    );
  }

  return (
    <Tag
      className="tgs-heading"
      data-style={style}
      dangerouslySetInnerHTML={{ __html: html || 'Heading' }}
    />
  );
}

export function TextBlock({
  props,
  editingHost = false,
}: {
  props: Props;
  /**
   * Render the shell and NOTHING inside it, because the editor is about to take
   * this element over and type in it.
   *
   * THIS IS THE WHOLE TRICK OF INLINE EDITING. A contentEditable that React also
   * renders into is a fight: every keystroke commits, the commit re-renders, and
   * React rewrites the children and drops the caret at the start. Giving React
   * no children for this one element means it has nothing to rewrite, so the
   * DOM owns the text while it is being edited and the editor reads it back out.
   * The pane field solved the same problem the same way, with an uncontrolled
   * div seeded once on mount.
   *
   * Only ever true in the editor: the published page passes nothing.
   */
  editingHost?: boolean;
}): ReactElement {
  const size = oneOf(props, 'size', ['s', 'm', 'l'] as const, 'm');
  // Sanitised again here even though it was sanitised on save. Stored HTML
  // is never trusted, and this is the last gate before the browser.
  const html = sanitiseHtml(props.html, 'richtext');

  if (editingHost) {
    return <div className="tgs-text" data-size={size} data-rt-host="" suppressHydrationWarning />;
  }

  return (
    <div
      className="tgs-text"
      data-size={size}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function QuoteBlock({ props }: { props: Props }): ReactElement {
  const text = str(props, 'text');
  const attribution = str(props, 'attribution');
  const role = str(props, 'role');

  return (
    <figure className="tgs-quote">
      <blockquote className="tgs-quote__text">{text}</blockquote>
      {(attribution || role) && (
        <figcaption className="tgs-quote__by">
          {attribution && <strong>{attribution}</strong>}
          {attribution && role ? ', ' : ''}
          {role}
        </figcaption>
      )}
    </figure>
  );
}

export function ListBlock({ props }: { props: Props }): ReactElement {
  const style = oneOf(props, 'style', ['bullet', 'number', 'tick'] as const, 'bullet');
  const items = list(props, 'items');
  const Tag = style === 'number' ? 'ol' : 'ul';

  return (
    <Tag className="tgs-list" data-style={style}>
      {items.map((item, index) => (
        <li key={index}>{str(item, 'text')}</li>
      ))}
    </Tag>
  );
}

export function IconItemBlock({ props }: { props: Props }): ReactElement {
  const icon = str(props, 'icon', '\u2605');
  const title = str(props, 'title');
  const body = str(props, 'body');
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'left');

  /*
   * CENTRED PUTS THE ICON ABOVE THE WORDS, not beside them, and that is the
   * whole point of the setting rather than a side effect.
   *
   * Four presets asked for a centred icon item before the block had an align
   * prop at all: `blank-four-points` shipped on 31 Jul 2026 setting it, and the
   * three centred Features and Contact ones followed on 1 Aug. The prop was
   * carried into the block, ignored, and drawn left-aligned, while the picker's
   * thumbnail read the same prop and drew it centred. The thumbnail was telling
   * the truth about what was asked for and a lie about what arrives, which is
   * the one thing the whole draw-it-from-the-data arrangement exists to stop.
   * tests/presets.test.ts checks every prop against the registry now.
   */
  return (
    <div className="tgs-icon-item" data-align={align}>
      {/* Decorative: the title carries the meaning. */}
      <span className="tgs-icon-item__icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        {title && <p className="tgs-icon-item__title">{title}</p>}
        {body && <p className="tgs-icon-item__body">{body}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export function ImageBlock({ props }: { props: Props }): ReactElement {
  const src = safeUrl(str(props, 'src'));
  const alt = str(props, 'alt');
  const ratio = str(props, 'ratio', 'auto');
  const fit = oneOf(props, 'fit', ['cover', 'contain'] as const, 'cover');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const caption = str(props, 'caption');
  const href = safeUrl(str(props, 'href'));

  if (!src) {
    return <div className="tgs-placeholder">Choose an image</div>;
  }

  const picture = (
    <div className="tgs-image__frame" data-radius={radius} style={ratioStyle(ratio)}>
      {/* Plain img rather than next/image: sources are arbitrary client URLs
          and the media pipeline with its own variants lands in a later
          package. width/height come with the media record then, which is
          what removes the layout shift. */}
      <img src={src} alt={alt} loading="lazy" decoding="async" style={{ objectFit: fit }} />
    </div>
  );

  return (
    <div className="tgs-image">
      <figure>
        {href ? <a href={href}>{picture}</a> : picture}
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

/**
 * A Travelgenix widget: the container, and nothing else.
 *
 * The SCRIPT is not here. PageRenderer collects every widget tag on the page and
 * emits one script per distinct tag at the end, because the widget files auto
 * init on every matching container and carry a double-init guard, so three
 * Opening Hours blocks want one script and three containers rather than three of
 * each.
 *
 * WHAT MAKES THIS SAFE is that neither attribute below can be anything a client
 * chose. The tag comes back from widgetKind, which is a lookup in a closed list,
 * and the id has been through safeWidgetId. An unknown tag or a malformed id
 * draws the placeholder instead, which is honest: an empty box on a published
 * page with no explanation is the failure this avoids.
 */
export function WidgetBlock({
  props,
  editing = false,
}: {
  props: Props;
  /**
   * Draw the placeholder rather than the real container.
   *
   * True on the editor canvas. The canvas re-renders on every keystroke, and a
   * widget script re-initialising each time would thrash the page and hammer the
   * config API. The editor's job is the layout; Preview is where the widget is
   * checked. Same reasoning as the render-must-not-grab-the-page rule.
   */
  editing?: boolean;
}): ReactElement {
  const kind = widgetKind(props.widget);
  const id = safeWidgetId(props.widgetId);

  if (!kind || !id) {
    return (
      <div className="tgs-placeholder">
        {!kind
          ? 'Choose a widget'
          : 'Add the widget ID from your dashboard, the one starting tgw_'}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="tgs-widget-ghost">
        <span className="tgs-widget-ghost__name">{kind.label}</span>
        <span className="tgs-widget-ghost__id">{id}</span>
        <span className="tgs-widget-ghost__note">Shown for real on the published page</span>
      </div>
    );
  }

  return <div className="tgs-widget" data-tg-widget={kind.tag} data-tg-id={id} />;
}

/**
 * Somebody else's widget, in a sandboxed iframe.
 *
 * THE SANDBOX IS THE WHOLE SECURITY MODEL, so it is worth saying exactly what it
 * buys. With `sandbox` present and `allow-same-origin` absent, the document
 * inside gets a UNIQUE OPAQUE ORIGIN. It cannot read the parent document, the
 * client's cookies, their session or localStorage, and it cannot reach any other
 * widget. It can draw in its own rectangle and talk to its own servers.
 *
 * THE COMBINATION THAT IS NOT OFFERED: allow-same-origin together with
 * allow-scripts. Every "my embed does not work in an iframe" answer online
 * suggests it, and together they let the framed document reach into the parent
 * and remove its own sandbox attribute. A box that says sealed and is not is
 * worse than no box, so it is not a setting.
 *
 * srcdoc rather than a data: URL, because a data: URL is treated as opaque by
 * some browsers in ways that break scripts, and React escapes the attribute for
 * us. The HTML inside is NOT sanitised, on purpose: sanitising it would strip
 * the script that is the only reason anybody pastes an embed, and the sandbox is
 * what makes that acceptable. Same trade as the staff head and body HTML, with
 * containment instead of a permission check.
 */
const SANDBOX = [
  // The reason the block exists.
  'allow-scripts',
  // A "book now" link has to be able to open something.
  'allow-popups',
  // ...and what it opens should be an ordinary page, not another sealed box.
  'allow-popups-to-escape-sandbox',
  // Newsletter signups and enquiry forms submit.
  'allow-forms',
  // Deliberately absent: allow-same-origin (see above), allow-top-navigation
  // (an embed must not be able to redirect the whole site), allow-modals.
].join(' ');

export function EmbedWidgetBlock({
  props,
  editing = false,
}: {
  props: Props;
  editing?: boolean;
}): ReactElement {
  const html = typeof props.html === 'string' ? props.html : '';
  const title = str(props, 'title') || 'Embedded widget';
  const height = clamp(props.height, 80, 2000, 420);

  if (!html.trim()) {
    return <div className="tgs-placeholder">Paste the code you were given</div>;
  }

  /*
   * NOT RUN ON THE CANVAS. It is sealed, so it could be run safely, and it is
   * still the wrong thing: the canvas re-renders on every keystroke and each one
   * would reload the frame and re-run somebody else's script, which is slow and
   * makes their analytics count an editing session as traffic.
   */
  if (editing) {
    return (
      <div className="tgs-widget-ghost" style={{ minHeight: height }}>
        <span className="tgs-widget-ghost__name">{title}</span>
        <span className="tgs-widget-ghost__note">Shown for real on the published page</span>
      </div>
    );
  }

  return (
    <div className="tgs-embed-widget" style={{ height }}>
      <iframe
        title={title}
        sandbox={SANDBOX}
        srcDoc={html}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

export function VideoBlock({ props }: { props: Props }): ReactElement {
  const ratio = str(props, 'ratio', '16/9');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const caption = str(props, 'caption');
  const video = resolveVideo(str(props, 'url'));

  if (!video) {
    return <div className="tgs-placeholder">Paste a YouTube, Vimeo or .mp4 link</div>;
  }

  return (
    <div className="tgs-video">
      <figure style={{ margin: 0 }}>
        <div className="tgs-video__frame" data-radius={radius} style={ratioStyle(ratio)}>
          {video.kind === 'iframe' ? (
            <iframe
              src={video.src}
              title={caption || 'Video'}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          ) : (
            <video src={video.src} controls preload="metadata" />
          )}
        </div>
        {caption && <figcaption className="tgs-image">{caption}</figcaption>}
      </figure>
    </div>
  );
}

export function GalleryBlock({ props }: { props: Props }): ReactElement {
  const columns = oneOf(props, 'columns', ['2', '3', '4'] as const, '3');
  const gap = str(props, 'gap', 'm');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const images = list(props, 'images')
    .map((image) => ({ src: safeUrl(str(image, 'src')), alt: str(image, 'alt') }))
    .filter((image): image is { src: string; alt: string } => !!image.src);

  if (images.length === 0) {
    return <div className="tgs-placeholder">Add some images</div>;
  }

  return (
    <div className="tgs-gallery" data-columns={columns} data-gap={gap}>
      {images.map((image, index) => (
        <div key={index} className="tgs-image__frame" data-radius={radius}>
          <img src={image.src} alt={image.alt} loading="lazy" decoding="async" />
        </div>
      ))}
    </div>
  );
}

/**
 * A grid of cards.
 *
 * ONE LINK PER CARD, NEVER TWO, and that is the whole reason this is not the
 * obvious markup. The obvious markup wraps the card in an `<a>` so all of it is
 * clickable, and then the "See the trip" link inside it is an anchor inside an
 * anchor, which is invalid HTML, which browsers repair by hoisting one out. It
 * also puts every card in the tab order twice.
 *
 * So the card is a positioned box and the ONE link inside it grows a
 * pseudo-element covering the whole card. Valid markup, one stop per card for a
 * keyboard, the link text still says where it goes, and the pointer still gets
 * the big target. See `.tgs-cards[data-whole='true']` in globals.css.
 *
 * A CARD WITH NO LINK IS NOT A LINK. Cards are also how somebody lays out a row
 * of features or a team, where nothing is clickable, so the covering
 * pseudo-element only exists when there is a real address to go to.
 */
function renderCard(
  card: Props,
  index: number,
  options: {
    showImage: boolean;
    ratio: string;
    radius: (typeof RADII)[number];
  },
): ReactElement | null {
  const title = str(card, 'title');
  const body = str(card, 'body');
  const label = str(card, 'label');
  const src = safeUrl(str(card, 'src'));
  const href = safeUrl(str(card, 'linkHref'));
  const linkLabel = str(card, 'linkLabel');

  // A card with nothing to say is not drawn at all rather than drawn empty. An
  // agent who added one and has not filled it in yet still sees it in the
  // properties pane, which is where they are working.
  if (!title && !body && !label && !src) return null;

  return (
    <article className="tgs-card" key={index}>
      {options.showImage && (
        <div className="tgs-card__frame" data-radius={options.radius} style={ratioStyle(options.ratio)}>
          {src ? (
            <img src={src} alt={str(card, 'alt')} loading="lazy" decoding="async" />
          ) : (
            // A placeholder rather than nothing, so a half-built grid still has
            // cards of the same height and the layout is honest about itself.
            <span className="tgs-card__noimage" aria-hidden="true" />
          )}
        </div>
      )}

      <div className="tgs-card__body">
        {label && <p className="tgs-card__label">{label}</p>}
        {title && <h3 className="tgs-card__title">{title}</h3>}
        {body && <p className="tgs-card__text">{body}</p>}

        {href && linkLabel && (
          <a className="tgs-card__link" href={href}>
            {linkLabel}
          </a>
        )}
      </div>
    </article>
  );
}

export function CardsBlock({
  props,
  editing = false,
}: {
  props: Props;
  /**
   * True on the editor canvas.
   *
   * The only thing it changes is what a COLLECTION-backed grid draws. The items
   * are filled in by the route before it renders (see lib/content/listings.ts),
   * and there is no route behind the canvas, so on the canvas it says what will
   * appear instead of drawing an empty grid that reads as broken. Same
   * arrangement the widget block uses.
   */
  editing?: boolean;
}): ReactElement {
  const items = list(props, 'items');
  const columns = oneOf(props, 'columns', ['2', '3', '4'] as const, '3');
  const gap = oneOf(props, 'gap', ['none', 'xs', 's', 'm', 'l', 'xl'] as const, 'm');
  const style = oneOf(props, 'style', ['plain', 'bordered', 'raised', 'tinted'] as const, 'bordered');
  const imagePosition = oneOf(props, 'imagePosition', ['top', 'left', 'none'] as const, 'top');
  const ratio = str(props, 'ratio', '4/3');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const align = oneOf(props, 'align', ['left', 'centre'] as const, 'left');
  const whole = bool(props, 'wholeCardLinks', true);

  const cards = items
    .map((card, index) =>
      renderCard(card, index, { showImage: imagePosition !== 'none', ratio, radius }),
    )
    .filter((card): card is ReactElement => card !== null);

  const fromCollection = str(props, 'source') === 'collection';
  const collection = str(props, 'collection').trim();

  if (editing && fromCollection) {
    const count = clamp(props.count, 1, 60, 6);
    return (
      <div className="tgs-placeholder">
        {collection
          ? `The newest ${count} from "${collection}" will show here.`
          : 'Say which collection these come from.'}
      </div>
    );
  }

  if (cards.length === 0) {
    // A collection with nothing published in it yet says so, rather than
    // leaving somebody wondering whether the block is broken.
    if (fromCollection) {
      return (
        <div className="tgs-placeholder">
          Nothing published in &quot;{collection}&quot; yet.
        </div>
      );
    }
    return <div className="tgs-placeholder">Add some cards</div>;
  }

  return (
    <div
      className="tgs-cards"
      data-columns={columns}
      data-gap={gap}
      data-style={style}
      data-image={imagePosition}
      data-radius={radius}
      data-align={align}
      data-whole={whole ? 'true' : undefined}
    >
      {cards}
    </div>
  );
}

/**
 * A run of text into paragraphs, on blank lines.
 *
 * These blocks take a plain textarea rather than rich text, so what arrives is
 * a string with newlines in it and React escapes every character of it. Without
 * this the whole thing renders as one wall with the line breaks collapsed, and
 * somebody who pressed Enter twice would be looking at a bug.
 */
function paragraphs(text: string): ReactElement[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => <p key={index}>{part}</p>);
}

/** The chevron both of these use. Inlined for the same reason PageRenderer's is. */
function Chevron({ className }: { className: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function AccordionBlock({
  props,
  blockId,
}: {
  props: Props;
  /**
   * Used as the `name` that makes the panels exclusive.
   *
   * Unique within a page tree, which is all it needs to be: two accordions
   * sharing a name would close each other's panels. It comes from the block
   * rather than being generated here so it survives a re-render, and so the
   * server and the client agree on it.
   */
  blockId: string;
}): ReactElement {
  const items = list(props, 'items');
  const style = oneOf(props, 'style', ['plain', 'ruled', 'separated'] as const, 'separated');
  const single = bool(props, 'single', true);
  const openFirst = bool(props, 'openFirst', false);

  const rows = items.filter((item) => str(item, 'title') || str(item, 'body'));

  if (rows.length === 0) {
    return <div className="tgs-placeholder">Add some sections</div>;
  }

  return (
    <div className="tgs-accordion" data-style={style}>
      {rows.map((item, index) => (
        <details
          key={index}
          className="tgs-accordion__item"
          /*
           * `name` is what makes a set of details exclusive, and it is the
           * browser doing it rather than a script. A browser that does not know
           * the attribute yet simply lets two stay open, which is a worse
           * accordion and not a broken page.
           */
          {...(single ? { name: `tgs-acc-${blockId}` } : {})}
          {...(openFirst && index === 0 ? { open: true } : {})}
        >
          <summary className="tgs-accordion__head">
            <span className="tgs-accordion__title">{str(item, 'title') || 'Untitled'}</span>
            <Chevron className="tgs-accordion__mark" />
          </summary>
          <div className="tgs-accordion__body">{paragraphs(str(item, 'body'))}</div>
        </details>
      ))}
    </div>
  );
}

/**
 * The most tabs the stylesheet can show.
 *
 * A panel is revealed by one hand-written rule per position, because the
 * selector has to name the position and CSS cannot count to "however many".
 * Exported so the test suite can hold this number, the block's `max` and the
 * number of rules in globals.css against each other: a ninth tab would render a
 * heading that opens nothing.
 */
export const MAX_TABS = 8;

export function TabsBlock({
  props,
  blockId,
}: {
  props: Props;
  blockId: string;
}): ReactElement {
  const style = oneOf(props, 'style', ['underline', 'pills', 'boxed'] as const, 'underline');
  const align = oneOf(props, 'align', ALIGNS, 'left');

  const items = list(props, 'items')
    .filter((item) => str(item, 'title'))
    .slice(0, MAX_TABS);

  if (items.length === 0) {
    return <div className="tgs-placeholder">Add some tabs</div>;
  }

  const name = `tgs-tabs-${blockId}`;

  return (
    <div className="tgs-tabs" data-style={style} data-align={align}>
      {/*
        THE RADIOS COME FIRST AND ARE SIBLINGS OF THE PANELS, which is the whole
        reason the markup is ordered like this rather than tab-then-panel. The
        stylesheet shows a panel with `:checked ~ .tgs-tabs__panel`, and the
        general sibling combinator only looks FORWARD from the checked input.

        `defaultChecked`, not `checked`. Which tab is open is the browser's
        business, and a controlled value would mean the editor canvas resetting
        it to the first one on every keystroke.
      */}
      {items.map((item, index) => (
        <input
          key={`r${index}`}
          className="tgs-tabs__radio tgs-sr-only"
          type="radio"
          name={name}
          id={`${name}-${index}`}
          /*
           * The position, as an attribute the stylesheet can name.
           *
           * `:nth-of-type` looked like the obvious way to pair a radio with its
           * panel and is a trap: it counts by ELEMENT type, the headings list is
           * a div too, and every panel came out one place further along than the
           * rule expected. So the position is written down instead of inferred.
           */
          data-index={index}
          defaultChecked={index === 0}
        />
      ))}

      <div className="tgs-tabs__list">
        {items.map((item, index) => (
          <label
            key={`l${index}`}
            className="tgs-tabs__tab"
            data-index={index}
            htmlFor={`${name}-${index}`}
          >
            {str(item, 'title')}
          </label>
        ))}
      </div>

      {items.map((item, index) => (
        <div key={`p${index}`} className="tgs-tabs__panel" data-index={index}>
          {paragraphs(str(item, 'body'))}
        </div>
      ))}
    </div>
  );
}

/**
 * The same cards, on a rail that scrolls sideways.
 *
 * SHARES renderCard WITH THE GRID, which is the whole reason this is worth
 * having as its own block rather than a copy: a card looks identical in either,
 * and a change to one cannot leave the other behind. Only the container differs.
 *
 * NO ARROW BUTTONS. Moving a rail from a button needs a script, and this tree
 * ships none. What it has instead is everything a rail already gets for free:
 * swipe on a phone, trackpad or shift-wheel on a desktop, a real scrollbar,
 * arrow keys once the rail has focus, and Tab through the cards, which scrolls
 * each one into view as it goes. The next slide peeks in from the edge so it is
 * obvious there is more.
 *
 * THE RAIL TAKES FOCUS, deliberately. A scrollable region that a keyboard
 * cannot reach is a WCAG failure, and it is the only way to read a rail of
 * cards that have no links in them. It is one extra tab stop and it is named.
 */
export function SliderBlock({ props }: { props: Props }): ReactElement {
  const items = list(props, 'items');
  const slideWidth = oneOf(props, 'slideWidth', ['narrow', 'medium', 'wide'] as const, 'medium');
  const gap = oneOf(props, 'gap', ['none', 'xs', 's', 'm', 'l', 'xl'] as const, 'm');
  const style = oneOf(props, 'style', ['plain', 'bordered', 'raised', 'tinted'] as const, 'bordered');
  const ratio = str(props, 'ratio', '4/3');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const align = oneOf(props, 'align', ['left', 'centre'] as const, 'left');
  const whole = bool(props, 'wholeCardLinks', true);

  const slides = items
    .map((card, index) => renderCard(card, index, { showImage: true, ratio, radius }))
    .filter((card): card is ReactElement => card !== null);

  if (slides.length === 0) {
    return <div className="tgs-placeholder">Add some slides</div>;
  }

  return (
    <div
      className="tgs-cards tgs-slider"
      /*
       * .tgs-cards as well as .tgs-slider, so every card rule already written
       * applies here untouched: the styles, the corners, the covering link, the
       * focus ring. .tgs-slider only replaces the grid with a rail.
       */
      data-slide={slideWidth}
      data-gap={gap}
      data-style={style}
      data-radius={radius}
      data-align={align}
      data-whole={whole ? 'true' : undefined}
      role="group"
      aria-label="Slides. Scroll sideways to see more."
      tabIndex={0}
    >
      {slides}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function renderButton(button: Props, key: number): ReactElement | null {
  const label = str(button, 'label');
  if (!label) return null;

  const href = safeUrl(str(button, 'href')) || '#';
  const variant = oneOf(button, 'variant', ['primary', 'secondary', 'ghost'] as const, 'primary');
  const size = oneOf(button, 'size', ['s', 'm', 'l'] as const, 'm');
  const newTab = bool(button, 'newTab');

  return (
    <a
      key={key}
      className="tgs-button"
      data-variant={variant}
      data-size={size}
      href={href}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {label}
    </a>
  );
}

export function ButtonBlock({ props }: { props: Props }): ReactElement {
  return <div className="tgs-buttons">{renderButton(props, 0)}</div>;
}

export function ButtonGroupBlock({ props }: { props: Props }): ReactElement {
  const buttons = list(props, 'buttons');
  return <div className="tgs-buttons">{buttons.map(renderButton)}</div>;
}

/**
 * The menu.
 *
 * NO JAVASCRIPT, INCLUDING THE MENU BUTTON. The whole render tree is server
 * components with no bundle behind them, and the navigation of a client's site
 * is the last place to start shipping one: it is the thing every visitor needs
 * before anything else has loaded. So the phone menu is a `details` and a
 * `summary`, which the browser opens and closes by itself, reaches by keyboard
 * by itself and announces to a screen reader by itself. Nothing to hydrate,
 * nothing for a Content Security Policy to object to, and it works while the
 * network is still fetching everything else.
 *
 * WHY THE LINKS APPEAR TWICE IN THE MARKUP
 *
 * Once as a plain list for a wide screen, once inside the `details` for a
 * narrow one. A single list cannot do both: a closed `details` hides its own
 * contents through the browser's internal slot, and page CSS could not reliably
 * force them back into view across engines. The alternative was a
 * checkbox-and-label hack, which is worse in every way that matters.
 *
 * The duplicate costs a few hundred bytes and costs nothing in the
 * accessibility tree, because whichever copy is not in use is `display: none`,
 * and `display: none` is not read out. Both copies come from the same array, so
 * they cannot say different things.
 */
function navLinks(items: Props[], keyPrefix: string): ReactElement[] {
  return items
    .map((item, index) => {
      const label = str(item, 'label');
      if (!label) return null;

      const href = safeUrl(str(item, 'href')) || '#';
      const newTab = bool(item, 'newTab');

      return (
        <li key={`${keyPrefix}${index}`} className="tgs-nav__item">
          <a
            className="tgs-nav__link"
            href={href}
            {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {label}
          </a>
        </li>
      );
    })
    .filter((item): item is ReactElement => item !== null);
}

export function NavBlock({ props }: { props: Props }): ReactElement {
  const items = list(props, 'items');
  const layout = oneOf(props, 'layout', ['row', 'column'] as const, 'row');
  const align = oneOf(props, 'align', ALIGNS, 'left');
  const gap = oneOf(props, 'gap', ['none', 'xs', 's', 'm', 'l', 'xl'] as const, 'm');
  // Default true, because a menu that does not collapse is the wrong default on
  // a phone and this block exists mostly to be a header.
  const collapse = bool(props, 'collapse', true);

  if (items.length === 0) {
    return <div className="tgs-placeholder">Add some links</div>;
  }

  return (
    <nav className="tgs-nav" data-layout={layout} data-align={align} data-gap={gap}>
      <ul className="tgs-nav__list" data-collapse={collapse ? 'true' : undefined}>
        {navLinks(items, 'wide')}
      </ul>

      {collapse && (
        <details className="tgs-nav__disclosure">
          {/*
            The label is on the summary rather than on an inner span, so a screen
            reader announces "Menu, disclosure triangle, collapsed" from the one
            element the browser already treats as the control.
          */}
          <summary className="tgs-nav__burger" aria-label="Menu">
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </summary>
          <ul className="tgs-nav__list tgs-nav__list--stacked">{navLinks(items, 'narrow')}</ul>
        </details>
      )}
    </nav>
  );
}

/**
 * Numbered steps, or a timeline.
 *
 * AN `ol`, NOT A ROW OF DIVS, and that is the reason this is a block rather
 * than something built out of columns. A screen reader announces "list, three
 * items, item one of three", which is the whole meaning of the thing: these
 * happen in this order. Three cards side by side announce nothing at all.
 *
 * THE NUMBERS ARE A CSS COUNTER, never stored text. A client who drags step
 * three above step two gets 1, 2, 3 with nothing to correct. Typed-in numbers
 * would go stale the first time anybody reordered them, and the version that
 * goes stale silently is the one that reaches a live site.
 *
 * A STEP WITH NOTHING IN IT IS STILL DRAWN, unlike an empty card. Its number is
 * its position, so skipping it would renumber everything after it and a client
 * halfway through typing their five steps would watch them shuffle.
 */
export function StepsBlock({ props }: { props: Props }): ReactElement {
  const layout = oneOf(props, 'layout', ['down', 'across'] as const, 'down');
  const marker = oneOf(props, 'marker', ['number', 'dot', 'none'] as const, 'number');
  const connector = props.connector !== false;

  const items = Array.isArray(props.items) ? props.items : [];

  if (items.length === 0) {
    return <div className="tgs-placeholder">Add the steps</div>;
  }

  return (
    <ol
      className="tgs-steps"
      data-layout={layout}
      data-marker={marker}
      data-connector={connector ? 'true' : undefined}
    >
      {items.map((raw, index) => {
        const item = raw && typeof raw === 'object' ? (raw as Props) : {};
        const title = str(item, 'title');
        const body = str(item, 'body');

        return (
          <li className="tgs-steps__step" key={index}>
            {/*
              Decorative, and deliberately so. The number is drawn by CSS into
              this span, so its text content is empty and there is nothing for a
              screen reader to read; the `ol` has already said which item this
              is. Marked hidden rather than left to chance.
            */}
            <span className="tgs-steps__marker" aria-hidden="true" />
            <div className="tgs-steps__body">
              {title && <p className="tgs-steps__title">{title}</p>}
              {/* Blank lines become paragraphs, as they do in every other
                  plain-textarea block. Styled through .tgs-steps__body p
                  rather than by giving each one a class, since the helper is
                  shared and this block has no reason to change it. */}
              {body && paragraphs(body)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A row of links to your own accounts.
 *
 * WHAT IS AND IS NOT CLIENT INPUT, because it is the whole security story of
 * this block. The NETWORK is an id looked up in a closed list, so the picture
 * is markup we wrote; an id that is not in the list draws no picture at all
 * rather than falling back to something generic. The ADDRESS is client input
 * and goes through safeUrl, with mailto and tel allowed because "follow us"
 * rows almost always end with an email or a phone number.
 *
 * AN ACCOUNT WITH NO ADDRESS IS NOT DRAWN. The block ships with three empty
 * ones so it arrives looking like what it is, and a client who fills in two of
 * them gets two icons rather than one working link and one dead circle.
 *
 * EVERY LINK CARRIES ITS OWN NAME. An icon-only row is eleven anchors whose
 * text content is an SVG, which a screen reader announces as nothing at all, so
 * each one gets an aria-label. With the names showing, the visible text IS the
 * name and the label would be read twice, so it is dropped.
 *
 * rel="noreferrer" as well as noopener on the outward ones. These go to other
 * companies and there is no reason to tell them which page somebody came from.
 */
export function SocialBlock({ props }: { props: Props }): ReactElement | null {
  const style = oneOf(props, 'style', ['plain', 'circle', 'square', 'filled'] as const, 'plain');
  const size = oneOf(props, 'size', ['s', 'm', 'l'] as const, 'm');
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'left');
  const showLabels = props.showLabels === true;

  const items = Array.isArray(props.items) ? props.items : [];

  const links = items
    .map((raw, index) => {
      const item = raw && typeof raw === 'object' ? (raw as Props) : {};
      const network = socialNetwork(str(item, 'network'));
      if (!network) return null;

      // mailto and tel are refused by default and asked for here, for this
      // block only. See lib/content/social.ts.
      const href = safeUrl(str(item, 'href'), { allowMailto: true });
      if (!href) return null;

      const external = /^https?:/i.test(href);

      return (
        <li className="tgs-social__item" key={`${network.id}-${index}`}>
          <a
            className="tgs-social__link"
            href={href}
            aria-label={showLabels ? undefined : network.label}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
          >
            <SocialIcon network={network.id} />
            {showLabels && <span className="tgs-social__label">{network.label}</span>}
          </a>
        </li>
      );
    })
    .filter((link): link is ReactElement => link !== null);

  if (links.length === 0) {
    return <div className="tgs-placeholder">Add the addresses of your accounts</div>;
  }

  return (
    <ul
      className="tgs-social"
      data-style={style}
      data-size={size}
      data-align={align}
      data-labels={showLabels ? 'true' : undefined}
    >
      {links}
    </ul>
  );
}

/**
 * A table.
 *
 * THE `scope` ATTRIBUTES ARE THE WHOLE ACCESSIBILITY STORY, and they are the
 * reason this is a block rather than something somebody builds out of columns.
 * A screen reader reading the third cell of the fourth row announces the column
 * heading and, in a comparison table, the row heading with it. Without scope it
 * reads out twenty-four numbers with nothing to attach them to.
 *
 * THE SCROLL BOX TAKES FOCUS for the same reason the slider's rail does: a
 * table wider than a phone has to be scrollable, and a scrollable region a
 * keyboard cannot reach is a WCAG failure.
 */
export function TableBlock({ props }: { props: Props }): ReactElement {
  const rows = parseTable(props.data);
  const headerRow = bool(props, 'headerRow', true);
  const firstColumnHeader = bool(props, 'firstColumnHeader', true);
  const style = oneOf(props, 'style', ['plain', 'lined', 'striped', 'boxed'] as const, 'lined');
  const caption = str(props, 'caption');

  if (rows.length === 0) {
    return <div className="tgs-placeholder">Paste a table, one row per line</div>;
  }

  const head = headerRow ? rows[0] : null;
  const body = headerRow ? rows.slice(1) : rows;

  return (
    <div
      className="tgs-table__scroll"
      role="region"
      aria-label={caption || 'Table. Scroll sideways to see all of it.'}
      tabIndex={0}
    >
      <table className="tgs-table" data-style={style}>
        {caption && <caption className="tgs-table__caption">{caption}</caption>}

        {head && (
          <thead>
            <tr>
              {head.map((cell, index) => (
                <th key={index} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        )}

        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) =>
                firstColumnHeader && cellIndex === 0 ? (
                  <th key={cellIndex} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function DividerBlock({ props }: { props: Props }): ReactElement {
  const style = oneOf(props, 'style', ['line', 'dashed', 'dots'] as const, 'line');
  const spacing = str(props, 'spacing', 'm');
  return <hr className="tgs-divider" data-style={style} data-spacing={spacing} />;
}

export function SpacerBlock({ props }: { props: Props }): ReactElement {
  const height = oneOf(props, 'height', ['xs', 's', 'm', 'l', 'xl'] as const, 'm');
  return <div className="tgs-spacer" data-height={height} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

export function EmbedBlock({ props }: { props: Props }): ReactElement {
  const html = sanitiseHtml(props.html, 'embed');
  if (!html) return <div className="tgs-placeholder">Paste embed code</div>;
  return <div className="tgs-embed" dangerouslySetInnerHTML={{ __html: html }} />;
}

export { ALIGNS };
