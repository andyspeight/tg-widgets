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
import { safeColour } from '../../lib/content/schema';
import { importContent, importFields } from '../../lib/content/imported';
import { cleanImportHtml } from '../../lib/import/html';
import { importScopeClass, scopeImportCss } from '../../lib/import/css';
import { applyImportContent } from '../../lib/import/tokenise';
import { parseTable } from '../../lib/content/table';
import { resolveVideo } from '../../lib/content/video';
import { mapEmbedSrc } from '../../lib/content/map';
import { socialNetwork } from '../../lib/content/social';
import { safeWidgetId, widgetKind, WIDGET_ORIGIN, type WidgetKind } from '../../lib/content/widgets';
import { SocialIcon } from './social-icons';
import { ContentIcon } from './content-icon';
import { isIconName } from '../../lib/content/icons';

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

/**
 * The object-position and filter a stored picture carries: its focus point and
 * its three adjustments, each pinned to range HERE.
 *
 * One place for the clamp, because more than one picture has these now. The
 * image block sets them by clicking in the editor, a gallery tile the same, and
 * both pass through the save untouched the way a picture's width and height do,
 * so the render is where each is turned into a number and held to its bounds
 * rather than trusting whatever a stored string might carry. Focus drives
 * object-position; an adjustment becomes a filter, and only when it is actually
 * off its default, so an untouched picture carries no filter at all.
 */
function pictureAdjustStyle(source: Props): CSSProperties {
  const focusX = clamp(source.focusX, 0, 100, 50);
  const focusY = clamp(source.focusY, 0, 100, 50);
  const brightness = clamp(source.brightness, 0, 200, 100);
  const contrast = clamp(source.contrast, 0, 200, 100);
  const saturation = clamp(source.saturation, 0, 200, 100);

  const adjustments: string[] = [];
  if (brightness !== 100) adjustments.push(`brightness(${brightness}%)`);
  if (contrast !== 100) adjustments.push(`contrast(${contrast}%)`);
  if (saturation !== 100) adjustments.push(`saturate(${saturation}%)`);

  return {
    objectPosition: `${focusX}% ${focusY}%`,
    ...(adjustments.length ? { filter: adjustments.join(' ') } : {}),
  };
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

  // A shadow behind it, so it stays legible over a photograph. Off by default,
  // so every heading written before today is untouched.
  const shadow = oneOf(props, 'shadow', ['none', 'soft', 'strong'] as const, 'none');

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
        data-shadow={shadow === 'none' ? undefined : shadow}
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
      data-shadow={shadow === 'none' ? undefined : shadow}
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
  // A shadow behind ANY HEADINGS here, so they stay legible over a picture. The
  // CSS scopes it to h1-h6, so a paragraph in the same block is left alone, which
  // is what was asked for: headings, not body text.
  const shadow = oneOf(props, 'shadow', ['none', 'soft', 'strong'] as const, 'none');
  const headingShadow = shadow === 'none' ? undefined : shadow;
  // Sanitised again here even though it was sanitised on save. Stored HTML
  // is never trusted, and this is the last gate before the browser.
  const html = sanitiseHtml(props.html, 'richtext');

  if (editingHost) {
    return (
      <div
        className="tgs-text"
        data-size={size}
        data-heading-shadow={headingShadow}
        data-rt-host=""
        suppressHydrationWarning
      />
    );
  }

  return (
    <div
      className="tgs-text"
      data-size={size}
      data-heading-shadow={headingShadow}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function QuoteBlock({ props }: { props: Props }): ReactElement {
  const text = str(props, 'text');
  const attribution = str(props, 'attribution');
  const role = str(props, 'role');
  const textColour = safeColour(props.textColour);

  return (
    <figure className="tgs-quote" style={textColour ? { color: textColour } : undefined}>
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
        <li key={index}>
          {/*
            A DRAWN TICK, NOT A TYPED ONE. This was `content: '✓'` in the
            stylesheet until 2 Aug 2026, which is the last character-as-icon in
            the product: the note at the top of lib/content/icons.ts says the
            practice was banned in our own interface and left in the client's
            content, and this was the piece it missed. U+2713 is not in every
            font stack, so on the machines that lack it a list of what is
            included in a holiday drew a row of empty boxes down the left. It
            also cannot take a stroke weight, so it sat lighter than every other
            mark on the page.

            Decorative, and marked so. The tick means "included", which the
            list around it already says in words, and a screen reader announcing
            "tick" before each of eight bullets is noise rather than meaning.
          */}
          {style === 'tick' && <ContentIcon name="check" className="tgs-list__tick" />}
          {str(item, 'text')}
        </li>
      ))}
    </Tag>
  );
}

