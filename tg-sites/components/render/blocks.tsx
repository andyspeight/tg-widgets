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
import { burgerMode, hasBurger, showsRow } from '../../lib/content/burger';
import { copyrightLine } from '../../lib/content/copyright';
import { couponEndsLabel, couponExpired, todayUtc } from '../../lib/content/coupon';
import { whatsappHref } from '../../lib/content/whatsapp';
import { safeColour } from '../../lib/content/schema';
import { humanBytes } from '../../lib/media/limits';
import { FONT_CHOICES, FONT_SIZES } from '../../lib/content/styles';
import { importContent, importFields } from '../../lib/content/imported';
import { cleanImportHtml } from '../../lib/import/html';
import { importScopeClass, scopeImportCss } from '../../lib/import/css';
import { applyImportContent } from '../../lib/import/tokenise';
import { parseTable } from '../../lib/content/table';
import { resolveVideo } from '../../lib/content/video';
import { mapDirectionsUrl, mapEmbedSrc } from '../../lib/content/map';
import { socialNetwork } from '../../lib/content/social';
import { safeWidgetId, widgetKind, WIDGET_ORIGIN, type WidgetKind } from '../../lib/content/widgets';
import { SocialIcon } from './social-icons';
import { ContentIcon } from './content-icon';
import { isIconName } from '../../lib/content/icons';

type Props = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Prop accessors
// ---------------------------------------------------------------------------

/**
 * EVERY LINK A CLIENT CAN TYPE MAY BE A CONTACT LINK.
 *
 * Passed to safeUrl at every href in this file, and it is a shared constant
 * rather than an option object written out eight times so the next link field
 * cannot quietly forget it. That is exactly how this went wrong: the save path
 * allowed tel: and mailto: on any url field, and seven of the eight renderers
 * here called safeUrl WITHOUT the option, so a client could type a phone number
 * into a Button, save it happily, and publish a button whose href was "#". Only
 * the social row got it right, and only because an email link there was obvious.
 *
 * Nothing is loosened by it. safeUrl still refuses every other scheme; a browser
 * hands mailto: to a mail client and tel: to a dialler, and neither can run
 * anything. Found on 20 Aug 2026 while checking whether the Duda list's "Click To
 * Call" and "Click to Email" were already built. They nearly were.
 */
const CONTACT_OK = { allowContact: true } as const;

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

export function QuoteBlock({
  props,
  editingHost = false,
}: {
  props: Props;
  /**
   * Render the quote's words as an empty shell for the editor to type into.
   *
   * The same no-children trick as TextBlock, and it is plain text not markup:
   * the quote's `text` was always a plain string, so the host is marked
   * data-rt-plain and the editor reads it back as text, not HTML. The byline
   * below stays as it is: it is optional and only renders when it has content,
   * so there is nothing to click into when it is empty, and it is edited in the
   * properties pane where an empty field still has a labelled box.
   */
  editingHost?: boolean;
}): ReactElement {
  const text = str(props, 'text');
  const attribution = str(props, 'attribution');
  const role = str(props, 'role');
  const textColour = safeColour(props.textColour);

  return (
    <figure className="tgs-quote" style={textColour ? { color: textColour } : undefined}>
      {editingHost ? (
        <blockquote
          className="tgs-quote__text"
          data-rt-host=""
          data-rt-field="text"
          data-rt-plain=""
          suppressHydrationWarning
        />
      ) : (
        <blockquote className="tgs-quote__text">{text}</blockquote>
      )}
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

export function ListBlock({
  props,
  editingHost = false,
}: {
  props: Props;
  /**
   * Render each item's words as an empty host for the editor to type into.
   *
   * The same no-children trick the other plain blocks use, one host per item.
   * Each carries its index in the field, data-rt-field="items.N.text", which is
   * how Canvas seeds it from props.items[N].text and commits a keystroke back to
   * that one item without disturbing the rest. The tick stays outside the host,
   * so it is a drawn mark and never becomes editable. An empty list has no items
   * and so no hosts: items are added and removed in the properties pane, the same
   * as a quote's byline.
   */
  editingHost?: boolean;
}): ReactElement {
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
          {editingHost ? (
            <span
              className="tgs-list__text"
              data-rt-host=""
              data-rt-field={`items.${index}.text`}
              data-rt-plain=""
              data-rt-oneline=""
              suppressHydrationWarning
            />
          ) : (
            str(item, 'text')
          )}
        </li>
      ))}
    </Tag>
  );
}

