'use client';

/**
 * The font library: what this site has, and two ways to add more.
 *
 * SEARCH IS SERVER SIDE. There are 1941 Google families and the catalogue is
 * about 57KB of source. Shipping it so a text box could filter it would put that
 * in the bundle of a screen most people open once, so the typing goes to a server
 * action that returns forty rows. Debounced, because a keystroke is not a query.
 *
 * IMPORTING IS NOT LINKING. Choosing a Google font downloads it once, here, and
 * stores the file. After that the font is served from this domain and Google is
 * never contacted again by us or by any visitor to the client's site. That is
 * both faster and nobody else's business. See lib/fonts/google.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import {
  deleteFontAction,
  importGoogleFontAction,
  searchGoogleFontsAction,
  uploadFontAction,
  type CatalogueMatch,
} from '../../app/actions/fonts';
import type { FontFamily } from '../../lib/db/fonts';
import { CATEGORY_LABEL, type FontCategory } from '../../lib/fonts/catalogue';
import { previewStack, useFontPreviews } from '../../lib/fonts/use-preview';
import { FALLBACK_STACK } from '../../lib/theme/fonts';
import { Icon } from '../editor/Icon';
import { ConfirmDialog } from '../ui/Modal';

interface Props {
  library: FontFamily[];
  onLibraryChange: (library: FontFamily[]) => void;
}

/** Long enough that a word is typed, short enough not to feel laggy. */
const SEARCH_DELAY_MS = 250;

const CATEGORIES = Object.keys(CATEGORY_LABEL) as FontCategory[];

