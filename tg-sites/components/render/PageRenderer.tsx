/**
 * Turns a page tree into HTML.
 *
 * The same components render the published page and the editor preview. The
 * only difference is `editable`, which adds `data-path` hooks, empty-state
 * placeholders and column resize handles.
 *
 * There are NO event handlers in here. The editor attaches one delegated
 * listener to the canvas and reads `data-path` off the closest ancestor.
 * That keeps this whole file usable as a server component on the published
 * side, which is the point: the preview cannot drift from what ships.
 */

import { Fragment, type CSSProperties, type ReactElement } from 'react';
import {
  boxIsEmpty,
  EMPTY_BOX,
  MOTION_ARRIVAL_RECIPES,
  MOTION_BACKGROUND_RECIPES,
  MOTION_CYCLING_RECIPES,
  MOTION_LIVE_RECIPES,
  MOTION_VIDEO_RECIPES,
  safeAnchor,
  safeColour,
  type Block,
  type Box,
  type Column,
  type Page,
  type Row,
  type Section,
} from '../../lib/content/schema';
import { BLEND_DIVIDER, dividerShape, normaliseDividerHeight, safeDivider, sectionFill } from '../../lib/content/dividers';
import { safeUrl } from '../../lib/content/sanitise';
import {
  normaliseLetterSpacing,
  normaliseLineHeight,
  normaliseRevealStyle,
  normaliseTextSize,
} from '../../lib/content/styles';
import { responsiveVars } from '../../lib/content/responsive';
import { BlockRenderer } from './BlockRenderer';
import type { PreparedMap } from '../../lib/content/prepared';
import { FULL_WIDTH_SIZES, srcSetFor, type ImageSizes } from '../../lib/content/image-sizes';

/**
 * A container block's own columns.
 *
 * Inlined here rather than imported from lib/content/tree, on purpose. This
 * file is a server component on the published side and is kept free of the
 * tree/registry modules so none of that follows it into the page bundle. The
 * lookup is one property read, so a copy costs nothing and the isolation is
 * worth keeping.
 */
function innerColumnsOf(block: Block): Column[] {
  const columns = (block.props as { columns?: unknown }).columns;
  return Array.isArray(columns) ? (columns as Column[]) : [];
}

/**
 * A container's own gap and stacking, clamped here because props is a loose bag
 * the schema never validates: a value written by a newer build, or a hand-edited
 * tree, must reduce to something legal rather than reach the CSS raw. Defaults
 * are the 16px and phone-stack the container drew with before they were settable.
 */
function innerGap(block: Block): number {
  const raw = (block.props as { gap?: unknown }).gap;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 16;
  return Math.min(96, Math.max(0, Math.round(n)));
}

function innerStack(block: Block): 'always' | 'tablet' | 'mobile' {
  const raw = (block.props as { stack?: unknown }).stack;
  return raw === 'always' || raw === 'tablet' ? raw : 'mobile';
}

/**
 * A grid's column count per screen, clamped the same way innerGap clamps its
 * number: props is a loose bag the schema never validates, so a value written by
 * a newer build or a hand-edited tree has to reduce to something legal rather
 * than reach the CSS raw. One to six; the defaults are the registry's.
 */
function gridAcross(block: Block): { desktop: number; tablet: number; phone: number } {
  const props = block.props as Record<string, unknown>;
  const count = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(6, Math.max(1, Math.round(n)));
  };
  return {
    desktop: count(props.across, 3),
    tablet: count(props.acrossTablet, 2),
    phone: count(props.acrossPhone, 1),
  };
}

/** How a grid's cells line up in their row. Stretch is the card-matching one. */
function gridAlign(block: Block): 'top' | 'centre' | 'bottom' | 'stretch' {
  const raw = (block.props as { align?: unknown }).align;
  return raw === 'centre' || raw === 'bottom' || raw === 'stretch' ? raw : 'top';
}

interface Editable {
  editable?: boolean;
  /**
   * The data-path of the block currently being typed into on the canvas.
   *
   * Passed down rather than looked up, because this file has no state and no
   * handlers by design. The block at this path renders an empty shell and the
   * editor owns its contents: see TextBlock's editingHost.
   */
  editingPath?: string | null;
  /**
   * This tree is the editor's canvas, whether it is editing OR previewing.
   *
   * NOT the same as `editable`, which the Preview button turns off so the canvas
   * renders the exact published DOM. One block needs the difference. A widget off
   * the canvas draws a bare container that components/render/WidgetScripts.tsx
   * fills, but the editor never renders that script (it would hammer the widget
   * config API on every keystroke), so on the canvas that container would stay
   * empty. The canvas hosts the widget in its own sealed iframe instead, and it
   * has to keep doing so in preview, where `editable` is false but still no script
   * has appeared. So this stays true the whole time the editor is on screen, and
   * is false on the published page and the server preview route, which do render
   * the script. See WidgetBlock.
   *
   * (Andy, 11 Aug 2026: the Contact page's enquiry widget vanished the moment he
   * pressed Preview, because `editable` alone flipped it to the empty container.)
   */
  editorCanvas?: boolean;
  /**
   * Markup the server has already cleaned, by block id (lib/content/prepared.ts).
   * Threaded rather than hung on the blocks' own props, because props come out of
   * the database and a side channel cannot be forged by a stored row.
   */
  prepared?: PreparedMap;
  /**
   * The stored sizes of each picture on this tree, by url.
   *
   * Beside the tree for the same reason `prepared` is: a block stores an address
   * and the sizes live on the media row, so putting them on props would be
   * denormalising a value that changes when the bank changes. Absent on the
   * editor canvas, which is correct: the canvas is not what a visitor downloads,
   * and a srcset there would only make the preview harder to reason about.
   */
  sizes?: ImageSizes;
}

/**
 * Emit `data-path` only in the editor.
 *
 * Passing `data-path={undefined}` would keep the attribute out of the DOM,
 * but it still ships as `"data-path":"$undefined"` in the RSC flight payload
 * on every node. Spreading nothing keeps the published response clean, which
 * matters against the 60KB initial-HTML budget.
 */
function pathAttr(editable: boolean, key: string): { 'data-path'?: string } {
  return editable ? { 'data-path': key } : {};
}

/**
 * The section styles that can be set per screen, each mapped to the base custom
 * property whose per-size twins an override sets (see lib/content/responsive.ts).
 * The renderer spreads these onto the section's inline style, and the static
 * container queries in globals.css fold them into the value the section reads.
 *
 * Slice one, 11 Aug 2026: vertical spacing. The set grows as controls are added.
 */
