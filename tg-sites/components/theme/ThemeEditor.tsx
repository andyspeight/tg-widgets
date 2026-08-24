'use client';

/**
 * The theme screen. Colour, type, and the font library.
 *
 * TABS, because it outgrew a column. Colour is four fields; type is seven styles
 * times five properties; fonts is a searchable list of 1941 families plus an
 * upload form. Stacked in one scroll that is a screen nobody reaches the bottom
 * of, and the three jobs are genuinely separate: you pick colours once, set type
 * once, and come back to fonts when a client sends their brand pack.
 *
 * WHY THE PREVIEW CHANGES WITH THE TAB
 *
 * A preview should show the thing being changed. On the colour tab that is a
 * small page, because colour is about how bands and buttons sit against each
 * other. On the type tab it is a specimen of all seven styles at full size,
 * because type is about the relationship between them and a mini page shows
 * three of the seven. Showing the same thing for both means showing the wrong
 * thing for one of them.
 */

import { useEffect, useMemo, useState, useTransition } from 'react';

import { saveThemeAction } from '../../app/actions/theme';
import type { FontFamily } from '../../lib/db/fonts';
import { contrastRatio, normaliseHex } from '../../lib/theme/colour';
import { FALLBACK_STACK, resolveStack, type LibraryFont } from '../../lib/theme/fonts';
import { CORNERS, CORNER_IDS, FONTS, FONT_IDS, parseTheme, type Theme } from '../../lib/theme/schema';
import { themeTokens, themeWarnings } from '../../lib/theme/tokens';
import {
  TEXT_STYLES,
  TEXT_STYLE_LABEL,
  type TextStyle,
  type TextStyleId,
} from '../../lib/theme/typography';
import { Icon } from '../editor/Icon';
import { FontSelect, type FontOption } from './FontSelect';
import { FontsPanel } from './FontsPanel';
import { TypePanel } from './TypePanel';
import './theme.css';

const CHROME_KEY = 'tg-sites:theme:v1';

type Tab = 'colour' | 'type' | 'fonts';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'colour', label: 'Colour' },
  { id: 'type', label: 'Type' },
  { id: 'fonts', label: 'Fonts' },
];

interface Props {
  siteName: string;
  initial: Theme;
  initialFonts: FontFamily[];
}

type ColourField = 'brand' | 'accent' | 'pageBackground' | 'text';

/*
 * The three derived colours a brand may claim. `derived` reads the current
 * automatic value (for the swatch, and as the starting point when claiming),
 * and `against` names what the contrast readout compares with.
 */
const ADVANCED_FIELDS: Array<{
  key: 'surfaceDark' | 'surfaceAlt' | 'textMuted';
  label: string;
  help: string;
  derived: (d: { brandDark: string; surfaceAlt: string; textMuted: string }) => string;
  against: (theme: Theme) => string;
  againstLabel: string;
}> = [
  {
    key: 'surfaceDark',
    label: 'Dark band',
    help: 'The colour behind dark sections, the header and the footer.',
    derived: (d) => d.brandDark,
    against: (theme) => theme.pageBackground,
    againstLabel: 'the page',
  },
  {
    key: 'surfaceAlt',
    label: 'Faint band',
    help: 'The alternating band behind quieter sections.',
    derived: (d) => d.surfaceAlt,
    against: (theme) => theme.text,
    againstLabel: 'text',
  },
  {
    key: 'textMuted',
    label: 'Quiet text',
    help: 'Captions, hints and second-rank copy.',
    derived: (d) => d.textMuted,
    against: (theme) => theme.pageBackground,
    againstLabel: 'the page',
  },
];

const COLOUR_FIELDS: Array<{ key: ColourField; label: string; help: string }> = [
  { key: 'brand', label: 'Brand colour', help: 'Buttons, links, and the coloured bands between sections.' },
  { key: 'accent', label: 'Accent colour', help: 'Highlights and second-choice actions. Used sparingly.' },
  { key: 'pageBackground', label: 'Page background', help: 'Usually white. A very pale tint reads as warmer.' },
  { key: 'text', label: 'Text colour', help: 'Body copy. Everything else in the type palette is worked out from it.' },
];