export function FontsPanel({ library, onLibraryChange }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FontCategory | ''>('');
  const [matches, setMatches] = useState<CatalogueMatch[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busyFamily, setBusyFamily] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FontFamily | null>(null);
  const [, startTransition] = useTransition();

  /*
   * Every search is numbered and only the newest answer is used.
   *
   * Without this, typing "lato" fires four searches and whichever the server
   * happens to answer last wins. "lat" arriving after "lato" would leave the list
   * showing results for a query that is no longer in the box, which looks like
   * the search is broken rather than merely late.
   */
  const latest = useRef(0);

  const search = useCallback((text: string, cat: FontCategory | '') => {
    const ticket = latest.current + 1;
    latest.current = ticket;

    startTransition(async () => {
      const result = await searchGoogleFontsAction(text, cat || undefined);
      if (latest.current !== ticket) return;
      if (result.ok) setMatches(result.data);
    });
  }, []);

  // Debounced. The first run with an empty query is what fills the list with
  // something to look at before anybody types.
  useEffect(() => {
    const timer = setTimeout(() => search(query, category), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, category, search]);

  const owned = new Set(library.map((font) => font.slug));

  /*
   * Previews for exactly what is on screen, no more.
   *
   * Forty names at two to four kilobytes each is about the weight of one full
   * font, and every one of them is cached for a year afterwards, so scrolling
   * back through a search costs nothing the second time.
   */
  const previews = useFontPreviews(useMemo(() => matches.map((m) => m.family), [matches]));

  function importFont(family: string) {
    setMessage(null);
    setBusyFamily(family);
    startTransition(async () => {
      const result = await importGoogleFontAction(family);
      setBusyFamily(null);
      if (!result.ok) setMessage(result.error);
      else onLibraryChange(result.data);
    });
  }

  function remove(font: FontFamily) {
    setDeleting(null);
    setMessage(null);
    startTransition(async () => {
      const result = await deleteFontAction(font.slug);
      if (!result.ok) setMessage(result.error);
      else onLibraryChange(result.data);
    });
  }

  return (
    <>
      {message && (
        <p className="sv-msg" role="alert">
          <Icon name="warning" size={16} />
          {message}
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="tv-group">
        <h2 className="tv-group__title">
          This site&rsquo;s fonts
          {library.length > 0 && <span className="fp-count">{library.length}</span>}
        </h2>

        {library.length === 0 ? (
          <p className="tv-note">
            Nothing added yet, so every text style is using a typeface that is
            already on the reader&rsquo;s device. That is the fastest option and a
            perfectly good one. Add a font below to use your own.
          </p>
        ) : (
          <ul className="fp-owned">
            {library.map((font) => (
              <li className="fp-owned__item" key={font.slug}>
                {/*
                  The real family name, not a preview one: these are imported, so
                  the page has proper @font-face rules for them via
                  LibraryFontFaces. Until that component existed this line was
                  silently drawing every name in the system sans, because an
                  unresolvable font-family is a fallback rather than an error.

                  Falling back to the font's OWN category rather than to
                  sans-serif, so a serif in the library does not flash as a sans.
                */}
                <span
                  className="fp-owned__name"
                  style={{ fontFamily: `'${font.family}', ${FALLBACK_STACK[font.fallback]}` }}
                >
                  {font.family}
                </span>
                <span className="fp-owned__meta">
                  {font.source === 'google' ? 'Google' : 'Uploaded'}
                  {' · '}
                  {font.weights.length} {font.weights.length === 1 ? 'weight' : 'weights'}
                  {' · '}
                  {Math.round(font.bytes / 1024)}KB
                </span>
                <button
                  type="button"
                  className="tg-btn"
                  data-variant="ghost"
                  aria-label={`Remove ${font.family}`}
                  onClick={() => setDeleting(font)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="tv-group">
        <h2 className="tv-group__title">Add a Google font</h2>

        <div className="fp-search">
          <input
            className="tv-colour__hex fp-search__input"
            type="search"
            value={query}
            placeholder="Search 1,941 fonts"
            aria-label="Search Google fonts"
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            className="tv-select fp-search__category"
            value={category}
            aria-label="Filter by kind"
            onChange={(event) => setCategory(event.target.value as FontCategory | '')}
          >
            <option value="">Any kind</option>
            {CATEGORIES.map((id) => (
              <option key={id} value={id}>
                {CATEGORY_LABEL[id]}
              </option>
            ))}
          </select>
        </div>

        {matches.length === 0 ? (
          <p className="tv-note">
            No font by that name. The list is a snapshot, so something published
            very recently might be missing from it even though it will still
            import.
          </p>
        ) : (
          <ul className="fp-results">
            {matches.map((match) => {
              const slug = match.family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              const have = owned.has(slug);
              const busy = busyFamily === match.family;

              return (
                <li className="fp-result" key={match.family}>
                  <span className="fp-result__main">
                    {/*
                      The name IN the font, which is the whole point of a font
                      picker and used to say "impossible" here.
                      It was not impossible, it was impossible the obvious way.
                      Linking fonts.googleapis.com would have put a Google request
                      in a browser, which is the one thing this feature exists to
                      avoid; instead /api/font-preview fetches a two-kilobyte
                      subset server-side and serves it from this domain. The rule
                      holds and the preview is real.
                      Until the file lands, the category's own fallback stack, so
                      a serif candidate is standing in as a serif and the row does
                      not change shape when it arrives.
                    */}
                    <span
                      className="fp-result__name"
                      style={{
                        fontFamily: previewStack(
                          match.family,
                          previews.has(match.family),
                          FALLBACK_STACK[match.category],
                        ),
                      }}
                    >
                      {match.family}
                    </span>
                    <span className="fp-result__kind">{match.categoryLabel}</span>
                  </span>

                  <button
                    type="button"
                    className="tg-btn"
                    data-variant={have ? undefined : 'primary'}
                    disabled={have || busy}
                    onClick={() => importFont(match.family)}
                  >
                    {have ? 'Added' : busy ? 'Getting it' : 'Add'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="tv-note">
          Adding a font downloads it to this site once. Your visitors never
          request anything from Google, which is faster and keeps their browsing
          between them and you.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <UploadForm
        onDone={(next) => {
          setMessage(null);
          onLibraryChange(next);
        }}
        onError={setMessage}
      />

      {deleting && (
        <ConfirmDialog
          title={`Remove ${deleting.family}?`}
          description={
            'Any text style using it falls back to a system typeface. Adding it ' +
            'again puts it back everywhere it was.'
          }
          confirmLabel="Remove font"
          destructive
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Uploading a brand font.
 *
 * FormData rather than JSON, because a file cannot be a server action argument
 * any other way and base64 would inflate every upload by a third.
 *
 * The weight is asked for rather than guessed. A filename saying "Bold" means
 * nothing reliable, and getting it wrong means the weight control on the type
 * panel silently does nothing for that family.
 */
function UploadForm({
  onDone,
  onError,
}: {
  onDone: (library: FontFamily[]) => void;
  onError: (message: string) => void;
}) {
  const [family, setFamily] = useState('');
  const [fallback, setFallback] = useState<FontCategory>('sans');
  const [weight, setWeight] = useState(400);
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!family.trim()) {
      onError('Give the font a name, as the foundry spells it.');
      return;
    }
    if (!files || files.length === 0) {
      onError('Choose a font file.');
      return;
    }

    const form = new FormData();
    form.set('family', family.trim());
    form.set('fallback', fallback);
    for (const file of Array.from(files)) {
      form.append('file', file);
      // One weight per file, in the same order, because the action reads them
      // pairwise. A single value here applies to all of them.
      form.append('weight', String(weight));
    }

    setBusy(true);
    const result = await uploadFontAction(form);
    setBusy(false);

    if (!result.ok) {
      onError(result.error);
      return;
    }

    setFamily('');
    setFiles(null);
    if (input.current) input.current.value = '';
    onDone(result.data);
  }

  return (
    <section className="tv-group">
      <h2 className="tv-group__title">Upload your own</h2>

      <div className="tv-field">
        <label className="tv-field__label" htmlFor="upload-family">
          Font name
        </label>
        <input
          className="tv-colour__hex"
          id="upload-family"
          type="text"
          value={family}
          placeholder="Founders Grotesk"
          onChange={(event) => setFamily(event.target.value)}
        />
        <p className="tv-field__help">
          Letters, numbers and spaces. This is the name the stylesheet will use.
        </p>
      </div>

      <div className="tv-field">
        <label className="tv-field__label" htmlFor="upload-file">
          File
        </label>
        <input
          className="fp-file"
          id="upload-file"
          ref={input}
          type="file"
          multiple
          accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
          onChange={(event) => setFiles(event.target.files)}
        />
        <p className="tv-field__help">
          woff2 is much the smallest and is what to ask a foundry for. woff, ttf
          and otf work too. Up to 1MB each.
        </p>
      </div>

      <div className="tv-field">
        <label className="tv-field__label" htmlFor="upload-weight">
          Weight of this file
        </label>
        <select
          className="tv-select"
          id="upload-weight"
          value={weight}
          onChange={(event) => setWeight(Number(event.target.value))}
        >
          <option value={400}>Regular 400</option>
          <option value={500}>Medium 500</option>
          <option value={600}>Semibold 600</option>
          <option value={700}>Bold 700</option>
        </select>
        <p className="tv-field__help">
          Upload once per weight, using the same font name each time, and they
          join up into one family.
        </p>
      </div>

      <div className="tv-field">
        <label className="tv-field__label" htmlFor="upload-fallback">
          Closest match
        </label>
        <select
          className="tv-select"
          id="upload-fallback"
          value={fallback}
          onChange={(event) => setFallback(event.target.value as FontCategory)}
        >
          {CATEGORIES.map((id) => (
            <option key={id} value={id}>
              {CATEGORY_LABEL[id]}
            </option>
          ))}
        </select>
        <p className="tv-field__help">
          What to show in the moment before the font arrives. Getting this right
          stops the page changing shape as it loads.
        </p>
      </div>

      <div className="tv-door__actions">
        <button
          type="button"
          className="tg-btn"
          data-variant="primary"
          disabled={busy}
          onClick={submit}
        >
          {busy ? 'Uploading' : 'Upload font'}
        </button>
      </div>

      <p className="tv-note">
        Make sure your licence covers using the font on a website. A desktop
        licence usually does not.
      </p>
    </section>
  );
}