export function IconItemBlock({ props }: { props: Props }): ReactElement {
  // Matches the block's own default. A star CHARACTER here would mean a
  // block saved with no icon prop at all drew the one thing this replaced.
  const icon = str(props, 'icon', 'sparkles');
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
  /*
   * A NAME DRAWS AN ICON, ANYTHING ELSE IS PRINTED AS TYPED, and that one line
   * is what let the icon library arrive without a migration. Every icon on
   * every page built before 1 Aug 2026 is a character somebody typed, and those
   * pages have to keep drawing what they drew. So the value is looked up, and
   * only a hit becomes a picture.
   *
   * data-kind is on the span rather than inferred in CSS, because "is this
   * string an icon name" is a question only the icon set can answer and the
   * two cases want different sizing: a drawing is set in em and scales with the
   * text, a character is a glyph at whatever size its font gives it.
   */
  /*
   * ASKED OF THE ICON SET, NOT OF THE ELEMENT. The first version of this wrote
   * `const drawn = <ContentIcon .../>` and branched on `drawn`, which is always
   * truthy: JSX builds an element object whatever the component will later
   * return. So every value took the icon branch, ContentIcon returned null for
   * anything that was not a name, and a typed emoji rendered as an empty box.
   * Caught by the browser check for exactly that path, on 1 Aug 2026.
   */
  const drawable = isIconName(icon);

  /*
   * Optional colours, validated on the way out. Left blank they are undefined,
   * so the icon and the words keep following the section's tone as they always
   * did; set, they are a theme token or a hex that safeColour has already
   * cleared, so nothing an attacker typed can reach the style attribute.
   */
  const iconColour = safeColour(props.iconColour);
  const textColour = safeColour(props.textColour);

  return (
    <div className="tgs-icon-item" data-align={align}>
      {/* Decorative: the title carries the meaning. */}
      <span
        className="tgs-icon-item__icon"
        data-kind={drawable ? 'icon' : 'character'}
        aria-hidden="true"
        style={iconColour ? { color: iconColour } : undefined}
      >
        {drawable ? <ContentIcon name={icon} className="tgs-icon-item__svg" /> : icon}
      </span>
      <div style={textColour ? { color: textColour } : undefined}>
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

  /*
   * THE SHAPE OF THE FILE, WHICH IS WHAT STOPS THE PAGE JUMPING.
   *
   * A browser reads width and height off the tag, works out the ratio, and
   * reserves that space before a byte of the picture arrives. Without them an
   * image on the default Original shape reserves NOTHING and everything below
   * it moves when it lands, which is Cumulative Layout Shift: bad to read and a
   * ranking factor.
   *
   * ONLY WHEN THE RATIO IS 'auto'. Any other setting already puts an
   * aspect-ratio on the frame, which reserves the space by itself, and the
   * stored dimensions are the shape of the FILE rather than of the crop, so
   * emitting them next to a 16/9 frame would describe a box that is not there.
   *
   * A picture chosen before 1 Aug 2026 has no dimensions recorded and gets
   * none, exactly as before. Re-choosing it records them.
   */
  const width = clamp(props.width, 0, 20000, 0);
  const height = clamp(props.height, 0, 20000, 0);
  const measured = ratio === 'auto' && width > 0 && height > 0;

  /*
   * THE FOCUS POINT AND THE ADJUSTMENTS, PINNED TO THEIR RANGE in the shared
   * helper. They are set by clicking and dragging in the image editor, not
   * typed, and pass through the save untouched the same way width and height do,
   * so the render is where they are made safe. objectFit is the block's own Fit
   * field and rides alongside them.
   */
  const imageStyle: CSSProperties = { objectFit: fit, ...pictureAdjustStyle(props) };

  /*
   * THE FRAME'S OWN LOOK: custom corners and a border, both pinned here.
   *
   * Custom corners override the named Corners preset ONLY when at least one is
   * set, so a picture on plain Rounded keeps its class and nothing inline. A
   * border is drawn only when it has a width, and its colour goes through
   * safeColour like every other colour, falling back to the current text colour
   * so a width with no colour is still visible rather than invisible.
   */
  const corners = props.corners && typeof props.corners === 'object' ? (props.corners as Props) : {};
  const tl = clamp(corners.tl, 0, 500, 0);
  const tr = clamp(corners.tr, 0, 500, 0);
  const br = clamp(corners.br, 0, 500, 0);
  const bl = clamp(corners.bl, 0, 500, 0);
  const customCorners = tl > 0 || tr > 0 || br > 0 || bl > 0;

  const borderWidth = clamp(props.borderWidth, 0, 40, 0);
  const borderStyle = oneOf(props, 'borderStyle', ['solid', 'dashed', 'dotted'] as const, 'solid');
  const borderColour = safeColour(str(props, 'borderColour'));

  const frameLook: CSSProperties = {
    ...(customCorners ? { borderRadius: `${tl}px ${tr}px ${br}px ${bl}px` } : {}),
    ...(borderWidth > 0
      ? { border: `${borderWidth}px ${borderStyle} ${borderColour || 'currentColor'}` }
      : {}),
  };
  const frameStyle: CSSProperties = { ...ratioStyle(ratio), ...frameLook };

  /*
   * MORE THAN ONE PICTURE MAKES A SLIDESHOW.
   *
   * The extra pictures ride on `slides`; the block's own picture is the first.
   * It auto-plays in PURE CSS on purpose, so it runs on the published page and
   * in the editor preview alike, where a script never would, and it pauses on
   * hover the same way. Clickable arrows and dots are progressive enhancement,
   * added by the slideshow script only where a script can run. The frame keeps
   * its corners and border, and takes a real shape because absolutely stacked
   * slides give the box no height of their own, so Original falls back to 16:9.
   */
  const slideSrcs = list(props, 'slides')
    // Each slide's own focus point and adjustments travel with it, the same as a
    // gallery tile, so a slideshow of a landscape and a portrait keeps the right
    // part of each in frame rather than centring them all.
    .map((slide) => ({
      src: safeUrl(str(slide, 'src')),
      alt: str(slide, 'alt'),
      style: pictureAdjustStyle(slide),
    }))
    .filter((slide): slide is { src: string; alt: string; style: CSSProperties } => !!slide.src);

  if (slideSrcs.length > 0) {
    // The block's own picture is the first slide, and it keeps its focus and
    // adjustments too, which the earlier slideshow dropped by centring every one.
    const slides = [{ src, alt, style: pictureAdjustStyle(props) }, ...slideSrcs].slice(0, 8);
    const count = slides.length;
    const transition = oneOf(props, 'transition', ['fade', 'slide'] as const, 'fade');
    const interval = clamp(props.interval, 2, 15, 5);
    const showArrows = bool(props, 'arrows', true);
    const showDots = bool(props, 'dots', true);
    const viewportStyle: CSSProperties = {
      aspectRatio: ratio === 'auto' ? '16 / 9' : ratio.replace('/', ' / '),
      ...frameLook,
    };

    return (
      <div className="tgs-image">
        <figure>
          <div
            className="tgs-slideshow"
            data-transition={transition}
            data-count={count}
            data-interval={interval}
            data-dots={showDots ? 'true' : undefined}
            data-arrows={showArrows ? 'true' : undefined}
            style={{ '--tgs-ss-cycle': `${count * interval}s` } as CSSProperties}
            aria-roledescription="carousel"
            aria-label={alt || 'Image slideshow'}
          >
            <div className="tgs-slideshow__viewport" data-radius={radius} style={viewportStyle}>
              {slides.map((slide, index) => (
                <div
                  className="tgs-slideshow__slide"
                  key={index}
                  style={{ animationDelay: `calc(${index} * var(--tgs-ss-cycle) / ${count})` }}
                >
                  <img
                    src={slide.src}
                    alt={slide.alt}
                    style={slide.style}
                    loading={index === 0 ? 'eager' : 'lazy'}
                    decoding="async"
                  />
                </div>
              ))}
            </div>

            {showDots && (
              <div className="tgs-slideshow__dots" aria-hidden="true">
                {slides.map((_, index) => (
                  <span
                    className="tgs-slideshow__dot"
                    key={index}
                    style={{ animationDelay: `calc(${index} * var(--tgs-ss-cycle) / ${count})` }}
                  />
                ))}
              </div>
            )}
          </div>
          {caption && <figcaption>{caption}</figcaption>}
        </figure>
      </div>
    );
  }

  /*
   * THE CROP, DRAWN WITHOUT CUTTING THE FILE.
   *
   * The crop is four insets (a rectangle of the source, as percentages) plus the
   * shape that rectangle makes. The frame is given that shape, and the whole
   * picture is scaled up and slid behind it so only the chosen rectangle shows:
   * the crop's width becomes the frame's width, and its top-left corner lands at
   * the frame's. That the picture stays undistorted is not luck, it is what
   * pinning the frame to the crop's own pixel aspect guarantees, which is why
   * that number is stored rather than recomputed from a file whose dimensions
   * the render does not have. Set by dragging in the editor, so every number is
   * pinned here before it reaches the CSS.
   */
  const crop = props.crop && typeof props.crop === 'object' ? (props.crop as Props) : null;
  const cropX = clamp(crop?.x, 0, 100, 0);
  const cropY = clamp(crop?.y, 0, 100, 0);
  const cropW = clamp(crop?.w, 1, 100, 100);
  const cropH = clamp(crop?.h, 1, 100, 100);
  /*
   * THE ASPECT IS NOT ROUNDED. clamp() rounds to a whole number, which is right
   * for the percentages and the pixel sizes but wrong here: a 16:9 crop's aspect
   * is 1.78, and rounding it to 2 makes a 2:1 frame from a 16:9 crop. So it is
   * pinned to a sane band as a real number, not put through clamp.
   */
  const cropAspectRaw = typeof crop?.aspect === 'number' ? crop.aspect : Number(crop?.aspect);
  const cropAspect = Number.isFinite(cropAspectRaw)
    ? Math.min(100, Math.max(0, cropAspectRaw))
    : 0;
  const cropped = cropAspect > 0 && (cropX > 0 || cropY > 0 || cropW < 100 || cropH < 100);

  const picture = cropped ? (
    <div
      className="tgs-image__frame tgs-image__frame--crop"
      data-radius={radius}
      style={{ ...frameStyle, aspectRatio: `${cropAspect}`, position: 'relative' }}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        style={{
          position: 'absolute',
          width: `${10000 / cropW}%`,
          height: `${10000 / cropH}%`,
          left: `${(-100 * cropX) / cropW}%`,
          top: `${(-100 * cropY) / cropH}%`,
          ...pictureAdjustStyle(props),
        }}
      />
    </div>
  ) : (
    <div className="tgs-image__frame" data-radius={radius} style={frameStyle}>
      {/* Plain img rather than next/image: sources are arbitrary client URLs
          and the media pipeline with its own variants lands in a later
          package. */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        width={measured ? width : undefined}
        height={measured ? height : undefined}
        style={imageStyle}
      />
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
   * Draw the widget in its own frame rather than the bare container.
   *
   * True the whole time this is on the EDITOR CANVAS, editing or previewing, fed
   * by `editorCanvas` (not `editable`). It used to be a placeholder, because the
   * canvas re-renders on every keystroke and a widget script re-initialising each
   * time would thrash the page and hammer the config API. The frame solves that
   * instead of dodging it: the widget's script runs in its own document, which
   * React keeps across re-renders while the tag and id are unchanged, so it loads
   * once. Same reasoning as the render-must-not-grab-the-page rule.
   *
   * It has to stay true in preview too. Preview turns `editable` off so the canvas
   * shows the published DOM, but the bare container that the published page draws
   * is filled by WidgetScripts, which the editor never renders. Keyed off
   * `editable`, the widget would flip to that empty container and the section
   * would go blank. Keyed off `editorCanvas`, the same iframe stays mounted (tag
   * and id unchanged) and the widget carries straight through into preview.
   * (Andy, 11 Aug 2026: the Contact page's enquiry widget disappeared on Preview.)
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
    /*
     * THE REAL WIDGET ON THE CANVAS, in a frame of its own. Andy asked to see it
     * while building rather than a placeholder. The frame is the isolation the
     * ghost note used to promise in words: the widget's script runs in its own
     * document, so the editor's per-keystroke redraw cannot reach it and it
     * cannot reach the editor. React keeps the same iframe while the tag and id
     * are unchanged, so it loads ONCE, not on every keystroke, which is the whole
     * reason it was a placeholder before. Changing the widget or the id gives a
     * fresh document, which is right: it is a different widget.
     */
    return (
      <div className="tgs-widget-frame">
        <iframe title={kind.label} srcDoc={widgetPreviewDoc(kind, id)} loading="lazy" />
      </div>
    );
  }

  return <div className="tgs-widget" data-tg-widget={kind.tag} data-tg-id={id} />;
}

/**
 * The self-contained document a widget preview iframe carries.
 *
 * The container plus the one script the embed contract calls for, exactly as the
 * published page emits, but sealed in an iframe so it is the editor's preview
 * rather than a script on the editor itself. Everything in it is built here from
 * the closed list (the tag and the script name) and a validated id, so nothing
 * is client-controlled markup. The widget fetches its own config from
 * WIDGET_ORIGIN, which answers cross-origin, so the preview shows the real thing.
 *
 * IT SIZES ITS OWN FRAME. A short frame would cut a tall widget off, and the
 * editor cannot measure across into the iframe without shipping script the
 * published page must not carry. So the measuring is done from INSIDE, here: the
 * preview is same-origin (no sandbox), so it can set its own iframe's height to
 * its content and keep it in step as the widget loads and grows. None of this
 * reaches the published page, which renders the plain container and no script.
 */
function widgetPreviewDoc(kind: WidgetKind, id: string): string {
  const src = `${WIDGET_ORIGIN}/${kind.script}`;
  return (
    '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>html,body{margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif}</style>' +
    `<div data-tg-widget="${kind.tag}" data-tg-id="${id}"></div>` +
    `<script src="${src}" defer><\/script>` +
    '<script>(function(){function f(){try{var e=window.frameElement;' +
    'if(e)e.style.height=document.documentElement.scrollHeight+"px"}catch(_){}}' +
    'if(window.ResizeObserver){new ResizeObserver(f).observe(document.documentElement)}' +
    'addEventListener("load",f);setTimeout(f,1500)})();<\/script>'
  );
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
}: {
  props: Props;
  /** Kept for the shared block-render signature; the sealed box renders the same
   *  on the canvas and the page, so it is no longer read. */
  editing?: boolean;
}): ReactElement {
  const html = typeof props.html === 'string' ? props.html : '';
  const title = str(props, 'title') || 'Embedded widget';
  const height = clamp(props.height, 80, 2000, 420);

  if (!html.trim()) {
    return <div className="tgs-placeholder">Paste the code you were given</div>;
  }

  /*
   * RUN ON THE CANVAS TOO, sealed as ever. Andy asked to see it while building.
   * It was a placeholder before out of a fear the canvas would reload it on every
   * keystroke, but it does not: React keeps the same iframe while the code and
   * the height are unchanged, so it loads once, and only re-runs when the code
   * itself is edited, which is exactly when you want to see the change. The
   * `editing` flag is no longer read, because the sealed box is safe either way.
   */
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

/**
 * A location map, from an address alone.
 *
 * The client never touches a URL or a key: they type a place, and mapEmbedSrc
 * turns it into a sealed, host-fixed embed. See lib/content/map.ts for why that
 * is safe.
 *
 * THE MAP DRAWS ON THE CANVAS TOO, not only when published, because a client
 * asked to see it while building. What keeps that from reloading Google on every
 * keystroke is the field, not this: the address is committed when a match is
 * picked or the box is left, never per letter (see PlaceField in
 * components/editor/Fields.tsx), so the frame's src changes rarely. On the canvas
 * the frame is inert, `pointer-events: none`, so a click selects the block rather
 * than panning the map; published, it is live and full-screenable.
 */
export function MapBlock({
  props,
  editing = false,
}: {
  props: Props;
  editing?: boolean;
}): ReactElement {
  const address = str(props, 'address').trim();
  const height = clamp(props.height, 120, 1200, 360);
  const radius = oneOf(props, 'radius', RADII, 'md');
  const caption = str(props, 'caption');

  if (!address) {
    return <div className="tgs-placeholder">Add an address to show a map</div>;
  }

  const title = caption || `Map of ${address}`;
  const src = mapEmbedSrc(address, props.zoom);

  return (
    <div className="tgs-map">
      <figure style={{ margin: 0 }}>
        <div
          className="tgs-map__frame"
          data-radius={radius}
          // Inert on the canvas so a click selects the block; see the CSS.
          data-static={editing ? 'true' : undefined}
          style={{ height }}
        >
          {src && (
            <iframe
              src={src}
              title={title}
              loading="lazy"
              referrerPolicy="no-referrer"
              allowFullScreen={!editing}
            />
          )}
        </div>
        {caption && <figcaption className="tgs-image">{caption}</figcaption>}
      </figure>
    </div>
  );
}

/**
 * Before and after: two pictures and a divider you drag.
 *
 * PURE CSS, NO SCRIPT, the same rule the slider and the tabs keep. The after
 * picture is the base layer; the before picture sits over it in a box the
 * browser lets you resize, so dragging that box's edge uncovers the after
 * picture beneath. The before picture is pinned to the left and sized to the
 * WHOLE frame with `100cqw` (the frame is a container), so shrinking its box
 * clips it from the right rather than squashing it, and the two line up. The
 * fixed shape keeps their heights equal so the seam is clean.
 *
 * Both sources go through safeUrl. With neither picture it asks for them; with
 * one, it shows the one it has, so the block is never a blank rectangle.
 */
export function BeforeAfterBlock({ props }: { props: Props }): ReactElement {
  const before = safeUrl(str(props, 'before'));
  const after = safeUrl(str(props, 'after'));
  const beforeAlt = str(props, 'beforeAlt');
  const afterAlt = str(props, 'afterAlt');
  const beforeLabel = str(props, 'beforeLabel');
  const afterLabel = str(props, 'afterLabel');
  const ratio = str(props, 'ratio', '16/9');
  const start = clamp(props.start, 0, 100, 50);

  if (!before && !after) {
    return <div className="tgs-placeholder">Choose a before and an after image</div>;
  }

  return (
    <div className="tgs-ba" style={ratioStyle(ratio)}>
      {/* Base layer: the AFTER picture fills the frame. */}
      {after ? (
        <img className="tgs-ba__img" src={after} alt={afterAlt} loading="lazy" />
      ) : (
        <div className="tgs-ba__missing">Add the after image</div>
      )}
      {after && afterLabel && <span className="tgs-ba__badge tgs-ba__badge--after">{afterLabel}</span>}

      {/* Overlay: the BEFORE picture, in a box you drag to reveal the after. */}
      {before && (
        <div className="tgs-ba__reveal" style={{ width: `${start}%` }}>
          <img className="tgs-ba__img tgs-ba__img--before" src={before} alt={beforeAlt} loading="lazy" />
          {beforeLabel && <span className="tgs-ba__badge tgs-ba__badge--before">{beforeLabel}</span>}
          <span className="tgs-ba__handle" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/** Five stars, the first `rating` of them filled. Drawn, not typed, so it reads
 *  the same in every font, and labelled for a screen reader. */
function Stars({ rating }: { rating: number }): ReactElement {
  return (
    <div className="tgs-tsl__stars" role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} className="tgs-tsl__star" data-on={n <= rating ? 'true' : undefined} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.1l5.8-.8z" />
        </svg>
      ))}
    </div>
  );
}

/**
 * Testimonials on a rail: what your clients said, in the site's own type.
 *
 * PURE CSS, NO SCRIPT, the same scroll-snap rail the slider uses. Each card is a
 * rating, a quote, a name, a line of detail and a photo; the rating is clamped
 * here and the photo goes through safeUrl. An empty rating draws no stars, an
 * empty photo draws none, so a half-filled testimonial still reads cleanly.
 */
export function TestimonialsBlock({ props }: { props: Props }): ReactElement {
  const items = list(props, 'items');
  if (!items.length) {
    return <div className="tgs-placeholder">Add a testimonial</div>;
  }

  /*
   * TEXT AND CARD COLOUR, both through safeColour so neither is ever a free-text
   * style. The text colour is set on the block and inherited by every card's
   * words; the card colour rides a CSS variable the card background reads, so one
   * control paints all the cards. Blank leaves each following the section and the
   * site surface, exactly as a colour field does everywhere else.
   */
  const textColour = safeColour(props.textColour);
  const cardColour = safeColour(props.cardColour);
  const style: CSSProperties = {};
  if (textColour) style.color = textColour;
  if (cardColour) (style as Record<string, string>)['--tgs-tsl-card'] = cardColour;

  return (
    <div className="tgs-tsl" style={Object.keys(style).length ? style : undefined}>
      <div className="tgs-tsl__track">
        {items.map((item, index) => {
          const quote = str(item, 'quote');
          const name = str(item, 'name');
          const detail = str(item, 'detail');
          const rating = clamp(item.rating, 0, 5, 0);
          const photo = safeUrl(str(item, 'photo'));
          const alt = str(item, 'alt');
          return (
            <figure className="tgs-tsl__card" key={index}>
              {rating > 0 && <Stars rating={rating} />}
              {quote && <blockquote className="tgs-tsl__quote">{quote}</blockquote>}
              {(name || detail || photo) && (
                <figcaption className="tgs-tsl__by">
                  {photo && <img className="tgs-tsl__photo" src={photo} alt={alt} loading="lazy" />}
                  <span className="tgs-tsl__meta">
                    {name && <span className="tgs-tsl__name">{name}</span>}
                    {detail && <span className="tgs-tsl__detail">{detail}</span>}
                  </span>
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A sound clip in the browser's own player.
 *
 * NATIVE <audio controls>, NO SCRIPT: the browser draws the player and runs it.
 * The source is a link through safeUrl, and preload is off, so nothing is
 * fetched until play, which keeps the editor's per-keystroke redraw and a
 * visitor's page load from pulling the file down for no reason.
 */
export function AudioBlock({ props }: { props: Props }): ReactElement {
  const src = safeUrl(str(props, 'src'));
  const title = str(props, 'title');
  const caption = str(props, 'caption');
  const textColour = safeColour(props.textColour);

  if (!src) {
    return <div className="tgs-placeholder">Add a link to your audio</div>;
  }

  return (
    <div className="tgs-audio" style={textColour ? { color: textColour } : undefined}>
      {title && <div className="tgs-audio__title">{title}</div>}
      <audio className="tgs-audio__player" controls preload="none" src={src}>
        Your browser cannot play this audio.
      </audio>
      {caption && <div className="tgs-audio__caption">{caption}</div>}
    </div>
  );
}

export function GalleryBlock({ props }: { props: Props }): ReactElement {
  const columns = oneOf(props, 'columns', ['2', '3', '4'] as const, '3');
  const gap = str(props, 'gap', 'm');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const images = list(props, 'images')
    // The tile's own focus point and adjustments travel with it, worked out
    // through the same helper the image block uses, so a tile can be focused
    // where it matters when the square crops a landscape or a portrait.
    .map((image) => ({
      src: safeUrl(str(image, 'src')),
      alt: str(image, 'alt'),
      style: pictureAdjustStyle(image),
    }))
    .filter(
      (image): image is { src: string; alt: string; style: CSSProperties } => !!image.src,
    );

  if (images.length === 0) {
    return <div className="tgs-placeholder">Add some images</div>;
  }

  return (
    <div className="tgs-gallery" data-columns={columns} data-gap={gap}>
      {images.map((image, index) => (
        <div key={index} className="tgs-image__frame" data-radius={radius}>
          <img
            src={image.src}
            alt={image.alt}
            loading="lazy"
            decoding="async"
            style={image.style}
          />
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
  const textColour = safeColour(props.textColour);

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
      style={textColour ? { color: textColour } : undefined}
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
  const textColour = safeColour(props.textColour);

  const rows = items.filter((item) => str(item, 'title') || str(item, 'body'));

  if (rows.length === 0) {
    return <div className="tgs-placeholder">Add some sections</div>;
  }

  return (
    <div className="tgs-accordion" data-style={style} style={textColour ? { color: textColour } : undefined}>
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
  const textColour = safeColour(props.textColour);

  const items = list(props, 'items')
    .filter((item) => str(item, 'title'))
    .slice(0, MAX_TABS);

  if (items.length === 0) {
    return <div className="tgs-placeholder">Add some tabs</div>;
  }

  const name = `tgs-tabs-${blockId}`;

  return (
    <div className="tgs-tabs" data-style={style} data-align={align} style={textColour ? { color: textColour } : undefined}>
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

  /*
   * Optional colours over the top of the style. `colour` fills the button and
   * matches its edge to the fill so an outlined style does not keep a border of
   * a different colour; `textColour` is the label. Both validated on the way
   * out, so a button colour is never a free-text style attribute. Blank leaves
   * the variant's own colours alone, which is the default a button has always
   * had. Inline beats the class rules, hover included, so a coloured button
   * simply keeps its colour rather than flicking to the theme's on hover.
   */
  const fill = safeColour(button.colour);
  const textColour = safeColour(button.textColour);
  const style: CSSProperties = {};
  if (fill) {
    style.background = fill;
    style.borderColor = fill;
  }
  if (textColour) style.color = textColour;

  return (
    <a
      key={key}
      className="tgs-button"
      data-variant={variant}
      data-size={size}
      href={href}
      style={Object.keys(style).length ? style : undefined}
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

  const textColour = safeColour(props.textColour);
  const markerColour = safeColour(props.markerColour);
  /*
   * A marker is a ring with a number, or a filled dot. So the chosen colour is
   * its text, its border AND, when it is a dot, its fill. Set on the span so it
   * beats the class rule; left undefined the CSS keeps the brand colour it had.
   */
  const markerStyle = markerColour
    ? { color: markerColour, borderColor: markerColour, background: marker === 'dot' ? markerColour : undefined }
    : undefined;

  return (
    <ol
      className="tgs-steps"
      data-layout={layout}
      data-marker={marker}
      data-connector={connector ? 'true' : undefined}
      // Cascades to the titles and text; the marker keeps its own colour above
      // because its class rule beats an inherited one.
      style={textColour ? { color: textColour } : undefined}
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
            <span className="tgs-steps__marker" aria-hidden="true" style={markerStyle} />
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
 * The stats row: a few big figures with a word under each.
 *
 * A `ul`, because it IS a list of statistics and nothing about it is ordered.
 * Steps next door is an `ol` for the opposite reason.
 *
 * THE FIGURE COMES FIRST IN THE MARKUP as well as on the screen, so a screen
 * reader reads "twelve thousand plus, holidays booked" rather than the label
 * and then the number it belongs to. That is the reading order somebody wants,
 * and it is the reason this is not a description list: a `dl` would need the
 * label first to be valid, and then either the reading order or the visual
 * order has to be faked with CSS.
 *
 * AN ENTRY NEEDS A FIGURE OR A LABEL, and one with neither is dropped. Unlike a
 * step, whose position IS its number, a blank stat means nothing at all: it
 * would draw an empty column and push the others out of true. Keeping the
 * either-or rather than demanding both is what lets somebody type the figures
 * for all four and then go back and label them.
 */
export function StatsBlock({ props }: { props: Props }): ReactElement {
  const columns = oneOf(props, 'columns', ['2', '3', '4'] as const, '3');
  const size = oneOf(props, 'size', ['m', 'l', 'xl'] as const, 'l');
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'centre');
  const divided = bool(props, 'divided');
  const countUp = bool(props, 'countUp');

  const items = list(props, 'items')
    .map((item) => {
      const value = str(item, 'value');
      // Count only a plain whole number of up to nine digits, so a comma, a
      // decimal or 24/7 is left exactly as written rather than mangled.
      const counts = countUp && /^\d{1,9}$/.test(value);
      return {
        value,
        count: counts ? Number(value) : null,
        digits: value.length,
        prefix: str(item, 'prefix'),
        suffix: str(item, 'suffix'),
        label: str(item, 'label'),
        detail: str(item, 'detail'),
      };
    })
    .filter((item) => item.value !== '' || item.label !== '');

  if (items.length === 0) {
    return <div className="tgs-placeholder">Add a number or two</div>;
  }

  const textColour = safeColour(props.textColour);
  const figureColour = safeColour(props.figureColour);

  return (
    <ul
      className="tgs-stats"
      data-columns={columns}
      data-size={size}
      data-align={align}
      data-divided={divided ? 'true' : undefined}
      // The labels and detail follow this; the figure keeps its own colour
      // below, whose class rule beats an inherited one.
      style={textColour ? { color: textColour } : undefined}
    >
      {items.map((item, index) => (
        <li className="tgs-stats__item" key={index}>
          <p className="tgs-stats__figure" style={figureColour ? { color: figureColour } : undefined}>
            {/*
              The affixes are their own elements ONLY so they can be set
              smaller. They are read aloud as part of the figure either way,
              which is right: "£2m" and "4.9 out of 5" are single facts.
            */}
            {item.prefix && <span className="tgs-stats__affix">{item.prefix}</span>}
            {item.count !== null ? (
              <span
                className="tgs-stats__value"
                data-count=""
                style={{ '--tgs-count-to': String(item.count), minWidth: `${item.digits}ch` } as CSSProperties}
              >
                <span className="tgs-stats__num">{item.value}</span>
              </span>
            ) : (
              item.value
            )}
            {item.suffix && <span className="tgs-stats__affix">{item.suffix}</span>}
          </p>
          {item.label && <p className="tgs-stats__label">{item.label}</p>}
          {item.detail && <p className="tgs-stats__detail">{item.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * A strip of badges: ABTA, ATOL, the operators a shop sells.
 *
 * A COMMON HEIGHT, NOT A COMMON RATIO. Every logo gets the same vertical space
 * and keeps its own width, set with object-fit: contain so nothing is ever
 * cropped. That single line is the whole difference between this and the
 * Gallery block, and it is why a gallery could never do this job: logos have no
 * ratio in common, so any grid mangles most of them.
 *
 * A LOGO IS ONLY LINKED WHEN IT HAS A NAME. An anchor whose only child is an
 * image with no alt text has no accessible name at all: a screen reader reaches
 * it and announces "link", or reads out the file name, and neither tells anyone
 * where it goes. So a linked logo with no name renders as a plain logo, and the
 * editor says so on the field rather than letting it happen quietly. Same
 * shape of rule as the Social block dropping an entry with no address.
 */
export function LogosBlock({ props }: { props: Props }): ReactElement {
  const height = oneOf(props, 'height', ['s', 'm', 'l'] as const, 'm');
  const gap = str(props, 'gap', 'l');
  const tone = oneOf(props, 'tone', ['colour', 'grey', 'grey-hover'] as const, 'colour');
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'centre');

  const items = list(props, 'items')
    .map((item) => ({
      src: safeUrl(str(item, 'src')) ?? '',
      alt: str(item, 'alt'),
      href: safeUrl(str(item, 'href')) ?? '',
    }))
    .filter((item) => item.src !== '');

  if (items.length === 0) {
    return <div className="tgs-placeholder">Add your badges and partner logos</div>;
  }

  return (
    <ul className="tgs-logos" data-height={height} data-gap={gap} data-tone={tone} data-align={align}>
      {items.map((item, index) => {
        const logo = (
          <img
            className="tgs-logos__img"
            src={item.src}
            alt={item.alt}
            loading="lazy"
            decoding="async"
          />
        );
        // Both, not either. See the note above: a link needs a name, and the
        // alt text is the only name a logo has.
        const linked = item.href !== '' && item.alt !== '';
        const external = /^https?:/i.test(item.href);

        return (
          <li className="tgs-logos__item" key={index}>
            {linked ? (
              <a href={item.href} rel={external ? 'noopener noreferrer' : undefined}>
                {logo}
              </a>
            ) : (
              logo
            )}
          </li>
        );
      })}
    </ul>
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
  const textColour = safeColour(props.textColour);

  return (
    <div
      className="tgs-table__scroll"
      role="region"
      aria-label={caption || 'Table. Scroll sideways to see all of it.'}
      tabIndex={0}
    >
      <table className="tgs-table" data-style={style} style={textColour ? { color: textColour } : undefined}>
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

/**
 * An imported design.
 *
 * KNOWN COST, MEASURED, AND DELIBERATELY ACCEPTED FOR NOW. The imports at the
 * top of this file pull parse5 and postcss into the EDITOR'S BROWSER BUNDLE,
 * because the canvas renders blocks client side: Canvas.tsx is a client
 * component, it renders PageRenderer, which renders BlockRenderer, which
 * renders this. Measured on 1 Aug 2026: /editor went from 119kB to 197kB and
 * first load from 271kB to 350kB.
 *
 * The alternative was to drop the render-time clean and trust what the save
 * path stored, which is the one thing this whole module exists not to do, and
 * it is worse than it sounds: staff open a client's site in this same editor,
 * so a payload that only ran on the canvas would run in a session with staff
 * powers. Bytes on an authenticated internal tool are the cheaper of the two.
 *
 * THE PROPER FIX, when somebody picks this up: clean and scope on the server,
 * where these modules already belong, and pass the result down to the renderer
 * as plain strings. Every page that draws content is a server component
 * already; only the canvas is not. Task #94.
 *
 * RE-CLEANED ON EVERY RENDER, not trusted because it was cleaned on the way in.
 * That is the same rule the rich text and the embed block follow, and it earns
 * its keep here more than anywhere else: this markup came from a stranger's
 * tool, and the thing standing between it and a live client site is
 * cleanImportHtml, so a snapshot restored from before a fix, a row edited by
 * hand, or a build where the save path changed all land on the same answer.
 *
 * THE ORDER MATTERS AND IT IS THE OPPOSITE OF THE OBVIOUS ONE. Clean first,
 * then put the client's words in. Substituting first would hand the cleaner
 * markup it had never checked, so a client typing into a slot would be typing
 * into the sanitiser's input. Cleaning first means a slot is still a slot when
 * the cleaner is done with it, and the words that replace it are escaped by
 * applyImportContent according to what the slot IS.
 *
 * THE STYLESHEET IS SCOPED TO THIS BLOCK'S OWN CLASS, so two imported designs
 * on one page cannot argue with each other or with ours. importScopeClass is
 * the single place that name is decided, because the wrapper wearing it and the
 * CSS depending on it have to agree and a mismatch is an unstyled section with
 * no error anywhere.
 */
export function ImportedBlock({ props, blockId }: { props: Props; blockId: string }): ReactElement {
  const scope = importScopeClass(blockId);
  const fields = importFields(props);

  const cleaned = cleanImportHtml(str(props, 'html'));
  const html = applyImportContent(cleaned.html, importContent(props), fields);
  const { css } = scopeImportCss(str(props, 'css'), { scope: `.${scope}` });

  if (!html.trim()) {
    return <div className="tgs-placeholder">This imported design has nothing in it</div>;
  }

  return (
    <div className={`tgs-imported ${scope}`}>
      {/*
        * dangerouslySetInnerHTML rather than a text child, and it is the SAFE
        * choice here rather than the reckless one. React escapes a text child
        * of <style> when it renders on the server, so `&:hover` would ship as
        * `&amp;:hover` and every nested rule in a modern export would break.
        * What makes it safe is scopeImportCss, which escapes `</` on the way
        * out so nothing in the stylesheet can close this tag early.
        */}
      {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export { ALIGNS };