const SAMPLE: Record<TextStyleId, string> = {
  h1: 'Ten nights in the Maldives',
  h2: 'Why book with us',
  h3: 'Overwater villas and a private reef',
  h4: 'What is included',
  h5: 'Flights, transfers and the hotel',
  h6: 'Prices per person, two sharing',
  p: 'Talk to someone who has actually been. We build the trip around how you like to travel, then we are on the end of the phone while you are away.',
};

export function ThemeEditor({ siteName, initial, initialFonts }: Props) {
  const [theme, setTheme] = useState<Theme>(initial);
  const [saved, setSaved] = useState<Theme>(initial);
  const [library, setLibrary] = useState<FontFamily[]>(initialFonts);
  const [tab, setTab] = useState<Tab>('colour');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [chrome, setChrome] = useState<'light' | 'dark' | 'system'>('light');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHROME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') setChrome(stored);
    } catch {
      // Storage blocked. Light is a fine place to stay.
    }
  }, []);

  const fonts: LibraryFont[] = useMemo(
    () =>
      library.map((font) => ({
        slug: font.slug,
        family: font.family,
        fallback: font.fallback,
        weights: font.weights,
      })),
    [library],
  );

  const tokens = useMemo(() => themeTokens(theme, fonts), [theme, fonts]);

  /* The same grouped list the type styles offer, with "inherit" at the top. */
  const dataFontOptions: FontOption[] = useMemo(
    () => [
      { value: '', label: 'Same as the surrounding text', stack: 'inherit', group: 'Automatic' },
      ...library.map((font) => ({
        value: font.slug,
        label: font.family,
        stack: `'${font.family}', ${FALLBACK_STACK[font.fallback]}`,
        group: 'Your fonts',
      })),
      ...FONT_IDS.map((id) => ({
        value: id,
        label: FONTS[id].label,
        stack: FONTS[id].stack,
        group: 'Already on every device',
      })),
    ],
    [library],
  );
  const warnings = useMemo(() => themeWarnings(theme), [theme]);

  /*
   * Compared as JSON rather than field by field.
   *
   * The theme is now nested: seven styles of five properties each, under the
   * colours. A per-key comparison would have to recurse, and the version that
   * did not recurse would call a size change "saved" and quietly lose it.
   */
  const dirty = useMemo(() => JSON.stringify(theme) !== JSON.stringify(saved), [theme, saved]);

  function set<K extends keyof Theme>(key: K, value: Theme[K]) {
    setMessage(null);
    setTheme((current) => ({ ...current, [key]: value }));
  }

  function setStyle(id: TextStyleId, changes: Partial<TextStyle>) {
    setMessage(null);
    setTheme((current) => ({
      ...current,
      typography: { ...current.typography, [id]: { ...current.typography[id], ...changes } },
    }));
  }

  /** Every heading at once, which is the first thing anybody wants to do. */
  function setAllHeadings(changes: Partial<TextStyle>) {
    setMessage(null);
    setTheme((current) => {
      const next = { ...current.typography };
      for (const id of TEXT_STYLES) {
        if (id === 'p') continue;
        next[id] = { ...next[id], ...changes };
      }
      return { ...current, typography: next };
    });
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveThemeAction(theme);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      // What was stored, not what was sent. If the schema clamped anything the
      // screen should show the truth.
      setTheme(result.data);
      setSaved(result.data);
    });
  }

  const warningFor = (field: ColourField) => warnings.find((w) => w.field === field)?.message;

  return (
    <div className="sv-root tv-root" data-theme={chrome}>
      <div className="tv-wrap">
        <header className="tv-head">
          <div>
            <p className="sv-eyebrow">Theme</p>
            <h1 className="sv-title">{siteName}</h1>
            <p className="sv-url">
              Four colours, seven text styles, and whichever typefaces you want.
            </p>
          </div>
          <a className="sv-btn" href="/sites">
            Back to pages
          </a>
        </header>

        {message && (
          <p className="sv-msg" role="alert">
            <Icon name="warning" size={16} />
            {message}
          </p>
        )}

        <div className="tv-tabs" role="tablist" aria-label="Theme sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className="tv-tab"
              data-selected={tab === entry.id ? 'true' : undefined}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {entry.id === 'fonts' && library.length > 0 && (
                <span className="fp-count">{library.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="tv-grid">
          <div className="tv-controls">
            {tab === 'colour' && (
              <>
                <section className="tv-group">
                  <h2 className="tv-group__title">Colour</h2>
                  {COLOUR_FIELDS.map((field) => (
                    <ColourRow
                      key={field.key}
                      label={field.label}
                      help={field.help}
                      value={theme[field.key]}
                      against={field.key === 'pageBackground' ? theme.text : theme.pageBackground}
                      againstLabel={field.key === 'pageBackground' ? 'text' : 'the page'}
                      warning={warningFor(field.key)}
                      onChange={(hex) => set(field.key, hex)}
                    />
                  ))}
                </section>

                <section className="tv-group">
                  <h2 className="tv-group__title">Corners</h2>
                  <div className="tv-corners" role="radiogroup" aria-label="Corner style">
                    {CORNER_IDS.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="tv-corner"
                        role="radio"
                        aria-checked={theme.corners === id}
                        data-selected={theme.corners === id ? 'true' : undefined}
                        onClick={() => set('corners', id)}
                      >
                        <span
                          className="tv-corner__shape"
                          style={{ borderRadius: CORNERS[id].md }}
                          aria-hidden="true"
                        />
                        {CORNERS[id].label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="tv-group">
                  <h2 className="tv-group__title">Worked out for you</h2>
                  <p className="tv-note">
                    From the four colours above, each checked for contrast against
                    whatever it sits on. Three of them can be claimed below when a
                    brand has its own exact values.
                  </p>
                  <ul className="tv-derived">
                    <Derived label="Button label" colour={tokens.derived.onBrand} on={theme.brand} />
                    <Derived label="Brand hover" colour={tokens.derived.brandLight} on={theme.pageBackground} />
                    <Derived label="Dark band" colour={tokens.derived.brandDark} on={theme.pageBackground} />
                    <Derived label="Quiet text" colour={tokens.derived.textMuted} on={theme.pageBackground} />
                    <Derived label="Hairline" colour={tokens.derived.border} on={theme.pageBackground} />
                    <Derived label="Faint band" colour={tokens.derived.surfaceAlt} on={theme.pageBackground} />
                  </ul>
                </section>

                <section className="tv-group">
                  <h2 className="tv-group__title">Claimed by the brand</h2>
                  <p className="tv-note">
                    A brand book sometimes has exact values for these three. Claim
                    one and the derivation steps aside for it; the contrast checks
                    stay either way, so a claimed colour that would break its text
                    is quietly corrected towards one that reads.
                  </p>
                  {ADVANCED_FIELDS.map((field) => {
                    const claimed = theme[field.key];
                    if (!claimed) {
                      return (
                        <div key={field.key} className="tv-claim">
                          <span
                            className="tv-claim__swatch"
                            style={{ background: field.derived(tokens.derived) }}
                            aria-hidden="true"
                          />
                          <span className="tv-claim__label">{field.label}</span>
                          <button
                            type="button"
                            className="tg-btn"
                            data-variant="ghost"
                            onClick={() => set(field.key, field.derived(tokens.derived))}
                          >
                            Claim it
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div key={field.key} className="tv-claimed">
                        <ColourRow
                          label={field.label}
                          help={field.help}
                          value={claimed}
                          against={field.against(theme)}
                          againstLabel={field.againstLabel}
                          onChange={(hex) => set(field.key, hex)}
                        />
                        <button
                          type="button"
                          className="tg-btn"
                          data-variant="ghost"
                          onClick={() => set(field.key, '')}
                        >
                          Back to automatic
                        </button>
                      </div>
                    );
                  })}
                </section>
              </>
            )}

            {tab === 'type' && (
              <>
                <TypePanel
                  typography={theme.typography}
                  library={library}
                  onChange={setStyle}
                  onSetAllHeadings={setAllHeadings}
                />

                <section className="tv-group">
                  <h2 className="tv-group__title" id="tv-data-font">
                    The data typeface
                  </h2>
                  <p className="tv-note">
                    Day numbers, fares, key figures and card labels. A world that
                    wants a plotting-room mono for its data sets it here; left
                    alone, data dresses like the text around it.
                  </p>
                  <FontSelect
                    id="tv-data-font-select"
                    value={theme.dataFamily}
                    options={dataFontOptions}
                    onChange={(value) => set('dataFamily', value)}
                    placeholder="Same as the surrounding text"
                    labelledBy="tv-data-font"
                  />
                </section>
              </>
            )}

            {tab === 'fonts' && (
              <FontsPanel library={library} onLibraryChange={setLibrary} />
            )}
          </div>

          {/* ------------------------------------------------------------ */}
          <div className="tv-preview">
            <p className="tv-preview__label">
              {tab === 'type' ? 'Your text styles' : 'Your site, as a visitor sees it'}
            </p>

            {/*
              The theme tokens go on this element, exactly as they go on the page
              element of a published site. Same object, same mechanism.
            */}
            <div className="tv-frame tgs-page" style={tokens.style}>
              {tab === 'type' ? <Specimen theme={theme} fonts={fonts} /> : <SitePreview />}
            </div>
          </div>
        </div>
      </div>

      <div className="tv-bar" data-dirty={dirty ? 'true' : undefined}>
        <span className="tv-bar__state">{dirty ? 'Not saved yet' : 'Saved'}</span>

        <button
          type="button"
          className="tg-btn"
          disabled={busy || !dirty}
          onClick={() => {
            setMessage(null);
            setTheme(saved);
          }}
        >
          Discard changes
        </button>

        <button
          type="button"
          className="tg-btn"
          disabled={busy}
          onClick={() => {
            setMessage(null);
            // parseTheme({}) fills every field from the defaults, so this cannot
            // drift from them the way listing them here would.
            setTheme(parseTheme({}));
          }}
        >
          Travelgenix defaults
        </button>

        <button
          type="button"
          className="tg-btn"
          data-variant="primary"
          disabled={busy || !dirty}
          onClick={save}
        >
          {busy ? 'Saving' : 'Save theme'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * All seven styles at their real size, in order.
 *
 * At FULL size, not scaled. The list in the type panel is scaled because it has
 * to fit seven rows in a sidebar; this is the place to find out that a 64px H1 is
 * too big for the space it will occupy. Scaling here would make the preview agree
 * with the control and disagree with the site.
 */
function Specimen({ theme, fonts }: { theme: Theme; fonts: LibraryFont[] }) {
  return (
    <div className="tv-specimen">
      {TEXT_STYLES.map((id) => {
        const style = theme.typography[id];
        return (
          <div className="tv-specimen__row" key={id}>
            <p className="tv-specimen__tag">
              {TEXT_STYLE_LABEL[id]}
              <span className="tv-specimen__spec">
                {style.size}px · {style.weight} · {style.lineHeight}
              </span>
            </p>
            <p
              className="tv-specimen__sample"
              style={{
                fontFamily: resolveStack(style.family, fonts, theme.typography.p.family),
                fontWeight: style.weight,
                fontSize: `${style.size}px`,
                lineHeight: style.lineHeight,
                letterSpacing: `${style.tracking / 100}em`,
              }}
            >
              {SAMPLE[id]}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A small page, using the real .tgs-* classes so the colours are honest.
 *
 * Shows the things that go wrong rather than the things that look nice: a filled
 * button whose label has to be legible, muted text that can vanish, a hairline
 * that can disappear, and both coloured bands.
 */
function SitePreview() {
  return (
    <>
      <section className="tgs-section" data-tone="dark" data-width="contained">
        <div className="tgs-section__inner tv-demo">
          <h2 className="tgs-heading" data-style="h2">
            Ten nights in the Maldives
          </h2>
          <p className="tgs-text">
            Overwater villas, seaplane transfers and a private reef, from March
            through to October.
          </p>
          <p className="tv-demo__row">
            <span className="tgs-button" data-variant="primary" data-size="s">
              See the offer
            </span>
            <span className="tgs-button" data-variant="ghost" data-size="s">
              Ask a question
            </span>
          </p>
        </div>
      </section>

      <section className="tgs-section" data-width="contained">
        <div className="tgs-section__inner tv-demo">
          <h2 className="tgs-heading" data-style="h2">
            Why book with us
          </h2>
          <p className="tgs-text">
            Thirty years of arranging this exact trip, and one person looking
            after yours from the first call to the last transfer.
          </p>
          <p className="tv-demo__quiet">
            ATOL protected. Prices per person, based on two sharing.
          </p>
          <hr className="tv-demo__rule" />
          <p className="tv-demo__row">
            <span className="tgs-button" data-variant="primary" data-size="s">
              Get a quote
            </span>
            <span className="tgs-button" data-variant="secondary" data-size="s">
              Brochure
            </span>
          </p>
        </div>
      </section>

      <section className="tgs-section" data-tone="accent" data-width="contained">
        <div className="tgs-section__inner tv-demo">
          <h2 className="tgs-heading" data-style="h3">
            Talk to someone who has been
          </h2>
          <p className="tv-demo__quiet">Lines open until eight on weekdays.</p>
          <p className="tv-demo__row">
            <span className="tgs-button" data-variant="primary" data-size="s">
              Call us
            </span>
          </p>
        </div>
      </section>

      <section className="tgs-section" data-tone="subtle" data-width="contained">
        <div className="tgs-section__inner tv-demo">
          <p className="tv-demo__quiet">
            The faint band, for alternating one section against the next.
          </p>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * One colour: a swatch that opens the picker, a hex box, and the ratio.
 *
 * BOTH INPUTS, because both are how people work. A brand guide gives you a hex
 * code to paste, and a native picker is how you find a colour you do not already
 * have. Offering only the picker means retyping a code by eye.
 */
function ColourRow({
  label,
  help,
  value,
  against,
  againstLabel,
  warning,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  against: string;
  againstLabel: string;
  warning?: string;
  onChange: (hex: string) => void;
}) {
  /*
   * The text box keeps its own copy while it is being typed.
   *
   * Pushing every keystroke up would commit "#1b2" on the way to "#1b2b5b", and
   * since that is a valid three digit hex the preview would flash a completely
   * different colour mid-word.
   */
  const [typed, setTyped] = useState(value);
  const [focused, setFocused] = useState(false);

  const shown = focused ? typed : value;
  const ratio = contrastRatio(value, against);
  const id = `colour-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;

  return (
    <div className="tv-field">
      <label className="tv-field__label" htmlFor={id}>
        {label}
      </label>

      <div className="tv-colour">
        <input
          className="tv-colour__swatch"
          type="color"
          aria-label={`${label} picker`}
          value={value}
          onChange={(event) => {
            setTyped(event.target.value);
            onChange(event.target.value);
          }}
        />

        <input
          className="tv-colour__hex"
          id={id}
          type="text"
          spellCheck={false}
          autoCapitalize="off"
          value={shown}
          onFocus={() => {
            setTyped(value);
            setFocused(true);
          }}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setTyped(event.target.value);
            const hex = normaliseHex(event.target.value);
            if (hex) onChange(hex);
          }}
        />

        <span className="tv-ratio" title={`Contrast against ${againstLabel}`}>
          {ratio}:1
        </span>
      </div>

      <p className="tv-field__help">{help}</p>

      {warning && (
        <p className="tv-warn" role="status">
          <Icon name="warning" size={14} />
          {warning}
        </p>
      )}
    </div>
  );
}

/** One derived colour, with the colour it sits on as its border. */
function Derived({ label, colour, on }: { label: string; colour: string; on: string }) {
  return (
    <li className="tv-derived__item">
      <span className="tv-derived__chip" style={{ background: colour, borderColor: on }} />
      <span className="tv-derived__label">{label}</span>
      <code className="tv-derived__hex">{colour}</code>
    </li>
  );
}
