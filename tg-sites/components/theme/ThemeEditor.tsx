'use client';

/**
 * The theme screen: four colours, two fonts, one corner style, and a preview
 * that shows what they do.
 *
 * WHY THE PREVIEW IS THE POINT
 *
 * A row of colour swatches tells a client nothing. Nobody can look at a hex
 * code and know whether the label on their button will be readable, whether
 * their captions will disappear, or whether their brand colour works as a
 * section background. So the right hand side is a small real page built from
 * the same .tgs-* classes and the same tokens the published site uses, and it
 * repaints on every keystroke.
 *
 * It deliberately shows the things that GO WRONG rather than the things that
 * look nice: a filled button whose label has to be legible, muted text that can
 * vanish, a hairline that can disappear, and both coloured bands. A preview of
 * only the happy path is decoration.
 *
 * WHAT IT IS NOT
 *
 * Not PageRenderer. It uses the same stylesheet, so the colours and the type
 * are honest, but the arrangement is chosen to exercise the tokens rather than
 * to be a real page. The real check is the canvas in the editor, which does use
 * PageRenderer and now carries the same theme.
 */

import { useEffect, useMemo, useState, useTransition } from 'react';

import { saveThemeAction } from '../../app/actions/theme';
import {
  CORNER_IDS,
  CORNERS,
  DEFAULT_THEME,
  FONT_IDS,
  FONTS,
  parseTheme,
  type FontId,
  type Theme,
} from '../../lib/theme/schema';
import { contrastRatio, normaliseHex } from '../../lib/theme/colour';
import { themeTokens, themeWarnings } from '../../lib/theme/tokens';
import { Icon } from '../editor/Icon';
import './theme.css';

const THEME_KEY = 'tg-sites:theme:v1';

interface Props {
  siteName: string;
  initial: Theme;
}

type ColourField = 'brand' | 'accent' | 'pageBackground' | 'text';

const COLOUR_FIELDS: Array<{ key: ColourField; label: string; help: string }> = [
  {
    key: 'brand',
    label: 'Brand colour',
    help: 'Buttons, links, and the coloured bands between sections.',
  },
  {
    key: 'accent',
    label: 'Accent colour',
    help: 'Highlights and second-choice actions. Used sparingly.',
  },
  {
    key: 'pageBackground',
    label: 'Page background',
    help: 'Usually white. A very pale tint reads as warmer.',
  },
  {
    key: 'text',
    label: 'Text colour',
    help: 'Body copy. Everything else in the type palette is worked out from it.',
  },
];

