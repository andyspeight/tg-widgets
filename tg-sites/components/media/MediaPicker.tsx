'use client';

/**
 * Choosing a picture, or a file.
 *
 * Three tabs, in the order somebody actually reaches for them: the images they
 * already have, then adding their own, then the photo library. Your images first
 * matters more than it sounds. Most placements are a picture the client already
 * uploaded, and opening on an upload box asks them to find a file they do not need
 * to find.
 *
 * TWO MODES, ONE DIALOG, added 20 Aug 2026 with the File element. `kind` picks
 * which half of the library is on show: pictures, or documents. It is one
 * component rather than two because everything that is hard here — the tenant
 * upload prefix, the direct-to-store transfer, the delete confirmation, the
 * paging — is identical for both, and the parts that genuinely differ are small
 * and named at each branch. In file mode the photo library tab is gone (there is
 * no stock brochure), the tiles are cards rather than thumbnails, and nothing
 * asks for alt text, because a download has a name rather than a description.
 *
 * Built on the shared Modal, so focus trapping, Escape, the scrim and the header
 * are not reimplemented here. The one rule this file has to keep on its own is the
 * one from Fields.tsx: nothing focuses or scrolls as part of rendering. A tile
 * grid that scrolled itself into view on every state change would fight the person
 * scrolling it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteMediaAction,
  importStockAction,
  loadMediaAction,
  recordUploadAction,
  searchStockAction,
  setMediaAltAction,
} from '../../app/actions/media';
import { describeImageAction } from '../../app/actions/ai';
import { MAX_ALT } from '../../lib/ai/prompt';
import { prepareImageForUpload } from '../../lib/media/downscale';
import {
  ALLOWED_DOCUMENT_MIME,
  filenameStem,
  formatLabel,
  humanBytes,
  MAX_UPLOAD_BYTES,
  mediaKind,
  type MediaKind,
  MEDIA_MIME,
} from '../../lib/media/limits';
import type { MediaItem, StockPhoto } from '../../lib/media/types';
import { Icon } from '../editor/Icon';
import { ConfirmDialog, Modal } from '../ui/Modal';

type Tab = 'bank' | 'upload' | 'stock';

interface Props {
  /** Called with the chosen item. The caller decides what to do with it. */
  onChoose: (item: MediaItem) => void;
  onClose: () => void;
  /** Highlighted in the grid, so "which one is on this block" is answerable. */
  currentUrl?: string;
  /** Pictures or documents. Defaults to pictures, which every existing caller wants. */
  kind?: MediaKind;
}