const SECTION_RESPONSIVE = [
  { property: 'paddingY', varBase: '--tgs-pad', toCss: (value: unknown) => `${value as number}px` },
] as const;

/**
 * The same, for a block: its text size at tablet and phone. The value is a size
 * string from the toolbar's own list (see normaliseTextSize), so an override
 * cannot say anything an inline size could not; a stray one drops rather than
 * rendering broken. The twins fold into --tgs-fs-r, which .tgs-text/.tgs-heading
 * read ahead of their own size (globals.css). Line spacing and letter spacing
 * ride the same engine, into --tgs-lh-r and --tgs-ls-r.
 */
const BLOCK_RESPONSIVE = [
  { property: 'fontSize', varBase: '--tgs-fs', toCss: (value: unknown) => normaliseTextSize(value) ?? null },
  { property: 'lineHeight', varBase: '--tgs-lh', toCss: (value: unknown) => normaliseLineHeight(value) ?? null },
  {
    property: 'letterSpacing',
    varBase: '--tgs-ls',
    toCss: (value: unknown) => normaliseLetterSpacing(value) ?? null,
  },
] as const;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PageRenderer({
  page,
  editable = false,
  editingPath = null,
  editorCanvas = false,
  prepared,
  sizes,
  emptyNote = 'This page is empty. Add a section to get started.',
  theme,
  region = null,
}: {
  page: Page;
  /**
   * What the editor says when there is nothing here yet.
   *
   * A prop rather than a constant because this same renderer draws the site's
   * header and footer in the editor, wrapped as a page, and telling somebody
   * who has opened their header that "this page is empty" is the sort of small
   * wrongness that makes a product feel like scaffolding. The browser harness
   * caught exactly that.
   *
   * Only ever seen while editing: a published page with no sections renders
   * nothing at all.
   */
  emptyNote?: string;
  /**
   * The tenant's theme, already turned into custom properties by
   * lib/theme/tokens.ts.
   *
   * Optional, and omitting it is a real case rather than an oversight: the
   * fallbacks in globals.css are the same values the default theme derives to,
   * so a page rendered without one looks correct rather than unstyled.
   *
   * Custom properties in a style attribute, not a <style> tag. That keeps this
   * CSP clean with no style-src unsafe-inline, and it is the same mechanism the
   * column widths already use. It also means the editor canvas can carry a
   * client's theme with the identical object the published page uses, so the
   * preview cannot drift from what ships.
   */
  theme?: CSSProperties;
  /**
   * Which region this tree is, when it is one.
   *
   * ONLY THE EDITOR PASSES THIS, and it is here so the canvas can show a header
   * as a header. A published header goes through RegionRenderer, which wraps it
   * in a real `<header class="tgs-page tgs-region" data-region="header">`; the
   * canvas renders the same sections through this component and got a bare
   * `.tgs-page`, so every rule keyed on a region missed it. The footer's
   * hairline was invisible in the editor from the day it shipped, and the
   * header's phone bar would have been too.
   *
   * `data-sticky` and `data-overlay` are DELIBERATELY not carried across. Those
   * two position the header against the document, and a canvas has no document
   * to stick to: honouring them here would lift the header out of the flow of a
   * preview that has nothing underneath it. They stay a property-pane setting
   * whose effect you see on the site.
   */
  region?: 'header' | 'footer' | null;
} & Editable): ReactElement {
  return (
    <div
      className={region ? 'tgs-page tgs-region' : 'tgs-page'}
      data-region={region ?? undefined}
      style={theme}
      {...pathAttr(editable, 'page')}
    >
      {editable && <InsertPoint index={0} />}

      {page.sections.map((section, index) => (
        <Fragment key={section.id}>
          <SectionRenderer
            section={section}
            index={index}
            editable={editable}
            editingPath={editingPath}
            editorCanvas={editorCanvas}
            prepared={prepared}
            sizes={sizes}
            /*
              A shaped edge is the BOUNDARY between two sections, so drawing one
              needs the colour on the other side of it. Only this component
              knows the order, so only this component can say. Undefined at
              either end means the page itself.
            */
            above={page.sections[index - 1]}
            below={page.sections[index + 1]}
          />
          {editable && <InsertPoint index={index + 1} />}
        </Fragment>
      ))}

      {editable && page.sections.length === 0 && (
        <div className="tgs-placeholder" style={{ margin: 32 }}>
          {emptyNote}
        </div>
      )}

      {/*
        THE WIDGET SCRIPTS ARE NOT HERE, and were until 31 Jul 2026.

        A header and a footer are separate trees that can hold widgets of their
        own, so a page emitting only its own scripts would miss theirs and each
        tree emitting its own would fetch the same file three times. Whoever
        assembles the whole document now collects the tags from all three and
        renders components/render/WidgetScripts.tsx once. See the note in that
        file. The editor renders none of it, for the same reason as before.
      */}
    </div>
  );
}

/**
 * The "Add Section" affordance that sits on the seam between two sections.
 *
 * Zero height and absolutely positioned, so it floats over the join without
 * pushing the sections apart. That matters more than it sounds: the canvas
 * has to stay pixel-accurate to what gets published, and a 24px strip
 * between every section would quietly make the preview a lie.
 *
 * No handler here. The canvas reads data-insert from a delegated click, which
 * is what keeps this file usable as a server component.
 */
