/**
 * Seven choices in, a whole palette out.
 *
 * This is where a client's brand colour becomes a border colour, a muted
 * caption, a hover state and a readable button label. It is deliberately the
 * only place any of that is decided, so the rules are in one file and a change
 * to them changes every site at once.
 *
 * THE RULES, AND WHY EACH ONE
 *
 * Derive from the page, not from a constant. Borders and alternating bands are
 * the page background nudged towards the text colour, so a site on a warm cream
 * gets warm hairlines rather than the same cool grey as a site on white. A fixed
 * #e2e8f0 looks fine on white and looks like a mistake on anything else.
 *
 * Measure contrast, never assume it. The label on a brand-coloured button is
 * chosen by which of white or near-black actually reads on it. Muted text is
 * faded towards the background and then pushed back until it clears 4.5:1,
 * because "70% opacity" is how a theme ends up with unreadable captions.
 *
 * Emit as custom properties on an element, never as a stylesheet. No <style>
 * tag and no style-src unsafe-inline, and it means the editor canvas can carry
 * a client's theme with the same object the published page uses. Custom
 * properties in a style attribute are already how column widths reach the grid,
 * so this is the existing mechanism rather than a new one.
 */

import type { CSSProperties } from 'react';

import {
  contrastRatio,
  deepenUntilTextFits,
  fadeButKeepReadable,
  mix,
  nudgeUntilReadable,
  readableOn,
} from './colour';
import { resolveStack, typographyTokens, type LibraryFont } from './fonts';
import { CORNERS, type Theme } from './schema';

/**
 * How far a derived colour travels from the page background.
 *
 * Named rather than inline, because these are the numbers somebody will want to
 * adjust after looking at a real site, and hunting them through the function
 * below is how you end up adjusting only three of the five.
 *
 * They are not arbitrary. Each was solved for against the hand-tuned palette
 * that was in globals.css before themes existed, so the default theme
 * reproduces the look Travelgenix already had rather than shifting every
 * unthemed site on deploy. The first draft used round numbers and put muted
 * text at 4.8:1 where the hand-tuned value had 7.5:1, which is legal and
 * noticeably worse: the sort of regression nobody reports and everybody feels.
 */
const NUDGE = {
  /** The faint band on an alternating section. Barely there on purpose. */
  surfaceAlt: 0.03,
  /** A hairline. Visible, not drawn. */
  border: 0.12,
  /** A hairline that is doing real work, like a field outline. */
  borderStrong: 0.22,
  /**
   * Secondary text, before the contrast check pushes it back.
   *
   * Kept conservative so the check below is a safety net rather than a routine
   * correction. If this were aggressive enough to trip the nudge on ordinary
   * themes, the nudge would be doing the design and every site would end up
   * with muted text at exactly 4.5:1.
   */
  muted: 0.26,
  /** The lighter brand, for a hover or a gradient. */
  brandLight: 0.14,
  /** The darker brand, for the dark band a section can sit on. */
  brandDark: 0.55,
} as const;

/** Body text has to clear this against the page. Non negotiable. */
const BODY_CONTRAST = 4.5;

/*
 * The dark band is held to a HIGHER bar than its own text needs, and that is
 * deliberate headroom rather than caution.
 *
 * Deepening only until white text reaches 4.5:1 leaves the band sitting exactly
 * on the boundary, which means nothing else can sit on it: an accent link on
 * that band has to be essentially white to pass, so a client's teal or gold
 * gets washed out to nearly nothing. A band at 7:1 gives every other colour
 * that lands on it somewhere to go.
 *
 * It costs nothing on a brand that was already dark. Travelgenix navy darkens
 * to 18:1 and the loop exits on its first check.
 */
const BAND_CONTRAST = 7;

/**
 * How far muted text fades on a COLOURED band, and how strong its hairline is.
 *
 * Separate numbers from the page ones above. On a dark or brand background the
 * eye tolerates far less fade before text stops reading, so the same 0.26 that
 * looks right on white looks broken on navy.
 */
const ON_COLOUR = { muted: 0.34, border: 0.18 } as const;

export interface ThemeTokens {
  /** Ready to spread onto any element's style prop. */
  style: CSSProperties;
  /** What the derivation worked out, for the editor to show and check. */
  derived: {
    onBrand: string;
    onAccent: string;
    brandLight: string;
    brandDark: string;
    surfaceAlt: string;
    border: string;
    textMuted: string;
  };
}