export function MediaPicker({ onChoose, onClose, currentUrl, kind = 'image' }: Props) {
  const files = kind === 'file';
  const [tab, setTab] = useState<Tab>('bank');

  const [items, setItems] = useState<MediaItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [canUpload, setCanUpload] = useState(true);
  const [canSearchStock, setCanSearchStock] = useState(true);
  /* Where this site's uploads are filed. Comes from the server, because the
     browser has no other way to know the tenant id, and is re-derived from the
     session by the token route so editing it here buys nothing. */
  const [uploadPrefix, setUploadPrefix] = useState('');

  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);

  const load = useCallback(
    async (offset: number) => {
      setBusy(true);
      setError(null);
      const result = await loadMediaAction(offset, kind);
      setBusy(false);

      if (!result.ok) {
        setError(result.error);
        setLoaded(true);
        return;
      }

      setItems((current) => (offset === 0 ? result.data.items : [...current, ...result.data.items]));
      setHasMore(result.data.hasMore);
      setCanUpload(result.data.canUpload);
      setCanSearchStock(result.data.canSearchStock);
      setUploadPrefix(result.data.uploadPrefix);
      setLoaded(true);
    },
    [kind],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  /** A new image goes to the front of the bank and the tab switches to show it. */
  const added = useCallback((item: MediaItem) => {
    setItems((current) => [item, ...current.filter((existing) => existing.id !== item.id)]);
    setTab('bank');
  }, []);

  async function confirmDelete(item: MediaItem) {
    setPendingDelete(null);
    setBusy(true);
    const result = await deleteMediaAction(item.id);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setItems((current) => current.filter((existing) => existing.id !== item.id));
  }

  /*
   * A description has been written or changed, so the tile stops warning.
   *
   * The row is replaced rather than the list reloaded: reloading would reset the
   * scroll position of a grid somebody is working down, which is exactly what
   * they are doing when they are fixing descriptions one at a time.
   */
  function onAltSaved(item: MediaItem) {
    setItems((current) => current.map((existing) => (existing.id === item.id ? item : existing)));
  }

  return (
    <>
      <Modal
        title={files ? 'Files' : 'Images'}
        description={
          files
            ? 'Brochures, terms, price lists. Anything you add stays here for every page on this site.'
            : 'Your own pictures, and a photo library for when you need one.'
        }
        size="large"
        onClose={onClose}
      >
        <div className="mp-root">
          <div
            className="mp-tabs"
            role="tablist"
            aria-label={files ? 'Where to get a file' : 'Where to get an image'}
          >
            <TabButton
              id="bank"
              current={tab}
              onSelect={setTab}
              label={files ? 'Your files' : 'Your images'}
              icon={files ? 'file' : 'gallery'}
            />
            <TabButton id="upload" current={tab} onSelect={setTab} label="Upload" icon="upload" />
            {/* No stock tab in file mode. There is no library of other people's
                brochures, and a tab that could only disappoint is worse than no
                tab at all. */}
            {!files && (
              <TabButton id="stock" current={tab} onSelect={setTab} label="Photo library" icon="search" />
            )}
          </div>

          {error && (
            <p className="mp-error" role="alert">
              <Icon name="warning" size={16} />
              {error}
            </p>
          )}

          {tab === 'bank' && (
            <Bank
              kind={kind}
              items={items}
              hasMore={hasMore}
              loaded={loaded}
              busy={busy}
              currentUrl={currentUrl}
              onChoose={onChoose}
              onDelete={setPendingDelete}
              onAltSaved={onAltSaved}
              onMore={() => void load(items.length)}
              onUploadInstead={() => setTab(canUpload ? 'upload' : 'stock')}
            />
          )}

          {tab === 'upload' && (
            <UploadPanel
              kind={kind}
              canUpload={canUpload}
              uploadPrefix={uploadPrefix}
              onAdded={added}
              onError={setError}
            />
          )}

          {tab === 'stock' && !files && (
            <StockPanel canSearch={canSearchStock} onAdded={added} onError={setError} />
          )}
        </div>
      </Modal>

      {pendingDelete && (
        <ConfirmDialog
          title={`Remove ${pendingDelete.filename}?`}
          description="It goes from your library and from your storage. Pages that already use it and are published keep showing it, but any draft using it will show a gap."
          confirmLabel="Remove it"
          destructive
          onConfirm={() => void confirmDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}

function TabButton({
  id,
  current,
  onSelect,
  label,
  icon,
}: {
  id: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  label: string;
  icon: 'gallery' | 'upload' | 'search' | 'file';
}) {
  return (
    <button
      type="button"
      className="mp-tab"
      role="tab"
      aria-selected={current === id}
      onClick={() => onSelect(id)}
    >
      <Icon name={icon} size={15} />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Your images
// ---------------------------------------------------------------------------

/**
 * The description of one picture, edited in place.
 *
 * WHY THIS IS HERE AND NOT SOMEWHERE TIDIER. setMediaAltAction has existed
 * since the image bank shipped and NOTHING CALLED IT: alt text could only ever
 * arrive from a stock photograph that already had a description, and there was
 * no way to write or change one anywhere in the product. The comment above this
 * grid already said it was "the one screen where somebody can see all their
 * images at once and fix the ones nobody described". It could not.
 *
 * SAVED ON BLUR, NEVER ON KEYSTROKE. Same rule as every numeric control in the
 * editor: a save per character is a request per character, and a description is
 * a sentence rather than a setting. Nothing is saved when the text has not
 * changed, so tabbing through the grid costs nothing.
 *
 * THE ASSISTANT WRITES INTO THE FIELD, IT DOES NOT SAVE. Somebody reads what it
 * said before it is kept, because a model that looked at a photograph and wrote
 * straight to the database would be one whose mistakes are already published.
 * The save then happens the same way as a typed one: on blur.
 */
function AltEditor({
  item,
  onSaved,
}: {
  item: MediaItem;
  onSaved: (item: MediaItem) => void;
}) {
  const [value, setValue] = useState(item.alt ?? '');
  const [state, setState] = useState<'idle' | 'asking' | 'saving'>('idle');
  const [failed, setFailed] = useState('');

  /*
   * What is in the database, so blur can tell a real change from a visit. A ref
   * rather than state: it is compared, never rendered, and putting it in state
   * would re-render the tile on every save for no visible reason.
   */
  const saved = useRef(item.alt ?? '');

  async function commit() {
    const next = value.trim().slice(0, MAX_ALT);
    if (next === saved.current) return;

    setState('saving');
    const result = await setMediaAltAction(item.id, next);
    setState('idle');

    if (!result.ok) {
      setFailed(result.error);
      return;
    }
    /*
     * Null means the row was not this tenant's, or is gone. The action makes
     * those the same answer on purpose, so this says the honest thing rather
     * than pretending a save happened.
     */
    if (!result.data) {
      setFailed('That picture is no longer in this image bank.');
      return;
    }

    setFailed('');
    saved.current = next;
    setValue(next);
    onSaved(result.data);
  }

  async function describe() {
    setState('asking');
    setFailed('');
    const result = await describeImageAction({ id: item.id });
    setState('idle');

    if (!result.ok) {
      setFailed(result.error);
      return;
    }
    // Into the field, not into the database. See the note above.
    setValue(result.alt);
  }

  const busy = state !== 'idle';

  return (
    <div className="mp-alt">
      <label className="mp-alt__label" htmlFor={`alt-${item.id}`}>
        Description
      </label>
      <div className="mp-alt__row">
        <input
          id={`alt-${item.id}`}
          className="mp-alt__input"
          type="text"
          value={value}
          maxLength={MAX_ALT}
          disabled={busy}
          placeholder="What is in this picture?"
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void commit()}
        />
        <button
          type="button"
          className="mp-alt__ai"
          disabled={busy}
          title="Ask the assistant to describe this picture"
          onClick={() => void describe()}
        >
          {state === 'asking' ? '…' : <Icon name="sparkle" size={14} />}
        </button>
      </div>
      {failed && <span className="mp-tile__warn">{failed}</span>}
      {!failed && !value.trim() && (
        <span className="mp-tile__warn">No description</span>
      )}
    </div>
  );
}

function Bank({
  kind,
  items,
  hasMore,
  loaded,
  busy,
  currentUrl,
  onChoose,
  onDelete,
  onAltSaved,
  onMore,
  onUploadInstead,
}: {
  kind: MediaKind;
  items: MediaItem[];
  hasMore: boolean;
  loaded: boolean;
  busy: boolean;
  currentUrl?: string;
  onChoose: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  onAltSaved: (item: MediaItem) => void;
  onMore: () => void;
  onUploadInstead: () => void;
}) {
  const files = kind === 'file';

  if (!loaded) return <p className="mp-quiet">Opening your {files ? 'files' : 'images'}…</p>;

  if (items.length === 0) {
    return (
      <div className="mp-empty">
        <Icon name={files ? 'file' : 'gallery'} size={28} />
        <h3>{files ? 'No files yet' : 'No images yet'}</h3>
        <p>
          {files
            ? 'Add a brochure, your booking conditions, a price list. Anything you add stays here for every page on this site.'
            : 'Add your own photographs, or find one in the library. Anything you add stays here for every page on this site.'}
        </p>
        <button type="button" className="tg-btn" data-variant="primary" onClick={onUploadInstead}>
          {files ? 'Add a file' : 'Add an image'}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mp-grid" data-kind={kind}>
        {items.map((item) => (
          <figure className="mp-tile" key={item.id} data-current={item.url === currentUrl}>
            {/*
              A button wrapping the picture rather than a click handler on the
              figure. The whole tile is the target either way, and this way it is
              reachable by Tab, announced as a control, and works on Enter.
            */}
            <button
              type="button"
              className="mp-tile__pick"
              onClick={() => onChoose(item)}
              title={`Use ${item.filename}`}
            >
              {/*
                A DOCUMENT HAS NO THUMBNAIL. Rendering one into an <img> gives a
                broken-image glyph, which reads as a failed upload rather than a
                PDF. The format's own name is the honest preview, and it is also
                the thing somebody is scanning the grid for.
              */}
              {mediaKind(item.mime) === 'file' ? (
                <span className="mp-tile__doc">
                  <Icon name="file" size={26} />
                  <span className="mp-tile__format">{formatLabel(item.mime) || 'File'}</span>
                </span>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={item.url} alt={item.alt || item.filename} loading="lazy" decoding="async" />
              )}
              {item.url === currentUrl && (
                <span className="mp-tile__badge">
                  <Icon name="check" size={13} /> In use
                </span>
              )}
            </button>

            <figcaption className="mp-tile__meta">
              <span className="mp-tile__name" title={item.filename}>
                {item.filename}
              </span>
              <span className="mp-tile__size">
                {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
                {humanBytes(item.bytes)}
              </span>
              {/*
                No alt text is worth saying out loud here, not hiding. This grid is
                the one screen where somebody can see all their images at once and
                fix the ones nobody described.

                NOT ON A DOCUMENT. Alt text describes a picture to somebody who
                cannot see it; a download link is already words, and asking for a
                description of a PDF would be asking a question with no answer.
              */}
              {mediaKind(item.mime) === 'image' && <AltEditor item={item} onSaved={onAltSaved} />}
              {item.source === 'pexels' && item.credit.photographer && (
                <span className="mp-tile__credit">{item.credit.photographer} · Pexels</span>
              )}
            </figcaption>

            <button
              type="button"
              className="mp-tile__remove"
              aria-label={`Remove ${item.filename}`}
              disabled={busy}
              onClick={() => onDelete(item)}
            >
              <Icon name="trash" size={14} />
            </button>
          </figure>
        ))}
      </div>

      {hasMore && (
        <div className="mp-more">
          <button type="button" className="tg-btn" disabled={busy} onClick={onMore}>
            {busy ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

function UploadPanel({
  kind,
  canUpload,
  uploadPrefix,
  onAdded,
  onError,
}: {
  kind: MediaKind;
  canUpload: boolean;
  uploadPrefix: string;
  onAdded: (item: MediaItem) => void;
  onError: (message: string) => void;
}) {
  const files = kind === 'file';
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  if (!canUpload) {
    /*
     * Named, not hidden. Same reasoning as the sign-in page's "not set up yet"
     * panel: a tab that quietly does nothing sends somebody looking for a bug in
     * their own file, and this is one setting away from working.
     */
    return (
      <div className="mp-error mp-error--panel">
        <h3>File storage is not connected yet</h3>
        <p>
          Uploads go to a Vercel Blob store, and this project does not have one
          attached. In Vercel, open this project, go to Storage, and connect a Blob
          store. The token appears by itself and the next deployment picks it up.
        </p>
        <p>
          The photo library tab does not need this, so that one works as soon as its
          own key is in place.
        </p>
      </div>
    );
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    onError('');

    const chosen = Array.from(files).slice(0, 12);

    for (const [index, file] of chosen.entries()) {
      const label = chosen.length > 1 ? ` (${index + 1} of ${chosen.length})` : '';

      /*
       * A DOCUMENT IS MEASURED AGAINST THE REAL CEILING, not four times it.
       *
       * The generous first pass below exists because an image is about to be
       * SHRUNK: a 40MB photograph becomes a 400KB WebP, so refusing it up front
       * would refuse a file that was going to be fine. Nothing shrinks a PDF, so
       * for a document the limit is the limit, and saying so here saves a client
       * watching a 30MB brochure upload before being told no.
       */
      if (files && file.size > MAX_UPLOAD_BYTES) {
        onError(`${file.name} is larger than 15MB. Try a smaller export.`);
        continue;
      }

      if (!files && file.size > MAX_UPLOAD_BYTES * 4) {
        // Refused before the browser tries to decode it. A 200MB file will not
        // fit in a canvas and there is no point finding that out slowly.
        onError(`${file.name} is far too large. Images need to be under 15MB.`);
        continue;
      }

      try {
        setProgress(`Preparing ${file.name}${label}`);
        const prepared = await prepareImageForUpload(file);

        if (prepared.body.size > MAX_UPLOAD_BYTES) {
          onError(`${file.name} is larger than 15MB, even after shrinking it.`);
          continue;
        }

        setProgress(
          prepared.resized
            ? `Uploading ${prepared.filename}${label}, shrunk to ${humanBytes(prepared.body.size)}`
            : `Uploading ${prepared.filename}${label}`,
        );

        /*
         * Imported here rather than at the top of the file.
         *
         * @vercel/blob/client pulls in the whole upload machinery, and this dialog
         * is opened from the editor, which everybody loads. Nobody should pay for
         * the uploader in their first byte of JavaScript when most placements are a
         * picture that is already in the bank.
         */
        const { upload } = await import('@vercel/blob/client');

        const result = await upload(
          // The pathname is a request, not a decision: the route recomputes this
          // prefix from the session and refuses to mint a token for anything
          // outside it, and the store adds its own random suffix on top.
          `${uploadPrefix}${filenameStem(prepared.filename)}.${MEDIA_MIME[prepared.mime]}`,
          prepared.body,
          {
            access: 'public',
            handleUploadUrl: '/api/media/upload',
            contentType: prepared.mime,
          },
        );

        /*
         * THE SMALLER COPIES, uploaded after the primary and never instead of it.
         *
         * Sequential rather than parallel on purpose. These are a nice-to-have on
         * top of an upload that has already succeeded, and firing four concurrent
         * uploads from a phone on a hotel wifi is a good way to make the one that
         * mattered time out. The progress line names what is happening because
         * otherwise a big photograph looks like it has stalled after "Uploading".
         *
         * Each failure is swallowed. A missing size costs a visitor some bytes;
         * an exception here would lose a picture that is already safely stored.
         */
        const uploadedVariants: Array<{ url: string; width: number; height: number }> = [];
        for (const [n, variant] of prepared.variants.entries()) {
          try {
            setProgress(
              `Making ${prepared.filename} smaller for phones${label} (${n + 1} of ${prepared.variants.length})`,
            );
            const stored = await upload(
              `${uploadPrefix}${filenameStem(variant.filename)}.${MEDIA_MIME[variant.mime]}`,
              variant.body,
              { access: 'public', handleUploadUrl: '/api/media/upload', contentType: variant.mime },
            );
            uploadedVariants.push({ url: stored.url, width: variant.width, height: variant.height });
          } catch {
            // This size is simply not available. The next one may still be.
          }
        }

        setProgress(`Saving ${prepared.filename}${label}`);
        const recorded = await recordUploadAction({
          url: result.url,
          filename: prepared.filename,
          width: prepared.width ?? undefined,
          height: prepared.height ?? undefined,
          variants: uploadedVariants,
        });

        if (!recorded.ok) {
          onError(recorded.error);
          continue;
        }
        onAdded(recorded.data);
      } catch (error) {
        onError(error instanceof Error ? error.message : `Could not upload ${file.name}.`);
      }
    }

    setProgress(null);
    // The same file chosen twice in a row fires no change event unless the input
    // is cleared, which reads as the second attempt being ignored.
    if (input.current) input.current.value = '';
  }

  return (
    <div
      className="mp-drop"
      data-dragging={dragging}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handleFiles(event.dataTransfer.files);
      }}
    >
      <Icon name="upload" size={26} />
      <h3>{files ? 'Drop files here' : 'Drop images here'}</h3>
      <p>
        {files
          ? 'PDF, Word, Excel, PowerPoint, CSV, plain text or a zip, up to 15MB each. Nothing is changed on the way in, so what a visitor downloads is exactly what you uploaded.'
          : 'JPEG, PNG, WebP, AVIF or GIF, up to 15MB each. Large photographs are shrunk to 2400px before uploading, which keeps your pages fast without you having to think about it.'}
      </p>

      {/*
        `accept` is a CONVENIENCE, never the check. It tidies the operating
        system's file chooser and nothing more: a person can always pick "all
        files", and a drag-and-drop ignores it completely. What actually decides
        is the type list named in the upload token, which the STORE enforces, and
        the check constraint on public.media behind that.
      */}
      <input
        ref={input}
        type="file"
        className="mp-drop__input"
        id="mp-file"
        accept={files ? ALLOWED_DOCUMENT_MIME.join(',') : 'image/jpeg,image/png,image/webp,image/avif,image/gif'}
        multiple
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <label className="tg-btn" data-variant="primary" htmlFor="mp-file">
        Choose files
      </label>

      {progress && (
        <p className="mp-progress" role="status">
          {progress}…
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Photo library
// ---------------------------------------------------------------------------

const SUGGESTIONS = ['Santorini', 'Amalfi coast', 'Dubai skyline', 'Cornwall beach', 'Safari'];

function StockPanel({
  canSearch,
  onAdded,
  onError,
}: {
  canSearch: boolean;
  onAdded: (item: MediaItem) => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState<string>('landscape');
  const [photos, setPhotos] = useState<StockPhoto[]>([]);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const search = useCallback(
    async (text: string, wantedPage: number, wantedOrientation: string) => {
      setBusy(true);
      onError('');
      const result = await searchStockAction({
        query: text,
        page: wantedPage,
        orientation: wantedOrientation || null,
      });
      setBusy(false);
      setSearched(true);

      if (!result.ok) {
        onError(result.error);
        return;
      }

      setPhotos((current) =>
        wantedPage === 1 ? result.data.photos : [...current, ...result.data.photos],
      );
      setImported(new Set(result.data.alreadyImported));
      setPage(result.data.page);
      setHasMore(result.data.hasMore);
    },
    [onError],
  );

  /*
   * The curated feed on open, so the tab has photographs in it before anybody
   * types. An empty grid with a search box asks for work before showing anything.
   */
  useEffect(() => {
    if (canSearch) void search('', 1, 'landscape');
  }, [canSearch, search]);

  if (!canSearch) {
    return (
      <div className="mp-error mp-error--panel">
        <h3>The photo library is not connected yet</h3>
        <p>
          It needs a free Pexels API key. Get one at pexels.com/api, add it to this
          project in Vercel as <code>PEXELS_API_KEY</code>, and redeploy.
        </p>
        <p>
          Uploading your own images does not need this, so that tab works
          independently.
        </p>
      </div>
    );
  }

  async function add(photo: StockPhoto) {
    setImporting(photo.id);
    onError('');
    const result = await importStockAction(photo);
    setImporting(null);

    if (!result.ok) {
      onError(result.error);
      return;
    }
    setImported((current) => new Set(current).add(photo.id));
    onAdded(result.data);
  }

  return (
    <div className="mp-stock">
      <form
        className="mp-search"
        onSubmit={(event) => {
          event.preventDefault();
          void search(query, 1, orientation);
        }}
      >
        <input
          className="ed-input"
          type="search"
          value={query}
          placeholder="Search millions of free photographs"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="ed-select"
          value={orientation}
          aria-label="Shape"
          onChange={(event) => {
            setOrientation(event.target.value);
            void search(query, 1, event.target.value);
          }}
        >
          <option value="landscape">Landscape</option>
          <option value="portrait">Portrait</option>
          <option value="square">Square</option>
          <option value="">Any shape</option>
        </select>
        <button type="submit" className="tg-btn" data-variant="primary" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {!query && (
        <div className="mp-suggest">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="mp-chip"
              onClick={() => {
                setQuery(suggestion);
                void search(suggestion, 1, orientation);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {searched && photos.length === 0 && !busy && (
        <p className="mp-quiet">Nothing matched that. Try a place name, or something plainer.</p>
      )}

      <div className="mp-grid">
        {photos.map((photo) => (
          <figure className="mp-tile" key={photo.id}>
            <button
              type="button"
              className="mp-tile__pick"
              disabled={importing === photo.id}
              onClick={() => void add(photo)}
              title={photo.description || 'Add this photo'}
            >
              {/*
                The average colour behind the thumbnail, so the grid does not flash
                white and reflow as forty images arrive at different speeds.
              */}
              <span
                className="mp-tile__wash"
                style={photo.averageColour ? { background: photo.averageColour } : undefined}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.thumbUrl} alt={photo.description} loading="lazy" decoding="async" />
              {importing === photo.id && <span className="mp-tile__badge">Adding…</span>}
              {imported.has(photo.id) && importing !== photo.id && (
                <span className="mp-tile__badge">
                  <Icon name="check" size={13} /> Added
                </span>
              )}
            </button>

            <figcaption className="mp-tile__meta">
              {/*
                The credit is not decoration. The Pexels API terms require the
                photographer to be named and a link back to the photo, wherever
                their work appears, so it is shown here and stored on import.
              */}
              <a
                className="mp-tile__credit"
                href={photo.credit.photographerUrl ?? photo.credit.providerUrl ?? '#'}
                target="_blank"
                rel="noreferrer noopener"
              >
                {photo.credit.photographer ?? 'Pexels'}
              </a>
            </figcaption>
          </figure>
        ))}
      </div>

      {hasMore && (
        <div className="mp-more">
          <button
            type="button"
            className="tg-btn"
            disabled={busy}
            onClick={() => void search(query, page + 1, orientation)}
          >
            {busy ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}

      <p className="mp-note">
        Photographs from <a href="https://www.pexels.com" target="_blank" rel="noreferrer noopener">Pexels</a>,
        free to use commercially. Adding one copies it into your own storage, so your
        pages never depend on somebody else keeping it online.
      </p>
    </div>
  );
}
