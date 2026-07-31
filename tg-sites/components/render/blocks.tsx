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
import { resolveVideo } from '../../lib/content/video';
import { safeWidgetId, widgetKind } from '../../lib/content/widgets';

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
  const icon = str(props, 'icon', '★');
  const title = str(props, 'title');
  const body = str(props, 'body');

  return (
    <div className="tgs-icon-item">
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