/**
 * A theme as custom properties.
 *
 * Only the tokens a theme actually changes are emitted. The spacing scale, the
 * type scale and the layout widths stay in globals.css, because they are the
 * product's rhythm rather than a client's brand, and a client who could set
 * them would be able to break the 4px grid the whole thing is built on.
 */
export function themeTokens(theme: Theme, library: LibraryFont[] = []): ThemeTokens {
  const page = theme.pageBackground;

  // Text first: everything else is measured against the pair of page and text.
  const text = nudgeUntilReadable(theme.text, page, BODY_CONTRAST).colour;

  /*
   * Muted text: faded towards the page, and never past the point of reading.
   *
   * Both halves matter. Fading alone gives the visual hierarchy and can land
   * anywhere from 3:1 to 8:1 depending on how far apart the client's two
   * colours are. Backing off costs a little of the hierarchy on a low contrast
   * theme and guarantees it is still legible, which is the right way round: a
   * caption that looks slightly too dark is a design opinion, one nobody can
   * read is a defect.
   */
  /*
   * The override, when set, replaces the STARTING POINT, never the guard: a
   * muted colour the client chose is still nudged until it reads on the page,
   * and a derived one behaves exactly as before. Same shape for the two band
   * overrides below. The opt-in dark palette (darkThemeTokens) keeps deriving
   * from first principles: these overrides describe the light world.
   */
  const textMuted = theme.textMuted
    ? nudgeUntilReadable(theme.textMuted, page, BODY_CONTRAST).colour
    : fadeButKeepReadable(text, page, NUDGE.muted, BODY_CONTRAST);

  const brandLight = mix(theme.brand, '#ffffff', NUDGE.brandLight);

  /*
   * The dark band, darkened until light text actually fits on it.
   *
   * A plain mix towards black is not enough. A client whose brand is white, or
   * any mid tone, gets a mid grey band, and a mid grey is the one region of the
   * colour space where neither white nor near-black reaches 4.5:1. The band
   * then ships with 4:1 headings on it. Deepening until it measures right costs
   * nothing on a brand that was already dark, because the loop exits at once.
   */
  const brandDark = deepenUntilTextFits(
    theme.surfaceDark || mix(theme.brand, '#000000', NUDGE.brandDark),
    BAND_CONTRAST,
  );

  const onBrand = readableOn(theme.brand);
  const onAccent = readableOn(theme.accent);

  const surfaceAlt =
    theme.surfaceAlt && contrastRatio(text, theme.surfaceAlt) >= BODY_CONTRAST
      ? theme.surfaceAlt
      : mix(page, text, NUDGE.surfaceAlt);
  const border = mix(page, text, NUDGE.border);
  const borderStrong = mix(page, text, NUDGE.borderStrong);

  const corners = CORNERS[theme.corners];

  /*
   * The two coloured bands a section can sit on, each with its own readable
   * text, muted text and hairline.
   *
   * These exist because globals.css had them hardcoded: #94a3b8 muted on the
   * dark band, #c7d2e5 muted on the brand band, #1e293b for the hairline. Fixed
   * slate values on a background that is now the client's colour, so a site
   * themed in burgundy got cool grey captions inside its brand-coloured
   * sections. Every one of them is measured against the band it actually sits
   * on, which is the only way the answer stays right for a colour nobody has
   * seen yet.
   */
  const onDark = readableOn(brandDark);
  const darkMuted = fadeButKeepReadable(onDark, brandDark, ON_COLOUR.muted, BODY_CONTRAST);
  const brandMuted = fadeButKeepReadable(onBrand, theme.brand, ON_COLOUR.muted, BODY_CONTRAST);

  /*
   * The accent, made to read on each coloured band.
   *
   * The accent is not only a fill. Inside a dark or brand section it is the
   * colour of a link and of a ghost button's label, so it is TEXT there, and
   * the client chose it to look right on their page rather than on a band they
   * have not thought about. A teal accent on a dark olive band is invisible,
   * which is exactly what a gold brand produced the first time this was
   * screenshotted.
   *
   * Same failure as the muted text above and the button label before that:
   * a colour used on a background nobody measured it against. Lightened or
   * darkened just enough to clear body-text contrast, so it stays recognisably
   * the accent.
   */
  const accentOnDark = nudgeUntilReadable(theme.accent, brandDark, BODY_CONTRAST).colour;
  const accentOnBrand = nudgeUntilReadable(theme.accent, theme.brand, BODY_CONTRAST).colour;

  const style = {
    '--tgs-primary': theme.brand,
    '--tgs-primary-light': brandLight,
    '--tgs-accent': theme.accent,

    '--tgs-surface': page,
    '--tgs-surface-alt': surfaceAlt,
    // The dark band. A darkened brand rather than a fixed near-black, so a
    // dark-tone section reads as the client's colour rather than as ours.
    '--tgs-surface-dark': brandDark,

    '--tgs-text': text,
    '--tgs-text-muted': textMuted,
    // Text ON the dark band, which is the darkened brand and not the page, so
    // it gets its own measurement.
    '--tgs-text-invert': onDark,

    '--tgs-border': border,
    '--tgs-border-strong': borderStrong,

    // Labels on a coloured surface. New tokens, and the reason the button in
    // globals.css can stop hardcoding white.
    '--tgs-on-primary': onBrand,
    '--tgs-on-accent': onAccent,

    // Inside a dark-tone section.
    '--tgs-on-dark-muted': darkMuted,
    '--tgs-on-dark-accent': accentOnDark,
    '--tgs-on-dark-border': mix(brandDark, onDark, ON_COLOUR.border),

    // Inside a brand-tone section. Its background is --tgs-primary, so its text
    // is measured against the brand, NOT against the dark band. Getting that
    // wrong is how a pale brand ends up with white text on it.
    '--tgs-on-primary-muted': brandMuted,
    '--tgs-on-primary-accent': accentOnBrand,
    '--tgs-on-primary-border': mix(theme.brand, onBrand, ON_COLOUR.border),

    '--tgs-radius-sm': `${corners.sm}px`,
    '--tgs-radius-md': `${corners.md}px`,
    '--tgs-radius-lg': `${corners.lg}px`,

    /*
     * The typography half, five tokens per style across seven styles.
     *
     * Merged here rather than emitted separately so a caller has one object to
     * put on one element. Splitting them would mean every screen and every route
     * remembering to spread both, and forgetting the second one would give a
     * page the right colours in the wrong typeface.
     */
    ...typographyTokens(theme.typography, library),
    /*
     * The data typeface, only when the theme names one. Consumers say
     * `font-family: var(--tgs-font-data, inherit)`, so a site with no data
     * font renders byte for byte as before, and one with it (a plotting-room
     * mono, a tabular grotesk) gets it exactly where data lives: key numbers
     * and card labels today, more slots as they earn it.
     */
    ...(theme.dataFamily
      ? { '--tgs-font-data': resolveStack(theme.dataFamily, library, theme.typography.p.family) }
      : {}),
  } as CSSProperties;

  return {
    style,
    derived: { onBrand, onAccent, brandLight, brandDark, surfaceAlt, border, textMuted },
  };
}