function InsertPoint({ index }: { index: number }): ReactElement {
  return (
    <div className="ed-insert">
      <button type="button" className="ed-insert__btn" data-insert={index}>
        <span className="ed-insert__plus" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <span className="ed-insert__label">Add Section</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function SectionRenderer({
  section,
  index,
  editable = false,
  editingPath = null,
  editorCanvas = false,
  prepared,
  sizes,
  above,
  below,
  hangBottomDivider = false,
}: {
  section: Section;
  index: number;
  /** The sections either side, for the shaped edges. See SectionDivider. */
  above?: Section;
  below?: Section;
  /**
   * Draw the bottom divider HANGING below the section in the section's OWN
   * colour, rather than inside it in the neighbour's. A header region has no
   * next section to borrow a colour from, and what its shaped edge means is
   * different anyway: the bar's own silhouette dipping over the page (the
   * MOKSHA wave), not a neighbour reaching up. Set by RegionRenderer.
   */
  hangBottomDivider?: boolean;
} & Editable): ReactElement {
  const background = safeUrl(section.backgroundImage ?? '');
  const video = safeUrl(section.backgroundVideo ?? '');
  /*
   * MORE THAN ONE BACKGROUND PICTURE CYCLES. The section's own picture is the
   * first, the extras follow, each reduced and safeUrl'd the same way. It is a
   * slideshow only with two or more and no video, since a video already fills
   * the background and takes precedence. Capped at eight, the range the shared
   * keyframes cover. PURE CSS, so it plays on the canvas where a script never
   * runs, and it carries no controls because the section's words sit over it.
   */
  const bgExtra = (section.backgroundSlides ?? [])
    .map((slide) => ({ src: safeUrl(slide.src), style: bgPictureStyle(slide) }))
    .filter((slide): slide is { src: string; style: CSSProperties } => !!slide.src);
  const bgImages = [
    ...(background ? [{ src: background, style: backgroundStyle(section) }] : []),
    ...bgExtra,
  ].slice(0, 8);
  const bgShow = !video && bgImages.length > 1;

  /*
   * THE SECTION'S MOTION RECIPE, and the one rule that keeps it from fighting what
   * is already here.
   *
   * Only a LIVE recipe reaches the attribute. The rest of the enum parses and stores
   * so a save round trips, but emitting data-motion for a recipe with no CSS behind
   * it would put a promise in the DOM the stylesheet does not keep.
   *
   * Off while editing, the same gate as the reveal and the hover above: the canvas
   * re-renders on every keystroke and a picture drifting under the pointer would
   * fight selecting it.
   *
   * A recipe that drives the BACKGROUND needs a still background picture, exactly
   * the guard Ken Burns and the parallax already use: never the cycling background
   * and never a video.
   */
  const recipe = section.motion && !editable ? section.motion.recipe : undefined;
  const stillBackground = Boolean(background) && !bgShow && !video;
  /*
   * What this recipe needs before it can do anything. A2 is a photo SEQUENCE, so it
   * wants the cycling background and is inert on one still picture; A6 and S5 drive
   * that one still picture and are inert without it. Everything else needs neither.
   */
  const motionHasWhatItNeeds = (r: typeof recipe): boolean => {
    if (!r) return false;
    if (MOTION_VIDEO_RECIPES.has(r)) return Boolean(video);
    if (MOTION_CYCLING_RECIPES.has(r)) return bgShow;
    if (MOTION_BACKGROUND_RECIPES.has(r)) return stillBackground;
    return true;
  };
  const motion =
    recipe && MOTION_LIVE_RECIPES.has(recipe) && motionHasWhatItNeeds(recipe) ? recipe : undefined;
  /*
   * The recipe WINS the background. Parallax and Ken Burns have moved that one
   * picture since 11 and 13 Aug 2026 and globals.css has always said only one of
   * them may. A background recipe is a third claimant, so rather than leaving three
   * animations on one element the recipe takes it and the two booleans stand down.
   * A5 is not a background recipe, so it composes with them rather than replacing.
   */
  const motionOwnsBackground = Boolean(motion && MOTION_BACKGROUND_RECIPES.has(motion));
  /*
   * The same rule again, for the other thing two features can both claim. The reveal
   * has animated blocks into view since 11 Aug 2026 and S1 tide-reveal wants those
   * same blocks, so rather than leaving two animations on one element the recipe
   * takes it and the reveal stands down. A section may still carry both settings;
   * only one of them draws.
   */
  const motionOwnsArrival = Boolean(motion && MOTION_ARRIVAL_RECIPES.has(motion));
  const bgTransition = section.backgroundTransition === 'slide' ? 'slide' : 'fade';
  const bgInterval = section.backgroundInterval ?? 5;
  /*
   * Reduced again here even though the schema already did it on the way in, the
   * same belt-and-braces every other stored string in this tree gets.
   *
   * It earns its place on the CANVAS rather than on a published page. The editor
   * holds a half-typed value between keystrokes, and "!!!" on its way to
   * something real reduces to a bare hyphen. Rendered raw that is `id="-"`,
   * which is a preview showing something the save would quietly correct.
   */
  const anchor = safeAnchor(section.anchor);

  return (
    <section
      className="tgs-section"
      /*
       * The name a link can point at.
       *
       * Slugified by the schema rather than validated here, and absent when
       * there is nothing usable, so an `id=""` never reaches the page. This is
       * the whole of in-page navigation: a button whose address is "#prices"
       * has somewhere to land only because of this attribute.
       */
      {...(anchor ? { id: anchor } : {})}
      data-tone={section.tone}
      data-gradient={section.gradient ? '' : undefined}
      data-width={section.width}
      /*
       * The reveal is OFF while editing and on for the published page and the
       * preview. A block that fades out below the fold is right for a visitor and
       * wrong for someone editing it, who would watch content vanish as they
       * scrolled the canvas. `editable` is the editor canvas, so this gates on it.
       *
       * The value is the arrival style (rise, fade, slide, zoom, blur), normalised
       * to the closed list so a stored string can never put anything but a known
       * style on the attribute. globals.css keys each keyframe off it.
       */
      data-reveal={
        section.reveal && !motionOwnsArrival && !editable
          ? normaliseRevealStyle(section.revealStyle)
          : undefined
      }
      /*
       * Stagger rides alongside reveal: it means nothing without it, so it is only
       * emitted when reveal is on. It turns the reveal from block-by-block into
       * item-by-item, the columns or the cards arriving one after another. Same
       * `editable` gate, and the cascade itself is pure CSS in globals.css.
       */
      data-reveal-stagger={
        section.reveal && section.revealStagger && !motionOwnsArrival && !editable ? '' : undefined
      }
      /*
       * Cards and buttons lift under the pointer on the published page and in preview,
       * not while editing, where the small movement would fight selecting them. Same
       * `editable` gate as the reveal above. The lift itself is pure CSS in globals.css.
       */
      data-hover-lift={section.hoverLift && !editable ? '' : undefined}
      /*
       * Card pictures zoom a touch under the pointer, the frame clipping them. Same
       * `editable` gate as the lift above; the zoom itself is pure CSS in globals.css.
       */
      data-hover-zoom={section.hoverZoom && !editable ? '' : undefined}
      /*
       * Cards wash in the brand colour under the pointer (Duda's "Fancy Grid").
       * Same `editable` gate as the two above, so it never fights the canvas.
       */
      data-hover-tint={section.hoverTint && !editable ? '' : undefined}
      /*
       * Parallax drifts a still background picture on scroll. Only when there is one
       * still picture (not the cycling background, not a video) and not while editing,
       * so it never fights the canvas. The drift itself is pure CSS in globals.css.
       */
      data-parallax={
        section.parallax && stillBackground && !motionOwnsBackground && !editable ? '' : undefined
      }
      /*
       * Ken Burns: the same still background picture drifts and zooms slowly on its
       * own, a time-based animation rather than the scroll-linked parallax. Only one
       * background motion at a time, so never alongside parallax, and otherwise the
       * same guards as parallax (a still picture, not the cycling one or a video) and
       * the same `editable` gate, so the canvas stays still. The motion itself is CSS
       * in globals.css.
       */
      data-ken-burns={
        section.kenBurns && stillBackground && !motionOwnsBackground && !section.parallax && !editable
          ? ''
          : undefined
      }
      /*
       * The motion recipe, and how much of it. Both are decided above, where the
       * background guards and the resolution rule against parallax and Ken Burns
       * live. Intensity is a band from 1 to 3 rather than an on and off switch, so
       * the gentlest setting still moves; globals.css reads it as custom properties
       * and the recipes themselves are pure CSS.
       */
      data-motion={motion}
      data-motion-intensity={motion ? String(section.motion?.intensity ?? 2) : undefined}
      /*
       * Slide this section up under the one above it. Structural, not decorative,
       * so it is NOT gated on `editable` the way the reveal and the hover are: an
       * overlap you set is part of the layout, and a preview that did not show it
       * would be lying about where the section sits. The header case is the one
       * exception the canvas cannot show, since the editor draws the header as its
       * own band rather than over the page; it shows on the published site.
       */
      data-pull-up={section.pullUp ? '' : undefined}
      /*
       * Hidden on some screens, the whole section. Same list and same container
       * queries as a block's, and the same `editable` gate as the reveal and hover
       * above: while editing the section stays on the canvas so it can be selected
       * and brought back, and it drops off the layout only on the published page and
       * in preview.
       */
      data-hide-desktop={!editable && section.hideOn?.includes('desktop') ? '' : undefined}
      data-hide-tablet={!editable && section.hideOn?.includes('tablet') ? '' : undefined}
      data-hide-phone={!editable && section.hideOn?.includes('phone') ? '' : undefined}
      style={{
        ...boxStyle(section.box),
        '--tgs-pad': `${section.paddingY}px`,
        '--tgs-min-h': `${section.minHeight}px`,
        '--tgs-scrim': section.overlay,
        ...(section.pullUp ? { '--tgs-pull-up': `${section.pullUp}px` } : {}),
        // Only when a colour was chosen. Left unset, the scrim CSS falls back to
        // its own navy default, so a section that never picked one is untouched.
        ...(safeColour(section.overlayColour)
          ? { '--tgs-scrim-colour': safeColour(section.overlayColour) }
          : {}),
        // The two ends of the animated gradient band, when the client set them.
        // Absent otherwise, so globals.css falls back to the theme accent and brand.
        ...(safeColour(section.gradientFrom) ? { '--tgs-sgrad-a': safeColour(section.gradientFrom) } : {}),
        ...(safeColour(section.gradientTo) ? { '--tgs-sgrad-b': safeColour(section.gradientTo) } : {}),
        // The per-screen spacing values, as inline custom properties. Absent
        // unless a size overrides the base, so a section that never touched them
        // is byte-for-byte what it was before this shipped.
        ...responsiveVars(section.responsive, SECTION_RESPONSIVE),
      } as CSSProperties}
      data-shadow={section.box.shadow}
      {...pathAttr(editable, `s${index}`)}
    >
      {/*
        THE PICTURE AND THE VIDEO ARE BOTH DRAWN WHEN BOTH ARE SET, with the
        video over the picture. That is what makes a background video safe to
        offer: a visitor who has asked their system for less motion gets the
        video hidden by one CSS rule and the picture showing through, rather
        than a blank band where a hero should be.

        NEVER IN THE EDITOR for the video. A file that reloads and restarts on
        every keystroke is not a preview, it is a distraction and a download.
        The poster still shows, which is what the section will look like to
        anybody who asked for less motion anyway.
      */}
      {bgShow ? (
        <div
          className="tgs-section__bgshow"
          aria-hidden="true"
          data-transition={bgTransition}
          data-count={bgImages.length}
          style={{ '--tgs-ss-cycle': `${bgImages.length * bgInterval}s` } as CSSProperties}
        >
          {bgImages.map((image, i) => (
            <img
              key={i}
              className="tgs-section__bgslide"
              src={image.src}
              srcSet={srcSetFor(image.src, sizes) ?? undefined}
              sizes={srcSetFor(image.src, sizes) ? FULL_WIDTH_SIZES : undefined}
              alt=""
              aria-hidden="true"
              loading={i === 0 ? 'eager' : 'lazy'}
              style={{
                ...image.style,
                animationDelay: `calc(${i} * var(--tgs-ss-cycle) / ${bgImages.length})`,
              }}
            />
          ))}
        </div>
      ) : bgImages[0] ? (
        <img
          className="tgs-section__bg"
          src={bgImages[0].src}
          /*
           * A full-bleed background genuinely is the viewport's width, so the
           * conservative 100vw hint is also the accurate one here. This is the
           * usual largest-paint element on a travel homepage.
           */
          srcSet={srcSetFor(bgImages[0].src, sizes) ?? undefined}
          sizes={srcSetFor(bgImages[0].src, sizes) ? FULL_WIDTH_SIZES : undefined}
          alt=""
          aria-hidden="true"
          style={bgImages[0].style}
        />
      ) : null}

      {video && !editable && (
        <video
          className="tgs-section__bg tgs-section__bg--video"
          /*
           * A7 puts the address on a <source> with a media query instead of on the
           * element, and that one move is the whole recipe.
           *
           * A background video has always been HIDDEN under reduced motion, by one
           * CSS rule, with the poster showing through. Hidden is not the same as not
           * fetched: measured in a real browser, the plain src downloads the film for
           * a visitor who asked for less motion and will never see a frame of it. A
           * <source> whose media query does not match is never selected, so nothing
           * is requested at all. Measured both ways, one request against none.
           *
           * That costs the visitor nothing and saves them the whole download, and it
           * is the cheapest answer there is to what a video hero costs in egress.
           *
           * Only for a section that asked for A7. Every video already published keeps
           * the src it has and behaves exactly as it did.
           */
          src={motion === 'A7' ? undefined : video}
          poster={bgImages[0]?.src || undefined}
          autoPlay
          muted
          loop
          playsInline
          // Decorative by definition: the words over it belong to the blocks
          // inside the section, never to the film.
          aria-hidden="true"
          tabIndex={-1}
        >
          {motion === 'A7' ? (
            <source src={video} media="(prefers-reduced-motion: no-preference)" />
          ) : null}
        </video>
      )}

      {(bgImages.length > 0 || video) && <div className="tgs-section__scrim" aria-hidden="true" />}

      {/*
        THE SHAPED EDGES. Each one sits OUTSIDE the section's own box, drawn in
        the section's background colour, so the colour reaches up into the
        section above or down into the one below. That is what makes the join
        look like one design rather than two rectangles touching.

        Drawn before the content so it can never sit over the words, and marked
        decorative because it is: it carries no meaning a reader would miss.
      */}
      <SectionDivider
        edge="top"
        shape={section.dividerTop}
        height={section.dividerHeight}
        fill={sectionFill(above)}
      />
      <SectionDivider
        edge="bottom"
        shape={section.dividerBottom}
        height={section.dividerHeight}
        fill={hangBottomDivider ? sectionFill(section) : sectionFill(below)}
        hang={hangBottomDivider}
      />

      <div className="tgs-section__inner">
        {section.rows.map((row, rowIndex) => (
          <RowRenderer
            key={row.id}
            row={row}
            sectionIndex={index}
            index={rowIndex}
            editable={editable}
            editingPath={editingPath}
            editorCanvas={editorCanvas}
            prepared={prepared}
            sizes={sizes}
          />
        ))}
        {editable && section.rows.length === 0 && (
          <div className="tgs-placeholder">This section has no rows yet</div>
        )}
      </div>

      {/*
        Drag the foot of a section to change its height.
        A button, not a bare div: it has to be reachable by keyboard, and the
        arrow keys in Canvas do the same job as the drag.
      */}
      {editable && (
        <button
          type="button"
          className="ed-vresize"
          data-vresize={`s${index}`}
          aria-label={`Space above and below this section, ${section.paddingY} pixels`}
          title="Drag to change the height"
        >
          <span className="ed-vresize__grip" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

/**
 * A box style as custom properties.
 *
 * ALWAYS EMITS THE WHOLE SET, even the zeroes. Custom properties inherit, so
 * a column that left one out would silently pick up its section's value and
 * a padding set on the section would appear again inside every column.
 * Writing all of them at every level is what stops that.
 */
function boxStyle(box: Box): CSSProperties {
  // A gradient fill, only when both stops validated. It rides its own property
  // rather than --tgs-bg, because --tgs-bg is used inside a linear-gradient() in
  // the CSS (so a solid can be a colour), and a gradient inside a gradient is
  // not a value. The CSS lets --tgs-bg-image win over the solid.
  const gradient =
    box.gradient && box.gradient.from && box.gradient.to
      ? `linear-gradient(${box.gradient.angle}deg, ${box.gradient.from}, ${box.gradient.to})`
      : undefined;

  return {
    '--tgs-pt': `${box.padding.top}px`,
    '--tgs-pr': `${box.padding.right}px`,
    '--tgs-pb': `${box.padding.bottom}px`,
    '--tgs-pl': `${box.padding.left}px`,
    '--tgs-radius': `${box.radius}px`,
    '--tgs-bw': `${box.borderWidth}px`,
    '--tgs-bc': box.borderColour ?? 'transparent',
    // 'transparent' rather than 'inherit': a column with no background of its
    // own should show the section behind it, not repaint it.
    '--tgs-bg': box.background ?? 'transparent',
    ...(gradient ? { '--tgs-bg-image': gradient } : {}),
    // Backdrop blur for a glass bar. Only when set, so an ordinary box carries
    // no backdrop-filter and pays nothing for it.
    ...(box.blur > 0 ? { '--tgs-blur': `${box.blur}px` } : {}),
  } as CSSProperties;
}

/**
 * A stored background percentage, pinned to 0..max here as well as in the schema.
 *
 * The last gate before a number reaches the CSS. The editor holds a value
 * between a drag and a save, and a page written by a newer build could carry
 * anything, so the render clamps it again. Missing or not a number is the
 * default, which for the focus point is the middle and for an adjustment is the
 * picture untouched.
 */
function bgPercent(value: unknown, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(0, Math.round(n)));
}

/**
 * The object-position and filter for a section's background picture.
 *
 * Focus drives object-position, so the part a client chose stays in view when
 * the section crops the picture. The three adjustments become a filter, and
 * because the background img sits UNDER the scrim and the content, darkening or
 * desaturating it never touches the words on top. A filter is emitted only for
 * an adjustment that is actually off its default, so an untouched picture
 * carries none.
 */
/**
 * The object-position and filter for a background picture, from a focus point
 * and three adjustments. Shared by the single background and by every slide of a
 * background slideshow, so each picture in a slideshow can be focused and toned
 * on its own rather than sharing one setting.
 */
function bgPictureStyle(source: {
  focusX?: number;
  focusY?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
}): CSSProperties {
  const focusX = bgPercent(source.focusX, 100, 50);
  const focusY = bgPercent(source.focusY, 100, 50);
  const brightness = bgPercent(source.brightness, 200, 100);
  const contrast = bgPercent(source.contrast, 200, 100);
  const saturation = bgPercent(source.saturation, 200, 100);

  const adjustments: string[] = [];
  if (brightness !== 100) adjustments.push(`brightness(${brightness}%)`);
  if (contrast !== 100) adjustments.push(`contrast(${contrast}%)`);
  if (saturation !== 100) adjustments.push(`saturate(${saturation}%)`);

  return {
    objectPosition: `${focusX}% ${focusY}%`,
    ...(adjustments.length ? { filter: adjustments.join(' ') } : {}),
  };
}

function backgroundStyle(section: Section): CSSProperties {
  return bgPictureStyle({
    focusX: section.backgroundFocusX,
    focusY: section.backgroundFocusY,
    brightness: section.backgroundBrightness,
    contrast: section.backgroundContrast,
    saturation: section.backgroundSaturation,
  });
}

/**
 * One shaped edge of a section.
 *
 * NOTHING AT ALL when the shape is 'none' or a name this build cannot draw, and
 * that second case is the forward-compatibility story: a section saved by a
 * newer build naming a shape added later renders a straight edge here rather
 * than an empty box or a crash.
 *
 * THE FILL IS `currentColor`, and app/globals.css sets that colour per tone on
 * this element. It has to be set rather than inherited: a dark section sets
 * `color` to its inverted text colour, so an inherited fill would draw the
 * divider in the text colour instead of the background one.
 *
 * preserveAspectRatio="none" is what lets one 1200-wide path stretch to any
 * section width while keeping the height it was given.
 */
function SectionDivider({
  edge,
  shape,
  height,
  fill,
  hang = false,
}: {
  edge: 'top' | 'bottom';
  shape: string | undefined;
  height: number | undefined;
  /** The colour of the section on the other side of this edge. */
  fill: string;
  /** Hang below the section instead: see SectionRenderer.hangBottomDivider. */
  hang?: boolean;
}): ReactElement | null {
  const name = safeDivider(shape);
  if (name === 'none') return null;

  const px = normaliseDividerHeight(height);

  /*
   * BLEND IS A FADE, NOT A SHAPE. The neighbour's colour fades to transparent
   * across the band, which lets THIS section's own background show through
   * beneath, colour or picture, so one section looks like it emerges from the
   * other. The direction is written per edge, so unlike the shapes it does not
   * reuse one path flipped, and it opts out of the CSS flip in globals.css.
   */
  if (name === BLEND_DIVIDER) {
    const gradient =
      edge === 'top'
        ? `linear-gradient(to bottom, ${fill}, transparent)`
        : `linear-gradient(to bottom, transparent, ${fill})`;
    return (
      <div
        className="tgs-section__divider tgs-section__divider--blend"
        data-edge={edge}
        aria-hidden="true"
        style={{ height: `${px}px`, background: gradient }}
      />
    );
  }

  const found = dividerShape(name);
  if (!found) return null;

  return (
    <div
      className="tgs-section__divider"
      data-edge={edge}
      data-hang={hang ? 'true' : undefined}
      aria-hidden="true"
      /*
       * THE COLOUR IS SET HERE RATHER THAN IN CSS, and it has to be. The value
       * comes from the section NEXT DOOR, which no selector can reach: CSS has
       * no previous-sibling combinator and, even for the next one, no way to
       * read another element's computed background into this one. It is also
       * why boxStyle's `--tgs-bg: transparent` cannot be used, since that is
       * emitted on every section whether a colour was chosen or not.
       */
      style={{ height: `${px}px`, color: fill }}
    >
      <svg viewBox="0 0 1200 100" preserveAspectRatio="none" focusable="false">
        <path d={found.path} />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

export function RowRenderer({
  row,
  sectionIndex,
  index,
  editable = false,
  editingPath = null,
  editorCanvas = false,
  prepared,
  sizes,
}: { row: Row; sectionIndex: number; index: number } & Editable): ReactElement {
  /*
   * The dragged widths become a single custom property, for example
   * "minmax(0, 37fr) minmax(0, 63fr)". CSS decides when to honour it: above
   * the stacking breakpoint it is the grid, below it the grid is 1fr and the
   * widths are ignored.
   *
   * FRACTIONS RATHER THAN PERCENTAGES, and the difference is a bug that shipped.
   * This wrote "37% 63%", and a percentage in a grid template resolves against
   * the WHOLE content box, so the gap between the columns was then added on top:
   * every multi-column row was wider than its own container by exactly the total
   * gap. Three columns 24px apart overhung by 48px, four by 72px, and the last
   * column in every card grid was clipped. Nobody saw a scrollbar because
   * `.tgs-page` sets `overflow-x: hidden`, which is a rule about a page never
   * scrolling sideways and quietly hid this as well. A fraction divides what is
   * LEFT after the gaps, which is what the widths meant all along.
   *
   * minmax(0, Nfr) rather than plain Nfr, because a bare fr track has an `auto`
   * minimum and a long unbroken word, a wide image or a table would push the
   * track past its share and put the overflow back.
   *
   * A custom property in the style attribute is not inline CSS in the sense
   * a CSP cares about, so this stays CSP clean with no style-src unsafe-inline.
   */
  const style = {
    '--tgs-cols': row.columns.map((column) => `minmax(0, ${column.width}fr)`).join(' '),
    '--tgs-gap': `${row.gap}px`,
  } as CSSProperties;

  return (
    <div
      className="tgs-row"
      style={style}
      data-stack={row.stackBelow}
      data-reverse={row.reverseOnStack ? 'true' : undefined}
      {...pathAttr(editable, `s${sectionIndex}r${index}`)}
    >
      {row.columns.map((column, columnIndex) => (
        <ColumnRenderer
          key={column.id}
          column={column}
          sectionIndex={sectionIndex}
          rowIndex={index}
          index={columnIndex}
          isLast={columnIndex === row.columns.length - 1}
          editable={editable}
          editingPath={editingPath}
          editorCanvas={editorCanvas}
          prepared={prepared}
          sizes={sizes}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A block on the canvas, and a container's inner columns
// ---------------------------------------------------------------------------

/**
 * One block's wrapper: its design box, its alignment, its data-path, and then
 * either the block's own drawing or, for a container, its inner columns. Shared
 * by an ordinary column and by a container's inner columns, so a block looks and
 * addresses the same wherever it sits. `keyPath` is the block's full data-path,
 * e.g. `s0r0c0b1` at the top level or `s0r0c0b1k0i2` inside a container.
 */
function blockHost(
  block: Block,
  keyPath: string,
  editable: boolean,
  editingPath: string | null,
  editorCanvas: boolean,
  prepared: PreparedMap | undefined,
  sizes: ImageSizes | undefined,
): ReactElement {
  const box = block.box ?? EMPTY_BOX;
  const boxed = !boxIsEmpty(box);
  const props = block.props as Record<string, unknown>;
  const textColour = safeColour(props?.textColour);
  // Text size, line spacing and letter spacing: the block's own base (desktop),
  // plus its per-screen twins. Each is an inline custom property the text element
  // reads ahead of its natural value; absent when unset, so a plain block renders
  // exactly as before. The twins for ALL THREE come from sizeVars, since
  // BLOCK_RESPONSIVE maps fontSize, lineHeight and letterSpacing together.
  const baseSize = normaliseTextSize(props?.fontSize);
  const baseLineHeight = normaliseLineHeight(props?.lineHeight);
  const baseLetterSpacing = normaliseLetterSpacing(props?.letterSpacing);
  const sizeVars = responsiveVars(block.responsive, BLOCK_RESPONSIVE);
  // Animated gradient heading: the letters filled with a moving gradient
  // (globals.css, background-clip: text). Heading only, and only on the published
  // page and in preview (data-gradient below), so the heading edits as ordinary
  // solid text on the canvas rather than transparent-filled where a caret would be
  // hard to see. The two colours are the client's own choice; each is validated,
  // and when blank the CSS falls back to a brand colour, so an existing gradient
  // heading with no colours set looks exactly as it did.
  const gradient = block.type === 'heading' && props?.gradient === true;
  const gradFrom = gradient ? safeColour(props?.gradientFrom) : undefined;
  const gradTo = gradient ? safeColour(props?.gradientTo) : undefined;
  const style: CSSProperties = {
    ...(boxed ? boxStyle(box) : {}),
    ...(textColour ? { color: textColour } : {}),
    ...(baseSize ? { '--tgs-fs': baseSize } : {}),
    ...(baseLineHeight ? { '--tgs-lh': baseLineHeight } : {}),
    ...(baseLetterSpacing ? { '--tgs-ls': baseLetterSpacing } : {}),
    ...(gradFrom ? { '--tgs-grad-a': gradFrom } : {}),
    ...(gradTo ? { '--tgs-grad-b': gradTo } : {}),
    ...sizeVars,
  };
  const styled =
    boxed ||
    Boolean(textColour) ||
    Boolean(baseLineHeight) ||
    Boolean(baseLetterSpacing) ||
    Boolean(baseSize) ||
    Boolean(gradFrom) ||
    Boolean(gradTo) ||
    Object.keys(sizeVars).length > 0;
  // Auto-resize: the text elements only. A block marked data-fluid swaps its
  // font-size for a clamp that scales with the screen (globals.css). It reads no
  // value from here, only the flag, so it composes with a size or a per-screen
  // override rather than replacing them.
  const fluid = (block.type === 'text' || block.type === 'heading') && props?.fluid === true;
  return (
    <div
      key={block.id}
      className="tgs-block"
      data-align={typeof block.props?.align === 'string' ? block.props.align : undefined}
      /*
       * Alignment per screen. Not a scalar folded through a custom property like
       * size and spacing are, because alignment drives three things at once (the
       * block's text-align, a paragraph's margin, a button row's justify), so it
       * cannot ride the --tgs-*-r chain. Instead the override screen rides its own
       * data attribute and the container queries in globals.css re-state it. Absent
       * when unset, so a block that never overrode reads exactly as before.
       */
      data-align-tablet={
        typeof block.responsive?.tablet?.align === 'string' ? block.responsive.tablet.align : undefined
      }
      data-align-phone={
        typeof block.responsive?.phone?.align === 'string' ? block.responsive.phone.align : undefined
      }
      /*
       * Hidden on some screens. Emitted only on the published page and in preview
       * (!editable), never while editing: a block you hid on this very screen has to
       * stay on the canvas so you can still select it and change your mind. The
       * container queries in globals.css do the hiding, one screen each.
       */
      data-hide-desktop={!editable && block.hideOn?.includes('desktop') ? '' : undefined}
      data-hide-tablet={!editable && block.hideOn?.includes('tablet') ? '' : undefined}
      data-hide-phone={!editable && block.hideOn?.includes('phone') ? '' : undefined}
      data-boxed={boxed ? '' : undefined}
      data-shadow={boxed ? box.shadow : undefined}
      data-fluid={fluid ? '' : undefined}
      data-gradient={gradient && !editable ? '' : undefined}
      style={styled ? style : undefined}
      {...pathAttr(editable, keyPath)}
    >
      {block.type === 'grid' ? (
        <InnerGrid
          cells={innerColumnsOf(block)}
          across={gridAcross(block)}
          gap={innerGap(block)}
          align={gridAlign(block)}
          keyPath={keyPath}
          editable={editable}
          editingPath={editingPath}
          editorCanvas={editorCanvas}
          prepared={prepared}
          sizes={sizes}
        />
      ) : block.type === 'container' ? (
        <InnerColumns
          columns={innerColumnsOf(block)}
          gap={innerGap(block)}
          stack={innerStack(block)}
          keyPath={keyPath}
          editable={editable}
          editingPath={editingPath}
          editorCanvas={editorCanvas}
          prepared={prepared}
          sizes={sizes}
        />
      ) : (
        <BlockRenderer
          block={block}
          editable={editable}
          editingHost={editable && editingPath === keyPath}
          editorCanvas={editorCanvas}
          prepared={prepared}
          sizes={sizes}
        />
      )}
    </div>
  );
}

/**
 * A container's own columns. The same row/column markup a section uses, so the
 * widths, the gap and the stacking come from the same CSS, only the data-path
 * carries the container's prefix so a click or a drop lands on the inner node.
 */
/**
 * A grid: cells that flow into a set number of tracks and wrap.
 *
 * WHY IT IS NOT InnerColumns WITH A FLAG. A container is one row whose columns
 * each carry a width you drag, and it either sits side by side or stacks. A grid
 * has no per-cell width at all: the tracks come from a count, the cells fall into
 * them in order, and a tenth cell in a three-across grid starts a fourth row on
 * its own. Two different layout models, so two components, and neither has to
 * carry a branch for the other.
 *
 * THE COUNTS ARE CUSTOM PROPERTIES, NOT CLASSES, so a client may choose any of
 * one to six per screen without the stylesheet carrying eighteen combinations.
 * The container queries in globals.css swap which of the three is in force, and
 * they key off .tgs-page, the same container the rest of the responsive work
 * uses, so the editor's tablet and phone previews are honest rather than being
 * a window-width guess.
 *
 * A CELL MAY SPAN more than one track, which is the thing a plain card grid
 * cannot do: a featured tile twice the width of its neighbours, still in the
 * grid. Clamped to the desktop count, because a cell spanning wider than the
 * grid would silently create a track nothing else can reach.
 */
function InnerGrid({
  cells,
  across,
  gap,
  align,
  keyPath,
  editable = false,
  editingPath = null,
  editorCanvas = false,
  prepared,
  sizes,
}: {
  cells: Column[];
  across: { desktop: number; tablet: number; phone: number };
  gap: number;
  align: 'top' | 'centre' | 'bottom' | 'stretch';
  keyPath: string;
} & Editable): ReactElement {
  const style = {
    '--tgs-grid-d': String(across.desktop),
    '--tgs-grid-t': String(across.tablet),
    '--tgs-grid-p': String(across.phone),
    '--tgs-gap': `${gap}px`,
  } as CSSProperties;

  /*
   * DEFENSIVE ABOUT THE CELL SHAPE, for the same reason InnerColumns is: an
   * inner column lives in a block's loose props bag, so a box or a blocks array
   * could arrive missing from a hand-authored tree in a way a section's column
   * never could. A published page must never throw over a stray grid.
   */
  const spanOf = (cell: Column): number => {
    const raw = (cell as { span?: unknown }).span;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 1) return 1;
    return Math.min(across.desktop, Math.max(1, Math.round(n)));
  };

  return (
    <div className="tgs-grid" style={style} data-align={align}>
      {cells.map((cell, inner) => {
        const cellPath = `${keyPath}k${inner}`;
        const box = cell.box ?? EMPTY_BOX;
        const blocks = Array.isArray(cell.blocks) ? cell.blocks : [];
        const span = spanOf(cell);
        return (
          <div
            key={cell.id ?? `cell-${inner}`}
            className="tgs-col tgs-grid__cell"
            data-shadow={box.shadow}
            style={span > 1 ? { ...boxStyle(box), '--tgs-span': String(span) } as CSSProperties : boxStyle(box)}
            {...pathAttr(editable, cellPath)}
          >
            {blocks.map((block, innerBlock) =>
              blockHost(block, `${cellPath}i${innerBlock}`, editable, editingPath, editorCanvas, prepared, sizes),
            )}

            {editable && blocks.length === 0 && (
              <div className="ed-empty-col">
                <button
                  type="button"
                  className="ed-empty-col__add"
                  data-add={cellPath}
                  aria-label="Add content to this cell"
                  title="Add content"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InnerColumns({
  columns,
  gap,
  stack,
  keyPath,
  editable = false,
  editingPath = null,
  editorCanvas = false,
  prepared,
  sizes,
}: {
  columns: Column[];
  gap: number;
  stack: 'always' | 'tablet' | 'mobile';
  keyPath: string;
} & Editable): ReactElement {
  /*
   * DEFENSIVE ABOUT THE COLUMN SHAPE, because an inner column is the one column
   * in the model the schema never validates: it lives in a block's loose props
   * bag, so a width, a box or a blocks array could arrive missing from a
   * hand-authored tree in a way a section's column never could. The save path
   * repairs and sanitises them, so this only guards the gap before a first save,
   * but a published page must never throw over a stray container.
   */
  const width = (column: Column, count: number): number =>
    typeof column.width === 'number' && Number.isFinite(column.width) ? column.width : 100 / Math.max(1, count);

  const style = {
    '--tgs-cols': columns.map((column) => `minmax(0, ${width(column, columns.length)}fr)`).join(' '),
    '--tgs-gap': `${gap}px`,
  } as CSSProperties;

  return (
    <div className="tgs-row tgs-inner-row" style={style} data-stack={stack}>
      {columns.map((column, inner) => {
        const colPath = `${keyPath}k${inner}`;
        const box = column.box ?? EMPTY_BOX;
        const blocks = Array.isArray(column.blocks) ? column.blocks : [];
        return (
          <div
            key={column.id ?? `col-${inner}`}
            className="tgs-col"
            data-align={column.align}
            data-shadow={box.shadow}
            style={boxStyle(box)}
            {...pathAttr(editable, colPath)}
          >
            {blocks.map((block, innerBlock) =>
              blockHost(block, `${colPath}i${innerBlock}`, editable, editingPath, editorCanvas, prepared, sizes),
            )}

            {editable && blocks.length === 0 && (
              <div className="ed-empty-col">
                <button
                  type="button"
                  className="ed-empty-col__add"
                  data-add={colPath}
                  aria-label="Add content to this column"
                  title="Add content"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            )}

            {/*
             * Drag the edge to resize the inner columns, the same handle a
             * section column has. The data-resize key names the CONTAINER
             * (a block path) rather than a row, which is how Canvas tells an
             * inner resize from an ordinary one. Sits at the end of every inner
             * column but the last, over the gap.
             */}
            {editable && inner < columns.length - 1 && (
              <div
                className="ed-resize"
                data-resize={`${keyPath}:${inner}`}
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize inner column ${inner + 1}`}
                tabIndex={0}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

export function ColumnRenderer({
  column,
  sectionIndex,
  rowIndex,
  index,
  isLast,
  editable = false,
  editingPath = null,
  editorCanvas = false,
  prepared,
  sizes,
}: {
  column: Column;
  sectionIndex: number;
  rowIndex: number;
  index: number;
  isLast: boolean;
} & Editable): ReactElement {
  const path = `s${sectionIndex}r${rowIndex}c${index}`;

  return (
    <div
      className="tgs-col"
      data-align={column.align}
      /* Only when it is not the default, so the attribute selector in
         globals.css does the work and a stacked column stays plain markup. */
      data-flow={column.flow === 'row' ? 'row' : undefined}
      data-shadow={column.box.shadow}
      style={boxStyle(column.box)}
      {...pathAttr(editable, path)}
    >
      {column.blocks.map((block, blockIndex) =>
        blockHost(block, `${path}b${blockIndex}`, editable, editingPath, editorCanvas, prepared, sizes),
      )}

      {/*
       * AN EMPTY COLUMN IS A COLUMN, NOT A BUTTON.
       *
       * The whole dashed area used to carry data-add, so clicking anywhere in an
       * empty column opened the block picker. That was right when a column had
       * nothing of its own to configure. It stopped being right on 30 Jul 2026,
       * when columns got padding presets and the rest of the style panel: a click
       * on a column now has to be able to mean "select this column", or the one
       * thing you cannot style is an empty one.
       *
       * So the dashed area is part of the column and selects it, and the plus in
       * the middle is the only thing that adds. Andy's call, and the same shape
       * every other builder uses.
       */
      editable && column.blocks.length === 0 && (
        <div className="ed-empty-col">
          <button
            type="button"
            className="ed-empty-col__add"
            data-add={path}
            aria-label="Add content to this column"
            title="Add content"
          >
            {/*
             * Inlined rather than imported from the editor's Icon set. This file
             * is deliberately dependency-light so it can be a server component on
             * the published side, and a static import of an editor component
             * would follow it into that bundle whether or not it renders. Same
             * 24x24 box and 2px round-capped stroke as the rest of the set.
             */}
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      )}

      {/*
       * A COLUMN WITH CONTENT CAN STILL BE ADDED TO.
       *
       * The plus adds another block at the end, where the next one goes. It only
       * exists while editing, and only shows once the column (or a block in it) is
       * selected, so it does not clutter the canvas as the pointer crosses it (the
       * reveal lives in editor.css).
       *
       * There used to be a "Column" label beside it that doubled as a click target
       * to select the column. It is gone (14 Aug 2026, Andy): the selection ring
       * says what you are in, and a column is selected from the outline's side label
       * or by clicking its own spacing on the canvas.
       */}
      {editable && column.blocks.length > 0 && (
        <button
          type="button"
          className="ed-col-append"
          data-add={path}
          aria-label="Add more content to this column"
          title="Add content"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      {/*
       * The resize handle sits at the END of every column except the last,
       * absolutely positioned over the gap. Rendering it inside the column
       * rather than between columns keeps the grid to exactly one child per
       * column, so --tgs-cols still lines up.
       */}
      {editable && !isLast && (
        <div
          className="ed-resize"
          data-resize={`s${sectionIndex}r${rowIndex}:${index}`}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize column ${index + 1}`}
          tabIndex={0}
        />
      )}
    </div>
  );
}