export function IconItemBlock({
  props,
  editingHost = false,
}: {
  props: Props;
  /**
   * Type the icon item's words in place: its title, then its body, each its own
   * plain host. The same no-children trick as the quote, twice, because an icon
   * item has two fields where a quote has one. Both are marked data-rt-plain, so
   * the editor reads them back as text, and both render even when empty so there
   * is somewhere to click into a title or a body that has not been written yet.
   * The icon stays in the properties pane: it is picked from the library, not
   * typed. Only ever true in the editor.
   */
  editingHost?: boolean;
}): ReactElement {
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
        {editingHost ? (
          <>
            <p
              className="tgs-icon-item__title"
              data-rt-host=""
              data-rt-field="title"
              data-rt-plain=""
              data-rt-oneline=""
              suppressHydrationWarning
            />
            <p
              className="tgs-icon-item__body"
              data-rt-host=""
              data-rt-field="body"
              data-rt-plain=""
              data-rt-oneline=""
              suppressHydrationWarning
            />
          </>
        ) : (
          <>
            {title && <p className="tgs-icon-item__title">{title}</p>}
            {body && <p className="tgs-icon-item__body">{body}</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export function ImageBlock({
  props,
  editing = false,
}: {
  props: Props;
  /* Only a film slide reads this: it must not autoplay on the canvas, where the
     editor re-renders on every keystroke and moving pictures fight the pointer. */
  editing?: boolean;
}): ReactElement {
  const src = safeUrl(str(props, 'src'));
  const alt = str(props, 'alt');
  const ratio = str(props, 'ratio', 'auto');
  const fit = oneOf(props, 'fit', ['cover', 'contain'] as const, 'cover');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const caption = str(props, 'caption');
  const href = safeUrl(str(props, 'href'), CONTACT_OK);

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
      // A slide can be a film instead. See the field's own note for why it is a
      // file address rather than a YouTube link.
      video: safeUrl(str(slide, 'video')),
      alt: str(slide, 'alt'),
      style: pictureAdjustStyle(slide),
    }))
    /*
     * A SLIDE NEEDS ONE OR THE OTHER, not both. A row with neither is an empty
     * frame the visitor waits through and a slot in the cycle; a row with a film
     * and no picture is a perfectly good slide, which is why this is not still
     * testing `src` alone.
     */
    .filter(
      (slide): slide is { src: string; video: string; alt: string; style: CSSProperties } =>
        !!slide.src || !!slide.video,
    );

  if (slideSrcs.length > 0) {
    // The block's own picture is the first slide, and it keeps its focus and
    // adjustments too, which the earlier slideshow dropped by centring every one.
    const slides = [{ src, video: '', alt, style: pictureAdjustStyle(props) }, ...slideSrcs].slice(0, 8);
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
                  {slide.video ? (
                    /*
                      A FILM SLIDE. Muted, looping and playing by itself, which is
                      also the only way a browser will autoplay anything: an
                      unmuted autoplay is blocked, and rightly.

                      NOT AUTOPLAYING ON THE CANVAS. The editor re-renders on
                      every keystroke and a film moving under the pointer fights
                      the person trying to select it, the same reason the section
                      background video does not play there either. Paused it
                      still shows its first frame, so the slide is not a hole.

                      `alt` becomes the accessible name rather than being lost:
                      a video element takes no alt attribute.
                    */
                    <video
                      src={slide.video}
                      poster={slide.src || undefined}
                      style={slide.style}
                      autoPlay={!editing}
                      muted
                      loop
                      playsInline
                      preload={index === 0 ? 'auto' : 'metadata'}
                      aria-label={slide.alt || undefined}
                    />
                  ) : (
                    <img
                      src={slide.src}
                      alt={slide.alt}
                      style={slide.style}
                      loading={index === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                    />
                  )}
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

export function GalleryBlock({
  props,
  blockId,
}: {
  props: Props;
  blockId: string;
}): ReactElement {
  const columns = oneOf(props, 'columns', ['2', '3', '4'] as const, '3');
  const layout = oneOf(props, 'layout', ['grid', 'scroll'] as const, 'grid');
  const lightbox = bool(props, 'lightbox', true);
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

  const name = `tgs-lb-${blockId}`;

  const tile = (image: { src: string; alt: string; style: CSSProperties }, index: number) => (
    <img
      src={image.src}
      alt={image.alt}
      loading="lazy"
      decoding="async"
      style={image.style}
      key={`i${index}`}
    />
  );

  /*
   * THE RAIL DUPLICATES ITS PICTURES, and the copy is aria-hidden. A marquee
   * that scrolls to the end and jumps back is the giveaway that it is a trick;
   * two copies translated by half the width loop seamlessly. The copy is the
   * same pictures, so a screen reader must not read the gallery twice. Same
   * device the logo strip uses, and the reduced-motion rule below drops the
   * copy entirely rather than leaving a silent duplicate on the page.
   */
  const strip = (copy: boolean) =>
    images.map((image, index) => (
      <div
        key={`${copy ? 'b' : 'a'}${index}`}
        className="tgs-gallery__cell"
        data-radius={radius}
        {...(copy ? { 'aria-hidden': true as const } : {})}
      >
        {lightbox && !copy ? (
          <>
            <input
              className="tgs-gallery__cb tgs-sr-only"
              type="checkbox"
              id={`${name}-${index}`}
              /*
               * Uncontrolled, like Tabs and Expanding cards: which picture is
               * open is the browser's business, and a controlled value would
               * make the editor canvas slam it shut on every keystroke.
               */
            />
            <label className="tgs-gallery__open" htmlFor={`${name}-${index}`}>
              {tile(image, index)}
              <span className="tgs-sr-only">See this picture larger</span>
            </label>

            {/*
              THE OVERLAY IS A REAL ONE, position: fixed to the viewport. That is
              worth saying because an earlier note in this repo claimed it was
              impossible from inside `.tgs-page`; measured on 21 Aug 2026, a
              container-type element does NOT contain a fixed descendant.

              WHAT IS STILL NOT POSSIBLE without a script is trapping focus, so
              this is built to need no trap: closed, it is `visibility: hidden`
              and nothing inside it is tabbable, and open, the close button is
              the very next thing after the thumbnail that opened it. Clicking
              anywhere off the picture closes it too.
            */}
            <div className="tgs-gallery__lightbox">
              <label
                className="tgs-gallery__backdrop"
                htmlFor={`${name}-${index}`}
                aria-label="Close the picture"
              />
              <figure className="tgs-gallery__big">
                <img src={image.src} alt={image.alt} loading="lazy" decoding="async" />
                {image.alt && <figcaption>{image.alt}</figcaption>}
              </figure>
              <label
                className="tgs-gallery__close"
                htmlFor={`${name}-${index}`}
                aria-label="Close the picture"
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </label>
            </div>
          </>
        ) : (
          tile(image, index)
        )}
      </div>
    ));

  if (layout === 'scroll') {
    return (
      <div className="tgs-gallery-marquee" data-gap={gap}>
        <div className="tgs-gallery tgs-gallery--rail" data-gap={gap}>
          {strip(false)}
          {strip(true)}
        </div>
      </div>
    );
  }

  return (
    <div className="tgs-gallery" data-columns={columns} data-gap={gap}>
      {strip(false)}
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
  const href = safeUrl(str(card, 'linkHref'), CONTACT_OK);
  const linkLabel = str(card, 'linkLabel');
  // The post's tags, on a collection-filled card (see itemAsCard). Plain labels
  // rendered as text by React, and only strings survive, so a manual card with a
  // stray tags prop cannot put anything but words on the page.
  const rawTags = (card as Record<string, unknown>).tags;
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
    : [];
  // The byline and the reading time, joined into one line, each part only when
  // it is there: "By Jane Doe" · "4 min read". Both are rendered as text.
  const author = str(card, 'author');
  const rawMinutes = (card as Record<string, unknown>).readingMinutes;
  const readingMinutes = typeof rawMinutes === 'number' && rawMinutes > 0 ? rawMinutes : 0;
  const meta = [author, readingMinutes > 0 ? `${readingMinutes} min read` : '']
    .filter(Boolean)
    .join(' · ');

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
        {meta && <p className="tgs-card__meta">{meta}</p>}
        {body && <p className="tgs-card__text">{body}</p>}

        {tags.length > 0 && (
          <ul className="tgs-card__tags">
            {tags.map((tag, tagIndex) => (
              <li key={tagIndex} className="tgs-card__tag">
                {tag}
              </li>
            ))}
          </ul>
        )}

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
  const tilt = oneOf(props, 'tilt', ['none', 'gentle', 'strong'] as const, 'none');
  /*
   * One rail, one or two rows deep, and how loudly it says "this moves".
   * Both read through oneOf, so a value written by a later release cannot ask
   * for a third row or a scrollbar style the stylesheet has no rule for.
   */
  const rows = oneOf(props, 'rows', ['1', '2'] as const, '1');
  const scrollbar = oneOf(props, 'scrollbar', ['thin', 'bar'] as const, 'thin');

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
      /* The picture shape, so the stylesheet can give a frame back its height
         when the shape is Original and there is no aspect ratio to hold it up. */
      data-ratio={ratio}
      /* Only when it is two, so a one-row rail stays plain markup. */
      data-rows={rows === '2' ? '2' : undefined}
      data-scrollbar={scrollbar}
      data-whole={whole ? 'true' : undefined}
      data-tilt={tilt === 'none' ? undefined : tilt}
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

  const href = safeUrl(str(button, 'href'), CONTACT_OK) || '#';
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
  const outline = bool(button, 'outline');
  const style: CSSProperties = {};
  if (outline) {
    /*
     * Outlined: the chosen colour is the edge and, unless a label colour is set,
     * the words too, and the fill stays clear. This is what the dark navbar
     * references use for a quiet call to action, a hairline pill rather than a
     * solid one, and it is why `colour` alone could not do it: that fills.
     */
    if (fill) {
      style.background = 'transparent';
      style.borderColor = fill;
      style.color = textColour ?? fill;
    } else if (textColour) {
      style.color = textColour;
    }
  } else {
    if (fill) {
      style.background = fill;
      style.borderColor = fill;
    }
    if (textColour) style.color = textColour;
  }

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

/**
 * A PICTURE BESIDE A TINTED PANEL, AND MORE THAN ONE OF THEM IS A SLIDER.
 *
 * Andy, 20 Aug 2026, from Duda's Half Overlay Slider. It exists as a block
 * because a COLUMN CANNOT CARRY A PHOTOGRAPH — a Box has a colour, a gradient, a
 * radius, a border and a blur, and no picture — so the tinted half has nowhere
 * to live in an ordinary two-column row.
 *
 * IT BORROWS THE SLIDESHOW WHOLE. The wrapper is the same `.tgs-slideshow` the
 * Image block emits, carrying the same data attributes, so it cycles in pure CSS
 * by itself and public/slideshow.js gives it arrows, dots and a pause button
 * without one line of that file changing. That script queries `.tgs-slideshow`
 * and `.tgs-slideshow__slide` and asks nothing about what is inside them, which
 * is what makes this free.
 *
 * ONE SLIDE IS NOT A SLIDESHOW, and it renders as a plain panel with no wrapper,
 * no dots and no cycle — the same rule the Image block follows for one picture.
 * That matters beyond tidiness: an auto-moving thing with a single frame would
 * still ask for a pause button nobody needs.
 */
function halfOverlaySlide(
  slide: Props,
  look: { tint: string; tintOpacity: number; buttonColour: string | undefined; solo: boolean },
): ReactElement {
  const src = safeUrl(str(slide, 'src'));
  const panelSrc = safeUrl(str(slide, 'panelSrc'));
  const side = oneOf(slide, 'side', ['left', 'right'] as const, 'left');
  const title = str(slide, 'title');
  const body = str(slide, 'body');

  const primary = str(slide, 'primaryLabel');
  const secondary = str(slide, 'secondaryLabel');

  /*
   * THE TITLE IS A HEADING ONLY WHEN THERE IS ONE SLIDE.
   *
   * A slider of twelve slides would otherwise put twelve headings into the
   * document outline with eleven of them invisible at any moment, which is worse
   * for a screen reader than no heading at all: the outline would promise
   * sections of the page that cannot be reached in order. A single panel is an
   * ordinary feature block and its title is a real heading.
   */
  const Title = look.solo ? 'h2' : 'p';

  return (
    <div className="tgs-halfover" data-side={side}>
      <div className="tgs-halfover__pic">
        {src ? (
          <img src={src} alt={str(slide, 'alt')} loading="lazy" decoding="async" />
        ) : (
          <div className="tgs-halfover__empty" aria-hidden="true" />
        )}
      </div>

      <div className="tgs-halfover__panel">
        {/* The picture under the wash. Optional: without it the panel is the
            colour on its own, which is a legitimate quieter design. */}
        {panelSrc && (
          <img
            className="tgs-halfover__panelpic"
            src={panelSrc}
            alt={str(slide, 'panelAlt')}
            loading="lazy"
            decoding="async"
          />
        )}
        {/*
          The wash is its own element rather than a background on the panel,
          because it has to sit BETWEEN the picture and the words. aria-hidden
          because it is paint: it says nothing and must not be announced.
        */}
        <div
          className="tgs-halfover__tint"
          style={{ background: look.tint, opacity: look.tintOpacity / 100 }}
          aria-hidden="true"
        />
        <div className="tgs-halfover__body">
          {title && <Title className="tgs-halfover__title">{title}</Title>}
          {body && <p className="tgs-halfover__text">{body}</p>}
          {(primary || secondary) && (
            <div className="tgs-halfover__actions">
              {primary &&
                renderButton(
                  {
                    label: primary,
                    href: str(slide, 'primaryHref'),
                    variant: 'primary',
                    /*
                     * WHITE, NOT THE THEME'S PRIMARY, WHEN NOBODY HAS CHOSEN.
                     *
                     * The theme's button colour is picked to work on the site's
                     * own background, and this panel is never that: it is a wash
                     * of at least 40% of a colour the client chose for this block.
                     * The default navy came out as a dark button on a mid blue,
                     * which is legible and looks like a mistake. White on a strong
                     * colour is the treatment that works over ANY tint, and it is
                     * what the reference does in spirit — a bright button that
                     * separates from the panel rather than sinking into it.
                     *
                     * The label is a fixed dark rather than a theme token, because
                     * --tgs-text goes light in dark mode and would vanish here.
                     */
                    colour: look.buttonColour || '#ffffff',
                    textColour: look.buttonColour ? undefined : '#111418',
                  },
                  0,
                )}
              {secondary &&
                renderButton(
                  {
                    label: secondary,
                    href: str(slide, 'secondaryHref'),
                    variant: 'secondary',
                    outline: true,
                    /*
                     * The same colour as the filled one, outlined, which is what
                     * the help text promises. White when no colour is chosen,
                     * because this always sits on a wash of at least 40% and a
                     * theme-coloured hairline can disappear into it.
                     */
                    colour: look.buttonColour || '#ffffff',
                  },
                  1,
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function HalfOverlayBlock({ props }: { props: Props }): ReactElement {
  /*
   * A SLIDE WITH NOTHING IN IT IS NOT A SLIDE. An empty row left in the repeater
   * would otherwise become a blank panel the visitor waits through, and would
   * count towards the cycle length. Judged on whether it has anything to say or
   * show rather than on one required field, so a picture-only slide is kept.
   */
  const items = list(props, 'items').filter(
    (slide) => str(slide, 'title') || str(slide, 'body') || str(slide, 'src') || str(slide, 'panelSrc'),
  );
  if (items.length === 0) {
    return <div className="tgs-placeholder">Add a slide</div>;
  }

  const look = {
    tint: safeColour(props.tint) ?? '#2f5bd8',
    // Floored at 40: below that the white words stop being readable over a
    // photograph, and the field will not go there either.
    tintOpacity: clamp(props.tintOpacity, 40, 100, 78),
    buttonColour: safeColour(props.buttonColour) ?? undefined,
    solo: items.length === 1,
  };
  const height = oneOf(props, 'height', ['short', 'medium', 'tall'] as const, 'medium');

  if (look.solo) {
    return (
      <div className="tgs-halfover-wrap" data-height={height}>
        {halfOverlaySlide(items[0], look)}
      </div>
    );
  }

  const transition = oneOf(props, 'transition', ['fade', 'slide'] as const, 'fade');
  const interval = clamp(props.interval, 2, 15, 6);
  const count = items.length;
  const showArrows = bool(props, 'arrows', true);
  const showDots = bool(props, 'dots', true);

  return (
    <div className="tgs-halfover-wrap" data-height={height}>
      <div
        className="tgs-slideshow"
        data-transition={transition}
        data-count={count}
        data-interval={interval}
        data-dots={showDots ? 'true' : undefined}
        data-arrows={showArrows ? 'true' : undefined}
        style={{ '--tgs-ss-cycle': `${count * interval}s` } as CSSProperties}
        aria-roledescription="carousel"
        aria-label="Featured trips"
      >
        <div className="tgs-slideshow__viewport tgs-halfover__viewport">
          {items.map((slide, index) => (
            <div
              className="tgs-slideshow__slide"
              key={index}
              style={{ animationDelay: `calc(${index} * var(--tgs-ss-cycle) / ${count})` }}
            >
              {halfOverlaySlide(slide, look)}
            </div>
          ))}
        </div>

        {showDots && (
          <div className="tgs-slideshow__dots" aria-hidden="true">
            {items.map((_, index) => (
              <span
                className="tgs-slideshow__dot"
                key={index}
                style={{ animationDelay: `calc(${index} * var(--tgs-ss-cycle) / ${count})` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * CARDS THAT OPEN WHEN YOU CLICK THEM, WITH NO JAVASCRIPT.
 *
 * Andy, 20 Aug 2026, from Duda's Expanding Cards. A row of narrow panels with
 * one open; clicking a closed one opens it and closes the other. That is RADIO
 * BUTTON BEHAVIOUR exactly — one of a set, and never none — so it is built from
 * radios, the same way Tabs is. What that buys, beyond shipping no script:
 *
 *   - the arrow keys move between the cards without anybody writing a handler
 *   - each card is a real form control, so a screen reader says what it is and
 *     which one is chosen
 *   - the browser remembers the choice through a back button
 *
 * THE MARKUP ORDER IS LOAD BEARING, exactly as it is in Tabs: the radios come
 * first and are SIBLINGS of the rail, because `:checked ~` only looks forward.
 * And the position is written down as `data-index` rather than inferred with
 * `:nth-of-type`, which counts by element type and pairs the wrong card with the
 * wrong radio the moment the markup gains another kind of child.
 */
export const MAX_EXPANDING_CARDS = 6;

/** Each card holds the screen on its own as it sticks, so ten is a very long
 *  section to scroll. The motion catalogue's own examples are three to five. */
export const MAX_STACKED_CARDS = 6;

/** Three places in the collage, so three pictures. A fourth would have
 *  nowhere to stand, and a fourth place makes it a mess rather than a
 *  composition. */
export const MAX_SHIFTING_IMAGES = 3;

export function ExpandingCardsBlock({
  props,
  blockId,
}: {
  props: Props;
  blockId: string;
}): ReactElement {
  const items = list(props, 'items')
    .filter((item) => str(item, 'title') || str(item, 'src'))
    .slice(0, MAX_EXPANDING_CARDS);

  if (items.length === 0) {
    return <div className="tgs-placeholder">Add some cards</div>;
  }

  const height = oneOf(props, 'height', ['short', 'medium', 'tall'] as const, 'medium');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const scrim = safeColour(props.scrim) ?? '#0d1420';
  // Floored at 25: below that a pale photograph takes the white words with it.
  const strength = clamp(props.scrimStrength, 25, 90, 55);
  const buttonColour = safeColour(props.buttonColour) ?? undefined;

  const name = `tgs-expand-${blockId}`;

  return (
    <div className="tgs-expand" data-height={height} data-radius={radius}>
      {items.map((_, index) => (
        <input
          key={`r${index}`}
          className="tgs-expand__radio tgs-sr-only"
          type="radio"
          name={name}
          id={`${name}-${index}`}
          data-index={index}
          /*
           * defaultChecked, not checked. Which card is open is the browser's
           * business, and a controlled value would mean the editor canvas
           * snapping back to the first card on every keystroke.
           */
          defaultChecked={index === 0}
        />
      ))}

      <div className="tgs-expand__rail">
        {items.map((item, index) => {
          const src = safeUrl(str(item, 'src'));
          const title = str(item, 'title');
          const body = str(item, 'body');
          const linkLabel = str(item, 'linkLabel');

          return (
            <div className="tgs-expand__card" key={`c${index}`} data-index={index}>
              {src ? (
                <img
                  className="tgs-expand__pic"
                  src={src}
                  alt={str(item, 'alt')}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="tgs-expand__pic tgs-expand__pic--none" aria-hidden="true" />
              )}

              {/* Paint, between the picture and the words. */}
              <span
                className="tgs-expand__scrim"
                style={{ background: scrim, opacity: strength / 100 }}
                aria-hidden="true"
              />

              {/*
                THE WHOLE CLOSED CARD IS THE CONTROL, so the label covers it
                rather than being a small target somewhere on it. It carries the
                title, which is what a closed card shows. Once the card is open
                the stylesheet takes the label's pointer events away, or it would
                sit over the button and swallow the click.
              */}
              <label className="tgs-expand__hit" htmlFor={`${name}-${index}`}>
                <span className="tgs-expand__spine">{title}</span>
              </label>

              <div className="tgs-expand__body">
                {title && <p className="tgs-expand__title">{title}</p>}
                {body && <p className="tgs-expand__text">{body}</p>}
                {linkLabel &&
                  renderButton(
                    {
                      label: linkLabel,
                      href: str(item, 'linkHref'),
                      variant: 'primary',
                      colour: buttonColour,
                    },
                    index,
                  )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * PICTURES PLAYING ON A SCREEN.
 *
 * Andy, 20 Aug 2026, from Duda's Screen Carousel.
 *
 * THE DEVICE IS DRAWN IN CSS. A photograph of a laptop would be one size, one
 * colour and a file to ship; a few rounded boxes stay sharp at any size, follow
 * the client's own light or dark choice, and put nobody else's hardware on a
 * client's homepage. Every part of it is aria-hidden, because a bezel and a
 * camera dot are scenery: what a screen reader should find here is the pictures.
 *
 * IT BORROWS THE SLIDESHOW WHOLE, the same `.tgs-slideshow` wrapper the Image
 * block and Half overlay emit, so it cycles in pure CSS and public/slideshow.js
 * gives it arrows, dots and a pause button with nothing added to that file.
 */
function screenPictures(items: Props[]): Array<{ src: string; alt: string }> {
  return items
    .map((item) => ({ src: safeUrl(str(item, 'src')) || '', alt: str(item, 'alt') }))
    .filter((picture) => picture.src !== '');
}

export function ScreenCarouselBlock({ props }: { props: Props }): ReactElement {
  const pictures = screenPictures(list(props, 'items'));
  const device = oneOf(props, 'device', ['laptop', 'phone'] as const, 'laptop');
  const frame = oneOf(props, 'frame', ['light', 'dark'] as const, 'light');

  /*
   * THE EMPTY STATE IS STILL THE DEVICE, not a grey box saying "choose an
   * image". A client who has just dropped this in wants to see the thing they
   * chose; an empty screen inside a real frame shows them exactly what they are
   * about to fill, and the editor's own field tells them how.
   */
  const shell = (inner: ReactElement | null) => (
    <div className="tgs-screen" data-device={device} data-frame={frame}>
      <div className="tgs-screen__device">
        <div className="tgs-screen__bezel">
          <span className="tgs-screen__cam" aria-hidden="true" />
          <div className="tgs-screen__glass">{inner}</div>
        </div>
        {/* A laptop stands on something. A phone does not: the stylesheet hides
            this for the phone rather than the markup branching for it. */}
        <span className="tgs-screen__base" aria-hidden="true" />
      </div>
    </div>
  );

  if (pictures.length === 0) {
    return shell(<span className="tgs-screen__empty">Choose your pictures</span>);
  }

  // One picture is not a carousel, so it gets no wrapper, no dots and no cycle.
  if (pictures.length === 1) {
    return shell(
      <img
        className="tgs-screen__shot"
        src={pictures[0].src}
        alt={pictures[0].alt}
        loading="lazy"
        decoding="async"
      />,
    );
  }

  const transition = oneOf(props, 'transition', ['fade', 'slide'] as const, 'fade');
  const interval = clamp(props.interval, 2, 15, 5);
  const count = pictures.length;
  const showArrows = bool(props, 'arrows', true);
  const showDots = bool(props, 'dots', true);

  return shell(
    <div
      className="tgs-slideshow"
      data-transition={transition}
      data-count={count}
      data-interval={interval}
      data-dots={showDots ? 'true' : undefined}
      data-arrows={showArrows ? 'true' : undefined}
      style={{ '--tgs-ss-cycle': `${count * interval}s` } as CSSProperties}
      aria-roledescription="carousel"
      aria-label="Pictures"
    >
      <div className="tgs-slideshow__viewport tgs-screen__viewport">
        {pictures.map((picture, index) => (
          <div
            className="tgs-slideshow__slide"
            key={index}
            style={{ animationDelay: `calc(${index} * var(--tgs-ss-cycle) / ${count})` }}
          >
            <img
              src={picture.src}
              alt={picture.alt}
              loading={index === 0 ? 'eager' : 'lazy'}
              decoding="async"
            />
          </div>
        ))}
      </div>

      {showDots && (
        <div className="tgs-slideshow__dots" aria-hidden="true">
          {pictures.map((_, index) => (
            <span
              className="tgs-slideshow__dot"
              key={index}
              style={{ animationDelay: `calc(${index} * var(--tgs-ss-cycle) / ${count})` }}
            />
          ))}
        </div>
      )}
    </div>,
  );
}

/**
 * CARDS WITH A BACK, THAT TURN OVER.
 *
 * Andy, 21 Aug 2026, from Duda's Flipping Boxes.
 *
 * BOTH A HOVER AND A CLICK, and that is the part worth defending. The usual
 * build of this is hover only, which means it does not exist on any phone and
 * cannot be reached from a keyboard — between them, most of the people a travel
 * site is for. So the state is a checkbox a tap or the Enter key toggles, and
 * the stylesheet ALSO turns the card on :hover for the mouse. Neither knows
 * about the other; they just both set the same transform.
 *
 * THE BACK IS NOT TABBABLE WHILE IT IS HIDDEN. Its button is behind the front
 * face, so a keyboard reaching it would be focusing something nobody can see.
 * The stylesheet hides it with `visibility` rather than with the 3D transform
 * alone, and reveals it for both the flipped and the hovered card, so the mouse
 * can click the button it can see and the keyboard cannot reach the one it
 * cannot.
 */
export function FlipCardsBlock({
  props,
  blockId,
}: {
  props: Props;
  blockId: string;
}): ReactElement {
  const items = list(props, 'items').filter(
    (item) => str(item, 'title') || str(item, 'src') || str(item, 'body'),
  );
  if (items.length === 0) {
    return <div className="tgs-placeholder">Add some boxes</div>;
  }

  const columns = oneOf(props, 'columns', ['2', '3', '4'] as const, '3');
  const gap = oneOf(props, 'gap', ['none', 'xs', 's', 'm', 'l', 'xl'] as const, 'm');
  const height = oneOf(props, 'height', ['short', 'medium', 'tall'] as const, 'medium');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const frontTone = safeColour(props.frontTone) ?? '#12233d';
  const backTone = safeColour(props.backTone) ?? '#0f766e';

  const name = `tgs-flip-${blockId}`;

  return (
    <div className="tgs-flips" data-columns={columns} data-gap={gap} data-height={height}>
      {items.map((item, index) => {
        const src = safeUrl(str(item, 'src'));
        const title = str(item, 'title');
        const body = str(item, 'body');
        const linkLabel = str(item, 'linkLabel');

        return (
          <div className="tgs-flip" key={index} data-radius={radius}>
            <input
              className="tgs-flip__cb tgs-sr-only"
              type="checkbox"
              id={`${name}-${index}`}
              /* Uncontrolled, so the editor canvas does not slam every card
                 back over on each keystroke. */
            />

            <div className="tgs-flip__inner">
              <div className="tgs-flip__face tgs-flip__front">
                {src ? (
                  <img src={src} alt={str(item, 'alt')} loading="lazy" decoding="async" />
                ) : (
                  <span className="tgs-flip__nopic" aria-hidden="true" />
                )}
                <span
                  className="tgs-flip__wash"
                  style={{ background: frontTone }}
                  aria-hidden="true"
                />
                {/*
                  THE WHOLE FRONT IS THE CONTROL, so the label covers it. A small
                  "flip" button in a corner is a control most people never find.
                  The label carries the title, which is what the front shows.
                */}
                <label className="tgs-flip__hit" htmlFor={`${name}-${index}`}>
                  {title && <span className="tgs-flip__title">{title}</span>}
                  <span className="tgs-sr-only">Turn this over to read more</span>
                </label>
              </div>

              <div className="tgs-flip__face tgs-flip__back" style={{ background: backTone }}>
                <div className="tgs-flip__backinner">
                  {title && <p className="tgs-flip__backtitle">{title}</p>}
                  {body && <p className="tgs-flip__text">{body}</p>}
                  {linkLabel &&
                    renderButton(
                      {
                        label: linkLabel,
                        href: str(item, 'linkHref'),
                        variant: 'secondary',
                        outline: true,
                        colour: '#ffffff',
                      },
                      index,
                    )}
                </div>
                {/* Turning it back is the same control, sitting behind the
                    content so the button on top of it still takes its click. */}
                <label
                  className="tgs-flip__hit tgs-flip__hit--back"
                  htmlFor={`${name}-${index}`}
                  aria-label="Turn this back over"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * CARDS THAT GATHER INTO A DECK AS YOU SCROLL.
 *
 * Andy, 21 Aug 2026, from Duda's Stacked Cards, and it is recipe S3 from the
 * motion catalogue (sticky-stack, tier 0, proven). Its stated purpose there is
 * COMPARISON — three ships, four room grades, five tour styles — and its note is
 * that it "replaces the three-equal-cards row, which is the single most common
 * AI tell". So this is what to reach for when somebody asks for three cards in a
 * row.
 *
 * NO JAVASCRIPT, AND NO SCROLL-JACKING. `position: sticky` with an offset that
 * grows by card, so each one comes to rest a little below the last and the ones
 * behind stay just visible as a stack. The scrollbar stays real and the browser
 * stays in charge, which is the catalogue's rule for every pinned recipe.
 *
 * THE INDEX IS THE ONLY THING THE STYLESHEET NEEDS, and it comes down as a
 * custom property rather than as six written-out rules. Unlike Tabs and
 * Expanding cards nothing here has to PAIR one element with another: a card only
 * needs to know how far down the pile it is.
 */
export function StackedCardsBlock({ props }: { props: Props }): ReactElement {
  const items = list(props, 'items')
    .filter((item) => str(item, 'title') || str(item, 'body') || str(item, 'src'))
    .slice(0, MAX_STACKED_CARDS);

  if (items.length === 0) {
    return <div className="tgs-placeholder">Add some cards</div>;
  }

  const side = oneOf(props, 'side', ['right', 'left', 'alternate'] as const, 'right');
  const height = oneOf(props, 'height', ['short', 'medium', 'tall'] as const, 'medium');
  const radius = oneOf(props, 'radius', RADII, 'lg');
  const cardColour = safeColour(props.cardColour) ?? '#ffffff';
  const buttonColour = safeColour(props.buttonColour) ?? undefined;

  return (
    <div className="tgs-stack" data-height={height} data-radius={radius}>
      {items.map((item, index) => {
        const src = safeUrl(str(item, 'src'));
        const title = str(item, 'title');
        const body = str(item, 'body');
        const linkLabel = str(item, 'linkLabel');
        // Alternating reads better down a long stack than six cards the same way
        // round, and it is the one case where the side is not a single setting.
        const picture = side === 'alternate' ? (index % 2 === 0 ? 'right' : 'left') : side;

        return (
          <article
            className="tgs-stack__card"
            key={index}
            data-side={picture}
            style={{ '--tgs-stack-i': index, background: cardColour } as CSSProperties}
          >
            <div className="tgs-stack__body">
              {title && <p className="tgs-stack__title">{title}</p>}
              {body && <p className="tgs-stack__text">{body}</p>}
              {linkLabel &&
                renderButton(
                  {
                    label: linkLabel,
                    href: str(item, 'linkHref'),
                    variant: 'primary',
                    colour: buttonColour,
                  },
                  index,
                )}
            </div>

            <div className="tgs-stack__pic">
              {src ? (
                <img src={src} alt={str(item, 'alt')} loading="lazy" decoding="async" />
              ) : (
                <span className="tgs-stack__nopic" aria-hidden="true" />
              )}
            </div>
          </article>
        );
      })}

      {/*
        THE RUNWAY. Empty on purpose: it is scroll length, so the last card has
        somewhere to travel and lands on the deck instead of stopping wherever
        the page happens to end. See the stylesheet for the two wrong ways to do
        this that were tried first.
      */}
      <div className="tgs-stack__runway" aria-hidden="true" />
    </div>
  );
}

/**
 * THREE PICTURES THAT TRADE PLACES.
 *
 * Andy, 21 Aug 2026, from Duda's Image Shifting. They sit as an overlapping
 * collage and every few seconds each moves on to the next place, so the one at
 * the front goes to the back and the next comes forward.
 *
 * THE PLACES CARRY THE SIZES, NOT THE PICTURES. A picture is big because of
 * where it is standing, not because of what it is, which is what makes the
 * rotation read as movement rather than as three pictures resizing on the spot.
 * So the stylesheet owns three sets of position and scale, and each picture
 * walks through them offset by its share of the cycle — the same device the
 * slideshow uses for its stagger.
 *
 * NOT A SLIDESHOW, and it deliberately borrows none of that machinery. Every
 * picture is on screen the whole time, so there is nothing to show and hide, no
 * current slide, and no pause button to argue about: a visitor is never waiting
 * to see something.
 */
export function ShiftingImagesBlock({
  props,
  editing = false,
}: {
  props: Props;
  /* The canvas re-renders on every keystroke, and pictures sliding under the
     pointer fight the person trying to select one. Still and arranged there. */
  editing?: boolean;
}): ReactElement {
  const pictures = list(props, 'items')
    .map((item) => ({ src: safeUrl(str(item, 'src')) || '', alt: str(item, 'alt') }))
    .filter((picture) => picture.src !== '')
    .slice(0, MAX_SHIFTING_IMAGES);

  if (pictures.length === 0) {
    return <div className="tgs-placeholder">Choose three pictures</div>;
  }

  const height = oneOf(props, 'height', ['short', 'medium', 'tall'] as const, 'medium');
  const radius = oneOf(props, 'radius', RADII, 'lg');
  const interval = clamp(props.interval, 2, 12, 4);
  const count = pictures.length;

  return (
    <div
      className="tgs-shift"
      data-height={height}
      data-radius={radius}
      data-count={count}
      data-still={editing || count < 2 ? 'true' : undefined}
      style={{ '--tgs-shift-cycle': `${count * interval}s` } as CSSProperties}
    >
      {pictures.map((picture, index) => (
        <img
          className="tgs-shift__pic"
          key={index}
          src={picture.src}
          alt={picture.alt}
          loading={index === 0 ? 'eager' : 'lazy'}
          decoding="async"
          /*
           * Where this picture starts in the rotation, and how far into the
           * cycle it is. One picture per place, so a negative delay drops each
           * one straight into its own position rather than making the first two
           * wait a turn before the collage looks right.
           */
          style={{
            '--tgs-shift-i': index,
            animationDelay: `calc(-1 * ${index} * var(--tgs-shift-cycle) / ${count})`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

/**
 * A STAR RATING ON ITS OWN.
 *
 * Andy, 21 Aug 2026, and he was explicit that it is standalone rather than
 * attached to a card. The Testimonial slider has had stars inside it since June;
 * this is the one a client drops beside a headline to say "4.8 on Trustpilot".
 *
 * HALF STARS, WHICH THE TESTIMONIAL ONE DOES NOT HAVE. Real ratings are 4.5 and
 * 4.7, and a standalone rating that could only say 4 or 5 would be a control a
 * client has to lie to. A half is drawn by clipping one star's fill to 50% width
 * rather than by a second half-star path, so it works at any size and in any
 * colour.
 *
 * IT IS INFORMATION, NOT DECORATION. `role="img"` with the value in words, so a
 * screen reader hears "4.5 out of 5" rather than five identical star shapes,
 * whether or not the client chose to show the number.
 */
export function RatingBlock({ props }: { props: Props }): ReactElement {
  /*
   * CLAMPED AND SNAPPED TO HALVES HERE, AND NOT THROUGH `clamp`.
   *
   * The shared `clamp` helper rounds to a whole number, which is right for every
   * other caller — sizes, counts, seconds, percentages — and fatal for this one:
   * it turned 4.5 into 5, so the element built specifically to allow halves
   * could not draw one. Caught in a browser, and it would have shipped looking
   * like an element that simply ignored the field.
   *
   * The clamping still has to happen: `min` and `max` on a number input are
   * advisory, so a stored 7 would otherwise draw seven stars.
   */
  const asNumber = Number(props.rating);
  const bounded = Number.isFinite(asNumber) ? Math.min(5, Math.max(0, asNumber)) : 0;
  const rating = Math.round(bounded * 2) / 2;

  const size = oneOf(props, 'size', ['s', 'm', 'l'] as const, 'm');
  const align = oneOf(props, 'align', ALIGNS, 'left');
  const colour = safeColour(props.colour);
  const count = str(props, 'count');
  const showValue = bool(props, 'showValue', true);

  /* "4.5 out of 5" reads as a rating; "4.5 out of 5 from 312 reviews" reads as
     one somebody can weigh. The words are the same ones a sighted visitor sees. */
  const spoken = count ? `${rating} out of 5, ${count}` : `${rating} out of 5`;

  return (
    <div
      className="tgs-rating"
      data-size={size}
      data-align={align}
      style={colour ? ({ '--tgs-star': colour } as CSSProperties) : undefined}
    >
      <span className="tgs-rating__stars" role="img" aria-label={spoken}>
        {[1, 2, 3, 4, 5].map((n) => {
          // Whole, half, or empty. The half is the one worth having.
          const fill = rating >= n ? 'full' : rating >= n - 0.5 ? 'half' : 'none';
          return (
            <span className="tgs-rating__star" key={n} data-fill={fill} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="1em" height="1em">
                <path d="M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.1l5.8-.8z" />
              </svg>
            </span>
          );
        })}
      </span>

      {/* Marked aria-hidden because the stars already carry the whole sentence:
          without this a screen reader says the value twice. */}
      {showValue && (
        <span className="tgs-rating__value" aria-hidden="true">
          {rating}
        </span>
      )}
      {count && (
        <span className="tgs-rating__count" aria-hidden="true">
          {count}
        </span>
      )}
    </div>
  );
}

/**
 * A WORD WITH A NOTE BEHIND IT.
 *
 * Andy, 21 Aug 2026, from Duda's Tooltip.
 *
 * A BUTTON, NOT A SPAN WITH A HOVER, and that is the whole design. A tooltip
 * shown only on hover does not exist on a phone and cannot be reached from a
 * keyboard, which between them is most of the people a travel site is for. A
 * real button is focusable, so the same CSS that shows the note on hover shows
 * it on focus, and a tap focuses — one rule, three input methods, no script.
 *
 * `aria-describedby` ties the note to the button, so a screen reader reads it as
 * the button's description whether or not it is visible. That is the part a
 * purely visual tooltip always misses.
 *
 * `type="button"` because this sits inside a form on plenty of pages and the
 * default is submit, which would post an enquiry every time somebody asked what
 * ATOL means.
 */
export function TooltipBlock({
  props,
  blockId,
}: {
  props: Props;
  blockId: string;
}): ReactElement {
  const text = str(props, 'text');
  const tip = str(props, 'tip');
  const position = oneOf(props, 'position', ['above', 'below'] as const, 'above');
  const align = oneOf(props, 'align', ALIGNS, 'left');

  if (!text) {
    return <div className="tgs-placeholder">Add the words for the tooltip</div>;
  }

  const tipId = `tgs-tip-${blockId}`;

  return (
    <div className="tgs-tip" data-align={align} data-position={position}>
      <button
        className="tgs-tip__word"
        type="button"
        aria-describedby={tip ? tipId : undefined}
      >
        {text}
      </button>
      {tip && (
        <span className="tgs-tip__note" id={tipId} role="tooltip">
          {tip}
        </span>
      )}
    </div>
  );
}

/**
 * A ROW OF TAGS.
 *
 * Andy, 21 Aug 2026, from Duda's Bullet Delimited Tags — and almost certainly
 * its Coloured Delimited one too, which is the same list wearing pills instead
 * of bullets. One element, two styles, rather than two that differ by a
 * border-radius.
 *
 * A LIST, NOT A PARAGRAPH WITH DOTS IN IT. The bullets are drawn by CSS between
 * the items, so a screen reader hears four tags rather than one sentence full of
 * punctuation, and a tag can be a link without the separator becoming part of
 * the link text.
 */
export function TagsBlock({ props }: { props: Props }): ReactElement {
  const items = list(props, 'items').filter((item) => str(item, 'label'));
  if (items.length === 0) {
    return <div className="tgs-placeholder">Add some tags</div>;
  }

  const style = oneOf(props, 'style', ['bullets', 'pills'] as const, 'bullets');
  const size = oneOf(props, 'size', ['s', 'm'] as const, 'm');
  const align = oneOf(props, 'align', ALIGNS, 'left');
  const colour = safeColour(props.colour);

  return (
    <ul
      className="tgs-tags"
      data-style={style}
      data-size={size}
      data-align={align}
      style={colour ? ({ '--tgs-tag': colour } as CSSProperties) : undefined}
    >
      {items.map((item, index) => {
        const label = str(item, 'label');
        const href = safeUrl(str(item, 'href'), CONTACT_OK);
        return (
          <li className="tgs-tags__item" key={index}>
            {href ? (
              <a className="tgs-tags__link" href={href}>
                {label}
              </a>
            ) : (
              <span className="tgs-tags__label">{label}</span>
            )}
          </li>
        );
      })}
    </ul>
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
 * SEARCH, WITH NO JAVASCRIPT.
 *
 * A plain GET form pointed at /search. The browser navigates on submit, the
 * server builds the results, and there is no bundle behind any of it, the same
 * principle the menu keeps. On a client's own hostname middleware carries the
 * ?q= through to the site route, where /search is a real address answered by
 * the search branch. See middleware.ts and the site route.
 *
 * TWO SHAPES. A box, for the headers that show a search field, and just the
 * magnifier, for the ones that show only an icon. The icon is a LINK to the
 * search page rather than a submit with an empty query behind it, so it needs
 * no script and always has somewhere to go: the page it lands on carries the
 * box.
 *
 * ON THE CANVAS it is a div, not a form, and the field is read only, so typing a
 * query into a preview cannot navigate the editor away. Same `editing` flag the
 * map and the logos read.
 */
export function SearchBlock({
  props,
  editing = false,
}: {
  props: Props;
  editing?: boolean;
}): ReactElement {
  const placeholder = str(props, 'placeholder') || 'Search';
  const display = oneOf(props, 'display', ['box', 'icon'] as const, 'box');
  // Alignment rides on the block wrapper's data-align (see PageRenderer), which
  // sets text-align on the parent; an inline-flex search follows it, so there is
  // nothing to set here. Same as every other inline block.

  // The magnifier and the box tint, so the icon shows on a dark bar where the
  // inherited text would be dark. The glass strokes currentColor, so setting the
  // container's colour is enough for the icon; the box keeps its own fill.
  const colour = safeColour(props.colour);
  const tint = colour ? ({ color: colour } as CSSProperties) : undefined;

  const glass = (
    <svg
      className="tgs-search__glass"
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
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );

  if (display === 'icon') {
    return (
      <div className="tgs-search" data-display="icon" style={tint}>
        <a className="tgs-search__link" href="/search" aria-label={placeholder}>
          {glass}
        </a>
      </div>
    );
  }

  const field = (
    <>
      <input
        className="tgs-search__input"
        type="search"
        name="q"
        placeholder={placeholder}
        aria-label={placeholder}
        {...(editing ? { readOnly: true, tabIndex: -1 } : {})}
      />
      <button
        className="tgs-search__submit"
        type="submit"
        aria-label="Search"
        {...(editing ? { tabIndex: -1 } : {})}
      >
        {glass}
      </button>
    </>
  );

  if (editing) {
    return (
      <div className="tgs-search" data-display="box" style={tint}>
        {field}
      </div>
    );
  }

  return (
    <form
      className="tgs-search"
      data-display="box"
      role="search"
      method="get"
      action="/search"
      style={tint}
    >
      {field}
    </form>
  );
}

/**
 * The Light / dark switch.
 *
 * A plain button, and nothing more until the page loads. The published page
 * wires it with /theme-toggle.js (see ThemeToggleScript), which flips
 * `data-theme` on the document and remembers the choice; the CSS in globals.css
 * does the rest, and the automatic half runs with no script at all. On the
 * editor canvas there is no script, so the button is inert and shows the light
 * look, which is exactly right for a preview: pressing it there must not restyle
 * the canvas the agent is building on.
 *
 * `type="button"`, so a switch dropped next to a search box never submits the
 * form around it. The label carries the meaning; the sun and the moon are
 * decorative and hidden from a screen reader, and which one shows is decided by
 * the current theme in CSS, not here, so this render is the same in both modes.
 */
export function ThemeToggleBlock({
  props,
  editing = false,
}: {
  props: Props;
  editing?: boolean;
}): ReactElement {
  const display = oneOf(props, 'display', ['switch', 'icon'] as const, 'switch');
  const colour = safeColour(props.colour);
  const style = colour ? ({ color: colour } as CSSProperties) : undefined;

  const sun = (
    <svg
      className="tgs-toggle__sun"
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
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" />
    </svg>
  );
  const moon = (
    <svg
      className="tgs-toggle__moon"
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
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );

  const common = {
    className: 'tgs-toggle',
    type: 'button' as const,
    'data-display': display,
    // The hook the script binds to. Left off on the canvas so a stray click while
    // editing does nothing.
    ...(editing ? { tabIndex: -1 } : { 'data-tg-theme-toggle': 'true' }),
    'aria-label': 'Switch between light and dark',
    style,
  };

  if (display === 'icon') {
    return (
      <button {...common}>
        {moon}
        {sun}
      </button>
    );
  }

  return (
    <button {...common}>
      <span className="tgs-toggle__track" aria-hidden="true">
        {sun}
        {moon}
      </span>
      <span className="tgs-toggle__knob" aria-hidden="true" />
    </button>
  );
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

      const href = safeUrl(str(item, 'href'), CONTACT_OK) || '#';
      const newTab = bool(item, 'newTab');
      /*
       * The pages inside a folder, injected by fillNavFolders (lib/content/nav.ts)
       * before this ever renders. A plain link has none; a link that points at a
       * folder carries the pages filed inside it, and becomes a dropdown.
       */
      const children = list(item, 'children');

      /*
       * The optional icon beside the word, for the icon-led menus in the header
       * kit. Same guard as the icon block (isIconName, not truthiness): a name
       * draws its glyph, anything else is left off entirely rather than rendered
       * as a broken box. A menu is words first, so an unknown icon is silence,
       * not an empty square.
       */
      const icon = str(item, 'icon');
      const drawable = isIconName(icon);

      const link = (
        <a
          className="tgs-nav__link"
          href={href}
          {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {drawable && <ContentIcon name={icon} className="tgs-nav__icon" />}
          {label}
          {children.length > 0 && (
            <svg
              className="tgs-nav__chev"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          )}
        </a>
      );

      if (children.length === 0) {
        return (
          <li key={`${keyPrefix}${index}`} className="tgs-nav__item">
            {link}
          </li>
        );
      }

      /*
       * A folder. The parent stays a real link to the folder page; the pages
       * inside it are a nested list the browser reveals on hover and on keyboard
       * focus, through CSS alone. No JavaScript, same as the phone menu: a
       * dropdown is the last place to start shipping a bundle, and :focus-within
       * makes it reachable by keyboard without one. The submenu recurses, so a
       * page inside a folder that itself holds pages opens a flyout of its own.
       */
      return (
        <li key={`${keyPrefix}${index}`} className="tgs-nav__item tgs-nav__item--folder">
          {link}
          {navSubmenu(children, `${keyPrefix}${index}s`)}
        </li>
      );
    })
    .filter((item): item is ReactElement => item !== null);
}

/**
 * The pages inside a folder, as a nested list, and the pages inside those.
 *
 * Recursive, which is the whole multi-tier change: a submenu item that carries
 * its own children is a folder in its own right, so it gets a chevron and a
 * flyout of the pages beneath it. Every level is a plain nested `ul`/`li` of
 * links, revealed by CSS on hover and focus, so no depth needs new markup and
 * nothing here has to know how deep it has gone.
 */
function navSubmenu(children: Props[], keyPrefix: string): ReactElement {
  return (
    <ul className="tgs-nav__submenu">
      {children
        .map((child, index) => {
          const label = str(child, 'label');
          if (!label) return null;
          const href = safeUrl(str(child, 'href'), CONTACT_OK) || '#';
          const grandchildren = list(child, 'children');
          return (
            <li
              key={`${keyPrefix}${index}`}
              className={
                grandchildren.length > 0 ? 'tgs-nav__subitem tgs-nav__subitem--folder' : 'tgs-nav__subitem'
              }
            >
              <a className="tgs-nav__sublink" href={href}>
                {label}
                {grandchildren.length > 0 && (
                  <svg
                    className="tgs-nav__subchev"
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                )}
              </a>
              {grandchildren.length > 0 && navSubmenu(grandchildren, `${keyPrefix}${index}s`)}
            </li>
          );
        })
        .filter((child): child is ReactElement => child !== null)}
    </ul>
  );
}

/*
 * The link type a Menu block may set, kept as the exact values the fields
 * offer, so what can reach font-family, font-size and font-weight cannot drift
 * from what is offered. Colour goes through safeColour like every other colour.
 */
const NAV_FONT_VALUES = new Set(FONT_CHOICES.map((choice) => choice.value));
const NAV_SIZE_VALUES = new Set(FONT_SIZES.map((size) => size.value));
const NAV_WEIGHTS = new Set(['400', '500', '600', '700']);

export function NavBlock({ props }: { props: Props }): ReactElement {
  const items = list(props, 'items');
  const layout = oneOf(props, 'layout', ['row', 'column'] as const, 'row');
  const align = oneOf(props, 'align', ALIGNS, 'left');
  const gap = oneOf(props, 'gap', ['none', 'xs', 's', 'm', 'l', 'xl'] as const, 'm');
  /*
   * WHEN THE LINKS GO BEHIND A BUTTON: never, on phones, or at every width.
   *
   * Read through burgerMode rather than inline, because the stored value has two
   * shapes: a menu saved before 20 Aug 2026 holds the old boolean. See
   * lib/content/burger.ts for why that is read rather than migrated.
   */
  const burger = burgerMode(props.collapse);
  // Small capitals for the formal and technical bars. A presentation choice, so
  // the labels stay their real words and CSS does the casing.
  const uppercase = bool(props, 'uppercase');

  // The links' own type, each following the header unless the block sets it.
  // Every value is checked against the whitelist the field offered, so only the
  // site's fonts, the theme's sizes and a safe weight or colour reach the page.
  const linkFont = NAV_FONT_VALUES.has(str(props, 'linkFont')) ? str(props, 'linkFont') : '';
  const linkSize = NAV_SIZE_VALUES.has(str(props, 'linkSize')) ? str(props, 'linkSize') : '';
  const linkWeight = NAV_WEIGHTS.has(str(props, 'linkWeight')) ? str(props, 'linkWeight') : '';
  const linkColour = safeColour(props.linkColour);
  const navStyle = {
    ...(linkFont ? { '--tgs-nav-font': linkFont } : {}),
    ...(linkSize ? { '--tgs-nav-size': linkSize } : {}),
    ...(linkWeight ? { '--tgs-nav-weight': linkWeight } : {}),
    ...(linkColour ? { '--tgs-nav-colour': linkColour } : {}),
  } as CSSProperties;
  const hasNavStyle = Object.keys(navStyle).length > 0;

  if (items.length === 0) {
    return <div className="tgs-placeholder">Add some links</div>;
  }

  return (
    <nav
      className="tgs-nav"
      data-layout={layout}
      data-align={align}
      data-gap={gap}
      data-uppercase={uppercase ? 'true' : undefined}
      /* The mode, so the stylesheet can tell an always-burger from a phone one
         without a second class per state. */
      data-burger={burger}
      style={hasNavStyle ? navStyle : undefined}
    >
      {showsRow(burger) && (
        <ul className="tgs-nav__list" data-collapse={burger === 'phone' ? 'true' : undefined}>
          {navLinks(items, 'wide')}
        </ul>
      )}

      {hasBurger(burger) && (
        <details className="tgs-nav__disclosure">
          {/*
            The label is on the summary rather than on an inner span, so a screen
            reader announces "Menu, disclosure triangle, collapsed" from the one
            element the browser already treats as the control.

            TWO ICONS, ONE SHOWN AT A TIME by `details[open]` in the stylesheet.
            The cross is not decoration: an always-on burger opens a panel over
            the page, and a panel with no visible way out is a trap. The browser
            gives Escape to a dialog, not to a `details`, so the control that
            opened it has to be the control that closes it, and it has to LOOK
            like one. Both are aria-hidden because the summary already carries
            the label and its own expanded state.
          */}
          <summary className="tgs-nav__burger" aria-label="Menu">
            <svg
              className="tgs-nav__burger-open"
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
            <svg
              className="tgs-nav__burger-close"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
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
export function LogosBlock({ props, editing = false }: { props: Props; editing?: boolean }): ReactElement {
  const height = oneOf(props, 'height', ['s', 'm', 'l'] as const, 'm');
  const gap = str(props, 'gap', 'l');
  const tone = oneOf(props, 'tone', ['colour', 'grey', 'grey-hover'] as const, 'colour');
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'centre');
  const scroll = bool(props, 'scroll', false);

  const items = list(props, 'items')
    .map((item) => ({
      src: safeUrl(str(item, 'src')) ?? '',
      alt: str(item, 'alt'),
      href: safeUrl(str(item, 'href'), CONTACT_OK) ?? '',
    }))
    .filter((item) => item.src !== '');

  if (items.length === 0) {
    return <div className="tgs-placeholder">Add your badges and partner logos</div>;
  }

  const renderItem = (
    item: { src: string; alt: string; href: string },
    index: number,
    hidden: boolean,
  ): ReactElement => {
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
      <li className="tgs-logos__item" key={index} aria-hidden={hidden || undefined}>
        {linked ? (
          <a href={item.href} rel={external ? 'noopener noreferrer' : undefined}>
            {logo}
          </a>
        ) : (
          logo
        )}
      </li>
    );
  };

  /*
   * SCROLLING (Andy, 14 Aug 2026, the fun list). The row glides along on its own
   * and pauses on hover, for more logos than fit. Only on the published page and
   * in preview, never while editing, so the editing canvas stays still like the
   * other motion effects. The strip is rendered TWICE inside one clipped track,
   * the second copy aria-hidden, and each item carries a trailing margin (not a
   * flex gap) so the two copies tile exactly: at translateX(-50%) the second copy
   * sits where the first did and the loop has no seam. Held still, and shown as a
   * plain wrapped strip, under prefers-reduced-motion (globals.css).
   */
  if (scroll && !editing && items.length >= 2) {
    return (
      <div className="tgs-logos-marquee">
        <ul className="tgs-logos tgs-logos--track" data-height={height} data-tone={tone}>
          {items.map((item, index) => renderItem(item, index, false))}
          {items.map((item, index) => renderItem(item, index + items.length, true))}
        </ul>
      </div>
    );
  }

  return (
    <ul className="tgs-logos" data-height={height} data-gap={gap} data-tone={tone} data-align={align}>
      {items.map((item, index) => renderItem(item, index, false))}
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
      const href = safeUrl(str(item, 'href'), { allowContact: true });
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

/**
 * Click to chat on WhatsApp.
 *
 * A PLAIN LINK. wa.me needs no script, so this works like everything else here.
 *
 * THE NUMBER IS THE WHOLE JOB. wa.me wants digits, the country code, and no
 * leading zero, and every form a client types breaks one of those. When it
 * cannot be made usable this draws its empty state rather than a link, because
 * a link that builds and reaches nobody is the worst of the three outcomes: the
 * page publishes, nothing looks wrong, and the visitor gets an error from
 * WhatsApp that the client never sees. See lib/content/whatsapp.ts.
 *
 * THE BUBBLE IS position: fixed AND NOTHING ELSE. No script, no scroll listener,
 * no delay before it appears. It is drawn last in its column and pinned to a
 * corner by the stylesheet.
 */
export function WhatsAppBlock({ props }: { props: Props }): ReactElement {
  const href = whatsappHref(str(props, 'phone'), str(props, 'message'));
  if (!href) {
    return (
      <div className="tgs-placeholder">
        Add a WhatsApp number, with its country code
      </div>
    );
  }

  const label = str(props, 'label').trim() || 'Chat on WhatsApp';
  const look = oneOf(props, 'look', ['button', 'floating'] as const, 'button');
  const corner = oneOf(props, 'corner', ['right', 'left'] as const, 'right');
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'left');

  /*
   * The mark, drawn rather than loaded, so there is no request for it and it
   * takes the button's own colour. aria-hidden because the button already says
   * WhatsApp in words beside it; a bubble has no words, so its accessible name
   * comes from aria-label on the link instead.
   */
  const mark = (
    <svg
      className="tgs-whatsapp__mark"
      viewBox="0 0 24 24"
      width="1.15em"
      height="1.15em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m5.8 14.16c-.25.69-1.45 1.32-2 1.36-.51.04-1 .22-3.4-.71-2.87-1.13-4.68-4.06-4.82-4.25-.14-.19-1.15-1.53-1.15-2.92s.73-2.07 1-2.36c.26-.29.57-.36.76-.36s.38 0 .55.01c.18.01.41-.07.64.49.25.6.83 2.07.9 2.22.08.15.13.32.02.51-.1.19-.16.31-.31.48-.15.17-.32.38-.46.51-.15.15-.31.31-.13.61.17.29.77 1.28 1.66 2.07 1.14 1.02 2.1 1.33 2.4 1.48.29.15.46.13.63-.08.17-.2.73-.85.92-1.14.19-.29.39-.24.65-.15.26.1 1.65.78 1.94.92.28.15.47.22.54.34.07.13.07.72-.18 1.41" />
    </svg>
  );

  if (look === 'floating') {
    return (
      <div className="tgs-whatsapp" data-look="floating" data-corner={corner}>
        {/*
          A bubble has no visible words, so the name has to come from somewhere.
          It names the ACTION rather than the network, because "WhatsApp" alone
          tells somebody what it is and not what pressing it does.
        */}
        <a className="tgs-whatsapp__bubble" href={href} aria-label={label} target="_blank" rel="noopener noreferrer">
          {mark}
        </a>
      </div>
    );
  }

  return (
    <div className="tgs-whatsapp" data-look="button" data-align={align}>
      <a className="tgs-whatsapp__button" href={href} target="_blank" rel="noopener noreferrer">
        {mark}
        {label}
      </a>
    </div>
  );
}

/**
 * A discount code.
 *
 * NO COPY BUTTON, AND THAT IS DELIBERATE. Copying to the clipboard needs a
 * script and a published page ships none. The code sits in a box with
 * `user-select: all`, so one click or tap selects the whole of it ready to copy
 * — which needs no JavaScript, works when there is none, and cannot fail
 * silently the way a clipboard call does when a browser refuses permission.
 *
 * IT STOPS SHOWING WHEN IT HAS RUN OUT. An offer that ended in March and is
 * still on the page in July is a customer ringing up to argue, and the client
 * will not notice because they never visit their own offers page. The date is
 * compared when the page is drawn, so it needs nobody to remember.
 *
 * ON THE CANVAS IT ALWAYS SHOWS. A client editing last season's coupon has to be
 * able to see the thing they are editing, so `editing` overrides the hiding and
 * the block says out loud that it has ended.
 */
export function CouponBlock({
  props,
  editing = false,
}: {
  props: Props;
  editing?: boolean;
}): ReactElement | null {
  const code = str(props, 'code').trim();
  const headline = str(props, 'headline').trim();
  if (!code && !headline) return <div className="tgs-placeholder">Add an offer and a code</div>;

  const expires = str(props, 'expires');
  const expired = couponExpired(expires, todayUtc(new Date()));
  const hideExpired = bool(props, 'hideExpired', true);

  // Gone from a live page, still drawn in the editor. See the note above.
  if (expired && hideExpired && !editing) return null;

  const body = str(props, 'body').trim();
  const terms = str(props, 'terms').trim();
  const ends = couponEndsLabel(expires);
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'left');
  const buttonLabel = str(props, 'buttonLabel').trim();
  const buttonHref = safeUrl(str(props, 'buttonHref'), CONTACT_OK);

  return (
    <div className="tgs-coupon" data-align={align} data-expired={expired ? 'true' : undefined}>
      {headline && <p className="tgs-coupon__headline">{headline}</p>}

      {code && (
        <p className="tgs-coupon__code">
          {/*
            The code is the one piece a visitor has to carry away, so it is its
            own element with its own selection behaviour rather than a run of
            bold text inside a sentence.
          */}
          <span className="tgs-coupon__value">{code}</span>
        </p>
      )}

      {body && <p className="tgs-coupon__body">{body}</p>}

      {buttonLabel && buttonHref && (
        <p className="tgs-coupon__action">
          <a className="tgs-button" data-variant="primary" data-size="m" href={buttonHref}>
            {buttonLabel}
          </a>
        </p>
      )}

      {ends && (
        <p className="tgs-coupon__ends">
          {/*
            In the editor an expired coupon says so, because otherwise a client
            looking at a page that is missing its coupon has no way to work out
            why. On a live page this line is just the end date.
          */}
          {editing && expired ? `${ends} — this has ended` : ends}
        </p>
      )}

      {terms && <p className="tgs-coupon__terms">{terms}</p>}
    </div>
  );
}

/**
 * Several branches, each with its address, phone and directions.
 *
 * NOT THE LOCATION BLOCK REPEATED. That one FRAMES a map, which is right for a
 * single address. Six frames means six third-party page loads before a visitor
 * has decided which branch they want, and six maps of six towns is not a picture
 * anybody reads. So each branch gets a directions LINK instead, which costs
 * nothing until it is clicked and opens the maps app on a phone.
 *
 * THE PHONE AND EMAIL ARE REAL LINKS. A tap rings the branch. That is what
 * "Click To Call" means, and it works because CONTACT_OK is passed here the same
 * as everywhere else in this file.
 *
 * ADDRESS IN AN <address> ELEMENT, which is what it is for: a contact address
 * for the nearest ancestor, which here is the branch card.
 */
export function LocationsBlock({ props }: { props: Props }): ReactElement {
  const items = list(props, 'items').filter(
    (item) => str(item, 'name').trim() || str(item, 'address').trim(),
  );
  if (items.length === 0) return <div className="tgs-placeholder">Add a branch</div>;

  const across = clamp(props.across, 1, 6, 2);
  const showDirections = bool(props, 'showDirections', true);

  return (
    <div className="tgs-locations" style={{ '--tgs-loc-across': String(across) } as CSSProperties}>
      {items.map((item, index) => {
        const name = str(item, 'name').trim();
        const address = str(item, 'address').trim();
        const phone = str(item, 'phone').trim();
        const email = str(item, 'email').trim();
        const hours = str(item, 'hours').trim();
        const directions = showDirections ? mapDirectionsUrl(address) : null;

        return (
          <div className="tgs-locations__card" key={index}>
            {name && <p className="tgs-locations__name">{name}</p>}

            {address && <address className="tgs-locations__address">{address}</address>}

            {hours && <p className="tgs-locations__hours">{hours}</p>}

            {/*
              Built from the digits rather than from what was typed, so "01204
              123 456" dials correctly. The visible text stays as the client
              wrote it, because that is the form somebody recognises.
            */}
            {phone && (
              <p className="tgs-locations__line">
                <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a>
              </p>
            )}

            {email && (
              <p className="tgs-locations__line">
                <a href={`mailto:${email}`}>{email}</a>
              </p>
            )}

            {directions && (
              <p className="tgs-locations__line">
                <a
                  className="tgs-locations__directions"
                  href={directions}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {/* Named for the branch, so a page of six does not give a
                      screen reader six links all called "Directions". */}
                  Directions
                  {name && <span className="tgs-sr-only"> to {name}</span>}
                </a>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One icon on its own.
 *
 * A PICTURE, NOT A CHARACTER, drawn from the Lucide set through ContentIcon,
 * which parses the shapes into real elements rather than putting a string
 * through innerHTML. Only the one chosen icon reaches the page.
 *
 * SIZED IN PIXELS, set as a font size on the wrapper because ContentIcon draws
 * itself at 1em square. One number then controls both dimensions and cannot get
 * out of step with itself.
 *
 * A LINKED ICON NEEDS A NAME. An anchor whose only content is an aria-hidden SVG
 * is an anchor a screen reader announces as nothing at all, and a keyboard user
 * tabs onto a control with no idea what it does. So a link is only drawn when
 * there is a label to go with it; without one the icon stays decoration, which
 * is honest rather than broken.
 */
export function IconBlock({ props }: { props: Props }): ReactElement {
  const name = str(props, 'icon', 'sparkles');
  const size = clamp(props.size, 12, 200, 40);
  const colour = safeColour(props.colour);
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'left');
  const href = safeUrl(str(props, 'href'), CONTACT_OK);
  const label = str(props, 'label').trim();
  const pulse = oneOf(props, 'pulse', ['none', 'ring', 'glow'] as const, 'none');

  /*
   * ASKED BEFORE DRAWING, not after. `<ContentIcon />` is a JSX element whether
   * or not the component returns null from it, so testing the element for
   * truthiness would always pass and an unknown icon name would render an empty
   * box with no explanation. isIconName is the real question.
   */
  if (!isIconName(name)) return <div className="tgs-placeholder">Choose an icon</div>;
  const glyph = <ContentIcon name={name} className="tgs-icon__glyph" />;

  const style = {
    fontSize: `${size}px`,
    ...(colour ? { color: colour } : {}),
  } as CSSProperties;

  const drawn = href && label ? (
    <a className="tgs-icon__link" href={href} aria-label={label}>
      {glyph}
    </a>
  ) : (
    glyph
  );

  return (
    <div className="tgs-icon" data-align={align} style={style}>
      {/*
        THE PULSE GETS ITS OWN WRAPPER rather than going on `.tgs-icon`, which is
        the alignment box: turning that into an inline-flex to hang a ring off it
        would break centring and right alignment for every icon on every site.
        No pulse, no extra element.
      */}
      {pulse === 'none' ? (
        drawn
      ) : (
        <span className="tgs-icon__pulse" data-pulse={pulse}>
          {drawn}
        </span>
      )}
    </div>
  );
}

/**
 * A decorative shape.
 *
 * aria-hidden, AND THAT IS THE DESIGN RATHER THAN AN OVERSIGHT. A coloured
 * circle behind a heading is not information; announcing it would put noise
 * between the words that are.
 *
 * CSS, NOT A FILE. A circle is a border radius, a ring is a border, a square is
 * a box. They scale to any size with nothing to download and nothing to blur,
 * and they take the client's own colour rather than needing one baked into an
 * asset. The two shapes CSS cannot draw honestly, the triangle and the blob, use
 * clip-path, which is the same idea and still no file.
 *
 * IT NEVER OUTGROWS ITS COLUMN. The size is a request; `max-width: 100%` on the
 * element is what stops a 600px shape pushing a 320px phone sideways, which is
 * the one thing a decorative object must never do.
 */
export function ShapeBlock({ props }: { props: Props }): ReactElement {
  const shape = oneOf(
    props,
    'shape',
    ['circle', 'ring', 'square', 'rounded', 'triangle', 'blob'] as const,
    'circle',
  );
  const size = clamp(props.size, 16, 600, 120);
  const colour = safeColour(props.colour);
  const opacity = clamp(props.opacity, 5, 100, 100);
  const rotate = clamp(props.rotate, 0, 359, 0);
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'left');

  const style = {
    '--tgs-shape-size': `${size}px`,
    '--tgs-shape-opacity': String(opacity / 100),
    // A circle and a ring look identical at every angle, so the transform is
    // simply not written for them rather than written and wasted.
    ...(rotate && shape !== 'circle' && shape !== 'ring'
      ? { '--tgs-shape-rotate': `${rotate}deg` }
      : {}),
    ...(colour ? { '--tgs-shape-colour': colour } : {}),
  } as CSSProperties;

  return (
    <div className="tgs-shape" data-align={align}>
      <div className="tgs-shape__form" data-shape={shape} style={style} aria-hidden="true" />
    </div>
  );
}

/**
 * The copyright line.
 *
 * THE YEAR IS READ WHEN THE PAGE IS DRAWN, never stored. A published page is
 * server-rendered on every request, so the server knows the date and hands the
 * browser a finished line. No script, and nothing for a visitor with JavaScript
 * off or a crawler to miss.
 *
 * ONE `new Date()` IN THE WHOLE RENDER TREE, and it is here. The assembly is a
 * pure function in lib/content/copyright.ts that takes the year as an argument,
 * so the awkward cases — a range, a start year in the future, an owner whose
 * name already ends in a full stop — are tested against whichever year a test
 * cares about rather than whichever day it is run on.
 *
 * TEXT, NOT MARKUP. The line is built from parts we control and rendered as a
 * text node, so nothing here needs a sanitiser and nothing a client types can
 * become an element. It is the one block that is prose without being rich text,
 * and that is on purpose: a copyright with a bulleted list in it is not a thing.
 */
export function CopyrightBlock({ props }: { props: Props }): ReactElement {
  const line = copyrightLine(
    {
      owner: str(props, 'owner'),
      startYear: clamp(props.startYear, 0, 2200, 0),
      symbol: oneOf(props, 'symbol', ['symbol', 'word', 'both', 'none'] as const, 'symbol'),
      suffix: str(props, 'suffix'),
    },
    // UTC, which is what the server's clock reports. See the note in
    // lib/content/copyright.ts on why that is the right wrong answer.
    new Date().getUTCFullYear(),
  );

  const size = oneOf(props, 'size', ['s', 'm'] as const, 's');
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'left');

  return (
    <p className="tgs-copyright" data-size={size} data-align={align}>
      {line}
    </p>
  );
}

/**
 * Long text, folded to a few lines, with a control to open it.
 *
 * NO JAVASCRIPT, because this block does not need any. A
 * hidden checkbox and a label, the same shape TabsBlock uses for its panels: the
 * label toggles the input and `:checked ~` in the stylesheet drops the line
 * clamp on the body that follows it. The general sibling combinator only looks
 * FORWARD, which is why the input comes first in the markup.
 *
 * THE WHOLE TEXT IS ALWAYS HERE. Only its display is clamped, so a search engine
 * indexes every word, a screen reader reads every word, and somebody with
 * JavaScript off sees a page that simply has no fold in it. The usual scripted
 * read-more reveals or fetches the rest on click, which hides half a page's
 * words from the three audiences that matter most.
 *
 * TWO LABELS IN ONE CONTROL, one shown at a time by the stylesheet. Writing
 * "Read more" and "Show less" into the same element and swapping the text would
 * take a script; two spans and a CSS rule is the same result for nothing.
 *
 * ON THE CANVAS the checkbox is inert. `editing` makes it disabled, so clicking
 * a preview to select the block does not also fold the text the agent is
 * looking at. The clamp still shows, because the point of the block is what it
 * looks like folded.
 */
export function ReadMoreBlock({
  props,
  blockId,
  editing = false,
}: {
  props: Props;
  /** Ties the label to its checkbox. Unique in a page tree, which is all it
   *  needs to be: two blocks sharing an id would toggle each other. */
  blockId: string;
  editing?: boolean;
}): ReactElement {
  // Sanitised again here even though it was sanitised on save. Stored HTML is
  // never trusted, and this is the last gate before the browser.
  const html = sanitiseHtml(props.html, 'richtext');
  if (!html) return <div className="tgs-placeholder">Write the long version</div>;

  const lines = clamp(props.lines, 1, 20, 4);
  const moreLabel = str(props, 'moreLabel') || 'Read more';
  const lessLabel = str(props, 'lessLabel') || 'Show less';
  const fade = bool(props, 'fade', true);
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'left');
  const id = `tgs-rm-${blockId}`;

  return (
    <div
      className="tgs-readmore"
      data-align={align}
      data-fade={fade ? 'true' : undefined}
      style={{ '--tgs-rm-lines': String(lines) } as CSSProperties}
    >
      <input className="tgs-readmore__toggle tgs-sr-only" type="checkbox" id={id} disabled={editing} />

      {/*
        The body comes AFTER the input and BEFORE the label, because the
        stylesheet reaches both with `:checked ~`, which only looks forward.
      */}
      <div className="tgs-readmore__body tgs-text" dangerouslySetInnerHTML={{ __html: html }} />

      <label className="tgs-readmore__control" htmlFor={id}>
        <span className="tgs-readmore__more">{moreLabel}</span>
        <span className="tgs-readmore__less">{lessLabel}</span>
        <svg
          className="tgs-readmore__chev"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </label>
    </div>
  );
}

/**
 * A file to download.
 *
 * A PLAIN LINK, and everything else follows from that. Not a button with a click
 * handler, not a fetch, not a blob: an anchor with an href, so it works with a
 * right-click, with "save link as", on a phone's share sheet, in a screen reader,
 * and with JavaScript off. Anything cleverer here would be worse in every one
 * of those places, and would break clause 2 of the rule in lib/content/blocks.ts:
 * the content never depends on a script.
 *
 * `download` IS A REQUEST, NOT A GUARANTEE. Browsers honour it only for a
 * same-origin file, and ours are served from the blob store, which is a different
 * origin. So a PDF will often open in the browser's own viewer instead. That is
 * usually what a visitor wanted, and the alternative — proxying every download
 * through our own origin to force the attachment header — would put a serverless
 * function in front of every brochure for the sake of a preference. The attribute
 * is set anyway, because when it does hold it holds for free.
 *
 * THE NAME, THE FORMAT AND THE SIZE come off the block's own props, written there
 * when the file was chosen. Reading them from the media row at render time would
 * be a database query per file per visitor to print "2.4MB".
 *
 * SIZE AND FORMAT ARE NOT DECORATION. "PDF, 2.4MB" is what tells somebody on a
 * train whether to tap it, and what stops a click being a surprise.
 */
export function FileBlock({ props }: { props: Props }): ReactElement {
  const url = safeUrl(str(props, 'url'));
  if (!url) return <div className="tgs-placeholder">Choose a file to offer</div>;

  const name = str(props, 'name');
  // The title is what a visitor reads. Falling back to the stored filename means
  // a client who picked a file and typed nothing still gets something meaningful
  // rather than the word "Download" on its own.
  const title = str(props, 'title') || name || 'Download';
  const description = str(props, 'description');
  const format = str(props, 'format');
  const size = clamp(props.size, 0, 200 * 1024 * 1024, 0);
  const look = oneOf(props, 'look', ['card', 'button'] as const, 'card');
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'left');
  const newTab = bool(props, 'newTab', true);

  // "PDF · 2.4MB", each half only when it is there.
  const detail = [format, size > 0 ? humanBytes(size) : ''].filter(Boolean).join(' · ');

  /*
   * THE BADGE IS THE EXTENSION, THE DETAIL LINE IS THE NAME, and the split is
   * deliberate. "PowerPoint" in a badge is nine characters wider than "PDF", so a
   * page of mixed downloads gets badges of four different widths and titles that
   * start at four different places. An extension is never more than four
   * characters, so every badge is the same size and the titles line up.
   *
   * Taken off the stored filename rather than a fifth prop: the extension is
   * already in the name, and a prop that could disagree with it would be a prop
   * that eventually does. The friendly word survives where it reads best, in the
   * line underneath.
   */
  const badge = (name.toLowerCase().match(/\.([a-z0-9]{1,4})$/)?.[1] ?? format ?? '').slice(0, 4);

  /*
   * rel="noopener noreferrer" whenever the link opens a tab. Standard practice
   * and cheap: without it the opened page gets a handle on the opener through
   * window.opener, and a client's own file is not the only thing that could ever
   * end up behind one of these addresses.
   */
  const target = newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {};

  if (look === 'button') {
    return (
      <div className="tgs-file" data-look="button" data-align={align}>
        {/* The SAME class and data-attributes the Button block uses, so a
            download button and a call to action are the same object on a page
            rather than two things that nearly match. */}
        <a
          className="tgs-button"
          data-variant="primary"
          data-size="m"
          href={url}
          download={name || undefined}
          {...target}
        >
          {title}
          {/* The space is a real character rather than CSS margin, because this
              is one line of prose and a margin would not survive the line
              wrapping in the middle of it. */}
          {detail && <span className="tgs-file__detail">{'\u00A0'}({detail})</span>}
        </a>
      </div>
    );
  }

  return (
    <div className="tgs-file" data-look="card" data-align={align}>
      <a className="tgs-file__card" href={url} download={name || undefined} {...target}>
        {/*
          The format sits in its own badge rather than being read out as part of
          the title. aria-hidden because the same words are in the detail line
          below, and a screen reader announcing "PDF PDF 2.4 megabytes" is worse
          than one that says it once.
        */}
        <span className="tgs-file__badge" aria-hidden="true">
          {badge || 'File'}
        </span>
        <span className="tgs-file__body">
          <span className="tgs-file__title">{title}</span>
          {description && <span className="tgs-file__desc">{description}</span>}
          {detail && <span className="tgs-file__meta">{detail}</span>}
        </span>
        <span className="tgs-file__go" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
          </svg>
        </span>
      </a>
    </div>
  );
}

/**
 * The trail, as a block the client has placed.
 *
 * WHAT IS AND IS NOT STORED. The crumbs are NOT in props when a client saves;
 * they are written in at render time by lib/content/breadcrumbs.ts from the
 * page's own address, so moving or renaming a page moves the trail with it. The
 * separator, the size and the alignment ARE stored, because those are choices.
 *
 * ON THE CANVAS THERE IS NO ADDRESS TO READ, since the editor is drawing a page
 * that has not been requested at a URL. So an unfilled block draws a worked
 * example rather than nothing, which is the only way a client can see what they
 * are positioning while they position it. `data-sample` marks it, so it is
 * obvious in the DOM that those words are not the real ones.
 *
 * SEPARATORS ARE CSS, not characters in the markup. A separator in the text is a
 * separator a screen reader reads aloud between every step ("Home slash Greece
 * slash Crete"), and it is one a visitor copying the trail takes with them. The
 * ::before rules in globals.css draw it instead.
 *
 * THE LAST CRUMB IS NOT A LINK. It is the page somebody is already on, and
 * aria-current says which one it is.
 */
export function BreadcrumbsBlock({
  props,
  editing = false,
}: {
  props: Props;
  editing?: boolean;
}): ReactElement | null {
  const filled = list(props, 'crumbs')
    .map((crumb) => ({
      name: str(crumb, 'name'),
      href: typeof crumb.href === 'string' ? safeUrl(crumb.href) : '',
    }))
    .filter((crumb) => crumb.name !== '');

  /*
   * A page with nothing to show. On the live site that is the home page, where a
   * trail of one is not a trail, so it draws nothing at all rather than an empty
   * strip of padding. On the canvas it is every page, because there is no
   * address, hence the sample.
   */
  const sample = filled.length === 0;
  if (sample && !editing) return null;

  const crumbs = sample
    ? [
        { name: 'Home', href: '/' },
        { name: 'Destinations', href: '/destinations' },
        { name: 'This page', href: '' },
      ]
    : filled;

  const separator = oneOf(
    props,
    'separator',
    ['slash', 'chevron', 'arrow', 'dot', 'bullet'] as const,
    'slash',
  );
  const size = oneOf(props, 'size', ['xs', 's', 'm'] as const, 's');
  const align = oneOf(props, 'align', ['left', 'centre', 'right'] as const, 'left');
  const colour = safeColour(props.colour);

  // Home is the first crumb, so dropping it is dropping the first one. Never the
  // last, which is the page itself and the only crumb a one-deep page has.
  const shown = bool(props, 'showHome', true) ? crumbs : crumbs.slice(1);
  if (shown.length === 0) return null;

  return (
    <nav
      className="tgs-crumbs tgs-crumbs--block"
      aria-label="Breadcrumb"
      data-separator={separator}
      data-size={size}
      data-align={align}
      data-sample={sample ? 'true' : undefined}
      style={colour ? ({ '--tgs-crumb-colour': colour } as CSSProperties) : undefined}
    >
      <ol>
        {shown.map((crumb, index) => (
          <li key={index}>
            {crumb.href && index < shown.length - 1 ? (
              <a href={crumb.href}>{crumb.name}</a>
            ) : (
              <span aria-current="page">{crumb.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
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