// ---------------------------------------------------------------------------
// The dark palette, for a site that carries a Light / dark switch
// ---------------------------------------------------------------------------

/**
 * A dark version of the six tokens that carry the SENSE of light or dark: the
 * page, the panels, the body text, the captions and the two hairlines. Emitted
 * as a parallel `--tgs-d-*` set that globals.css swaps in when the site is dark,
 * so the same one theme object serves both looks.
 *
 * WHY ONLY SIX. The brand, the accent and the two coloured bands are the
 * client's chosen colours and read the same in either mode: a gold button is
 * gold at night. Flipping them would be inventing a second brand nobody picked.
 * So a button, a dark-tone band and an accent link are untouched, and only the
 * canvas around them turns over. The tone sections set their own text and border
 * on themselves, so those keep winning for their own subtree (see the tone rules
 * and the !important note in globals.css).
 *
 * BUILT LIKE THE LIGHT ONE, not inverted. A straight invert of a warm cream
 * theme gives a cold blue-black that has nothing to do with the brand. Instead
 * the page is a near-black warmed by a trace of the brand, and the text a
 * near-white with the same trace, so the client's site still feels like theirs
 * after dark. Contrast is guaranteed by anchoring to near-black and near-white
 * and then measured back the same way the light tokens are, so a bright brand
 * cannot produce an unreadable caption.
 *
 * OPT IN, ALWAYS. This is emitted only when a page actually holds a switch (see
 * hasThemeToggle and page.tsx), so a site without one is never handed a dark
 * palette and never responds to a visitor's system preference. That is the whole
 * safety property: turning on system-wide dark mode must not silently restyle
 * every existing client site.
 */