export function ThemeEditor({ siteName, initial }: Props) {
  const [theme, setTheme] = useState<Theme>(initial);
  /** What is in the database, so the screen knows whether anything is pending. */
  const [saved, setSaved] = useState<Theme>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [chrome, setChrome] = useState<'light' | 'dark' | 'system'>('light');

  /*
   * Same appearance key as the editor and the dashboard, so moving between the
   * three screens does not flip the lights. This is the EDITOR's light or dark,
   * not the client's site theme.
   *
   * useEffect, not useMemo. A memo runs during render, including the server
   * render, where there is no window to read. Reaching for it here because it
   * "only needs to happen once" is how a client component starts throwing
   * during SSR.
   */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') setChrome(stored);
    } catch {
      // Storage blocked. Light is a fine place to stay.
    }
  }, []);

  const tokens = useMemo(() => themeTokens(theme), [theme]);
  const warnings = useMemo(() => themeWarnings(theme), [theme]);
  const dirty = useMemo(
    () => (Object.keys(DEFAULT_THEME) as Array<keyof Theme>).some((k) => theme[k] !== saved[k]),
    [theme, saved],
  );

  function set<K extends keyof Theme>(key: K, value: Theme[K]) {
    setMessage(null);
    setTheme((current) => ({ ...current, [key]: value }));
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveThemeAction(theme);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      // The returned theme, not the local one. If the schema tidied anything
      // the screen should show what is actually stored.
      setTheme(result.data);
      setSaved(result.data);
    });
  }

  const warningFor = (field: ColourField) => warnings.find((w) => w.field === field);

  return (
    <div className="sv-root tv-root" data-theme={chrome}>
      <div className="tv-wrap">
        <header className="tv-head">
          <div>
            <p className="sv-eyebrow">Theme</p>
            <h1 className="sv-title">{siteName}</h1>
            <p className="sv-url">
              Four colours and a typeface. Everything else is worked out from them.
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

        <div className="tv-grid">
          {/* ---------------------------------------------------------- */}
          {/* Controls                                                    */}
          {/* ---------------------------------------------------------- */}
          <div className="tv-controls">
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
                  warning={warningFor(field.key)?.message}
                  onChange={(hex) => set(field.key, hex)}
                />
              ))}
            </section>

            <section className="tv-group">
              <h2 className="tv-group__title">Type</h2>

              <FontRow
                id="body-font"
                label="Body text"
                value={theme.bodyFont}
                onChange={(id) => set('bodyFont', id)}
              />
              <FontRow
                id="heading-font"
                label="Headings"
                value={theme.headingFont}
                onChange={(id) => set('headingFont', id)}
              />

              <p className="tv-note">
                These are the fonts already on your visitor&rsquo;s device, so
                nothing has to be downloaded and the page paints straight away.
                Loading your own brand font is a later job.
              </p>
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
                From the four colours above. Nothing here is yours to set, and
                every one of them is checked for contrast against whatever it
                sits on.
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
          </div>

          {/* ---------------------------------------------------------- */}
          {/* Preview                                                     */}
          {/* ---------------------------------------------------------- */}
          <div className="tv-preview">
            <p className="tv-preview__label">
              Your site, as a visitor sees it
            </p>

            {/*
              The theme tokens go on this element, exactly as they go on the
              page element of a published site. Same object, same mechanism, no
              stylesheet involved.
            */}
            <div className="tv-frame tgs-page" style={tokens.style}>
              <section className="tgs-section" data-tone="dark" data-width="contained">
                <div className="tgs-section__inner tv-demo">
                  <h2 className="tgs-heading" data-level="2">
                    Ten nights in the Maldives
                  </h2>
                  <p className="tgs-text">
                    Overwater villas, seaplane transfers and a private reef, from
                    March through to October.
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
                  <h2 className="tgs-heading" data-level="2">
                    Why book with us
                  </h2>
                  <p className="tgs-text">
                    Thirty years of arranging this exact trip, and one person
                    looking after yours from the first call to the last transfer.
                  </p>
                  {/* Muted text and a hairline, the two things that vanish. */}
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
                  <h2 className="tgs-heading" data-level="3">
                    Talk to someone who has been
                  </h2>
                  <p className="tv-demo__quiet">
                    Lines open until eight on weekdays.
                  </p>
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
            </div>
          </div>
        </div>
      </div>

      {/*
        One primary action, and it only lights up when there is something to
        save. The bar is fixed because the controls are taller than a screen and
        a Save button you have to scroll to find is a Save button people miss.
      */}
      <div className="tv-bar" data-dirty={dirty ? 'true' : undefined}>
        <span className="tv-bar__state">
          {dirty ? 'Not saved yet' : 'Saved'}
        </span>

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
            // parseTheme({}) fills every field from DEFAULT_THEME, so this
            // cannot drift from the defaults the way listing them here would.
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
 * One colour: a swatch that opens the picker, a hex box, and the ratio.
 *
 * BOTH INPUTS, because both are how people actually work. A brand guide gives
 * you a hex code to paste, and a native picker is how you find a colour you do
 * not already have. Offering only the picker means retyping a code by eye.
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
  /** The colour this one is measured against, for the ratio. */
  against: string;
  againstLabel: string;
  warning?: string;
  onChange: (hex: string) => void;
}) {
  /*
   * The text box keeps its own copy while it is being typed.
   *
   * Pushing every keystroke up would mean "#1b2" is committed on the way to
   * "#1b2b5b", and since that is a valid three digit hex the preview would
   * flash a completely different colour mid-word. So the local value is what
   * you see and the change is only committed when it parses.
   */
  const [typed, setTyped] = useState(value);
  const [focused, setFocused] = useState(false);

  const shown = focused ? typed : value;
  const ratio = contrastRatio(value, against);

  function commit(next: string) {
    setTyped(next);
    const hex = normaliseHex(next);
    if (hex) onChange(hex);
  }

  const id = `colour-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;

  return (
    <div className="tv-field">
      <label className="tv-field__label" htmlFor={id}>
        {label}
      </label>

      <div className="tv-colour">
        {/*
          A real <input type="color">, sized as a swatch. The native picker is
          better than anything worth building here: it has an eyedropper, it
          remembers recent colours, and it is the one your operating system
          taught you.
        */}
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
          inputMode="text"
          spellCheck={false}
          autoCapitalize="off"
          value={shown}
          onFocus={() => {
            setTyped(value);
            setFocused(true);
          }}
          onBlur={() => setFocused(false)}
          onChange={(event) => commit(event.target.value)}
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

// ---------------------------------------------------------------------------

function FontRow({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: FontId;
  onChange: (id: FontId) => void;
}) {
  return (
    <div className="tv-field">
      <label className="tv-field__label" htmlFor={id}>
        {label}
      </label>

      <select
        className="tv-select"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as FontId)}
        // Set in the font it is offering, so the list previews itself.
        style={{ fontFamily: FONTS[value].stack }}
      >
        {FONT_IDS.map((font) => (
          <option key={font} value={font} style={{ fontFamily: FONTS[font].stack }}>
            {FONTS[font].label}
          </option>
        ))}
      </select>

      <p className="tv-field__help">{FONTS[value].note}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** One derived colour, with the ratio it achieves against its own background. */
function Derived({ label, colour, on }: { label: string; colour: string; on: string }) {
  return (
    <li className="tv-derived__item">
      <span className="tv-derived__chip" style={{ background: colour, borderColor: on }} />
      <span className="tv-derived__label">{label}</span>
      <code className="tv-derived__hex">{colour}</code>
    </li>
  );
}