export function darkThemeTokens(theme: Theme): Record<string, string> {
  const brand = theme.brand;

  // A near-black page, warmed by a trace of the brand so it reads as the client's
  // site after dark rather than a generic charcoal.
  const surface = mix('#0d0f14', brand, 0.07);
  // A panel lifted a touch off the page: cards, image frames, the menu drop-down.
  const surfaceAlt = mix(surface, '#ffffff', 0.06);

  // Near-white text with the same trace of brand, pushed back until it clears
  // body contrast on the page. On a near-black it clears at once, so the nudge is
  // the safety net it is in the light palette, not a routine correction.
  const text = nudgeUntilReadable(mix('#f6f8fc', brand, 0.05), surface, BODY_CONTRAST).colour;
  const textMuted = fadeButKeepReadable(text, surface, 0.34, BODY_CONTRAST);

  const border = mix(surface, text, 0.16);
  const borderStrong = mix(surface, text, 0.28);

  return {
    '--tgs-d-surface': surface,
    '--tgs-d-surface-alt': surfaceAlt,
    '--tgs-d-text': text,
    '--tgs-d-text-muted': textMuted,
    '--tgs-d-border': border,
    '--tgs-d-border-strong': borderStrong,
  };
}

// ---------------------------------------------------------------------------
// Telling somebody their theme has a problem
// ---------------------------------------------------------------------------

export interface ThemeWarning {
  /** Which setting to point at. */
  field: 'brand' | 'accent' | 'text' | 'pageBackground';
  message: string;
  /** The measured ratio, so the message can be specific rather than vague. */
  ratio: number;
  needs: number;
}

/**
 * What is wrong with this combination, if anything.
 *
 * SHOWN, NOT ENFORCED. A client who wants a pale grey brand colour gets to have
 * one; it is their business and their brand, and a builder that refuses to
 * accept a colour is a builder they stop using. What it must not do is let them
 * ship something unreadable without knowing.
 *
 * Where a fix is automatic, the warning says so rather than asking them to do
 * it. Body text that fails is darkened for them by themeTokens, so the warning
 * on `text` is an explanation of a change that has already happened, not a
 * request. Brand contrast cannot be fixed for them, because moving a brand
 * colour is not ours to do.
 */
export function themeWarnings(theme: Theme): ThemeWarning[] {
  const warnings: ThemeWarning[] = [];
  const page = theme.pageBackground;

  const textRatio = contrastRatio(theme.text, page);
  if (textRatio < BODY_CONTRAST) {
    warnings.push({
      field: 'text',
      ratio: textRatio,
      needs: BODY_CONTRAST,
      message:
        `Your text colour only reaches ${textRatio}:1 against the page background, ` +
        `and body text needs ${BODY_CONTRAST}:1. It has been darkened enough to read. ` +
        'Pick a darker text colour or a lighter page to keep the exact shade you wanted.',
    });
  }

  /*
   * 3:1 for the brand, not 4.5:1.
   *
   * The brand colour is used for buttons, links and large headings, and 3:1 is
   * the standard for a UI control boundary and for text at 24px. Holding it to
   * the body text threshold would reject a lot of perfectly usable brands,
   * which is the kind of false alarm that teaches people to ignore warnings.
   */
  const brandRatio = contrastRatio(theme.brand, page);
  if (brandRatio < 3) {
    warnings.push({
      field: 'brand',
      ratio: brandRatio,
      needs: 3,
      message:
        `Your brand colour only reaches ${brandRatio}:1 against the page background. ` +
        'Buttons and links in it will be hard to pick out. It still works as a ' +
        'background colour with a light label on it.',
    });
  }

  const accentRatio = contrastRatio(theme.accent, page);
  if (accentRatio < 3) {
    warnings.push({
      field: 'accent',
      ratio: accentRatio,
      needs: 3,
      message:
        `Your accent colour only reaches ${accentRatio}:1 against the page background, ` +
        'so anything small in it will be hard to see. Best kept for filled shapes ' +
        'rather than text.',
    });
  }

  return warnings;
}
