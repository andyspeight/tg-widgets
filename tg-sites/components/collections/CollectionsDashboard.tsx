'use client';

/**
 * Collections and their entries: the writing screen.
 *
 * The same shape as the site dashboard, and deliberately the same CSS: this is
 * a list of things with a publish state and an edit button, which is exactly
 * what that screen already is. A second visual language for the same job would
 * be a second thing to keep in step.
 *
 * WHAT IS SERVER RENDERED AND WHAT IS NOT. The collections, which one is open
 * and its entries all arrive as props, so the first paint is the real list. From
 * then on this component owns them: publishing patches the row in place rather
 * than refetching, which keeps the button instant. Switching collection is the
 * exception and is a real navigation, because the entries for the other one
 * have to be read on the server anyway.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  createCollectionAction,
  createItemAction,
  deleteCollectionAction,
  deleteItemAction,
  publishItemAction,
  scheduleItemAction,
  unpublishItemAction,
  updateCollectionFieldsAction,
} from '../../app/actions/collections';
import { safeSlug } from '../../lib/content/collection';
import {
  FIELD_KIND_HINT,
  FIELD_KIND_LABEL,
  FIELD_KINDS,
  FIELD_PRESETS,
  mintFieldKey,
  type FieldDef,
  type FieldKind,
} from '../../lib/content/collection-fields';
import type { Collection, ItemSummary } from '../../lib/db/collections';
import type { Membership } from '../../lib/db/users';
import { AccountBar } from '../auth/AccountBar';
import { Icon } from '../editor/Icon';
import { ConfirmDialog, Modal } from '../ui/Modal';
import '../sites/sites.css';

const THEME_KEY = 'tg-sites:theme:v1';

type Dialog =
  | { kind: 'new-collection' }
  | { kind: 'new-item' }
  | { kind: 'fields'; collection: Collection }
  | { kind: 'schedule'; item: ItemSummary }
  | null;

interface Props {
  account: { email: string; name: string | null };
  site: { slug: string; available: Membership[] };
  siteName: string;
  siteUrl: string;
  collections: Collection[];
  /** Which one is open. Null only when the site has none at all. */
  openId: string | null;
  items: ItemSummary[];
}

export function CollectionsDashboard({
  account,
  site,
  siteName,
  siteUrl,
  collections,
  openId,
  items: initial,
}: Props) {
  const router = useRouter();

  const [items, setItems] = useState(initial);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light');

  // A scheduled post's go-live time is shown in the reader's own timezone, which
  // the server does not know, so formatting it on the server and again in the
  // browser would print two different strings and trip hydration. This flips true
  // once, after mount, so the first paint stays timezone-free and the time fills
  // in on the client where local time is real.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const open = collections.find((entry) => entry.id === openId) ?? null;
  const host = siteUrl.replace(/^https?:\/\//, '');

  /*
   * The open collection's declared fields, held here as well as on the prop.
   *
   * Same reason the entries are: saving the schema patches this in place so the
   * bar's count is right immediately, and the server refresh that follows
   * replaces it with what actually landed.
   */
  const [fields, setFields] = useState<FieldDef[]>(open?.fields ?? []);
  useEffect(() => setFields(open?.fields ?? []), [open]);

  /*
   * The entries come from the server on every navigation, and switching
   * collection IS a navigation. Without this the list would still show the
   * previous collection's entries after the URL changed, because useState only
   * reads its argument on the first render.
   */
  useEffect(() => {
    setItems(initial);
  }, [initial]);

  // The same appearance choice as the editor and the pages screen, from the
  // same key, so moving between them does not flip the lights.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') setTheme(stored);
    } catch {
      // Storage blocked. Light is a fine place to stay.
    }
  }, []);

  const patch = useCallback((id: string, next: ItemSummary | null) => {
    setItems((current) =>
      next ? current.map((item) => (item.id === id ? next : item)) : current.filter((item) => item.id !== id),
    );
  }, []);

  const publish = useCallback(
    (item: ItemSummary) => {
      setError(null);
      startTransition(async () => {
        const action = item.status === 'published' ? unpublishItemAction : publishItemAction;
        const result = await action(item.id);
        if (!result.ok) setError(result.error);
        else if (result.data) patch(item.id, result.data);
      });
    },
    [patch],
  );

  // The dialog awaits this and shows the message inline, the same shape the new
  // collection and new entry dialogs use, so a time in the past lands under the
  // field rather than in the page banner.
  const schedule = useCallback(
    (item: ItemSummary, whenIso: string): Promise<string | null> =>
      new Promise((done) => {
        setError(null);
        startTransition(async () => {
          const result = await scheduleItemAction(item.id, whenIso);
          if (!result.ok) {
            done(result.error);
            return;
          }
          if (result.data) patch(item.id, result.data);
          setDialog(null);
          done(null);
        });
      }),
    [patch],
  );

  const saveFields = useCallback(
    (collectionId: string, next: FieldDef[]): Promise<string | null> =>
      new Promise((done) => {
        setError(null);
        startTransition(async () => {
          const result = await updateCollectionFieldsAction(collectionId, next);
          if (!result.ok) {
            done(result.error);
            return;
          }
          if (result.data) setFields(result.data.fields);
          setDialog(null);
          done(null);
          // The editor reads these to draw its form, so what the server holds
          // has to be what this screen shows from here on.
          router.refresh();
        });
      }),
    [router],
  );

  const [deletingItem, setDeletingItem] = useState<ItemSummary | null>(null);
  const [deletingCollection, setDeletingCollection] = useState<Collection | null>(null);

  const removeItem = useCallback(
    (item: ItemSummary) => {
      setDeletingItem(null);
      setError(null);
      startTransition(async () => {
        const result = await deleteItemAction(item.id);
        if (!result.ok) setError(result.error);
        else patch(item.id, null);
      });
    },
    [patch],
  );

  const removeCollection = useCallback(
    (collection: Collection) => {
      setDeletingCollection(null);
      setError(null);
      startTransition(async () => {
        const result = await deleteCollectionAction(collection.id);
        if (!result.ok) setError(result.error);
        // Everything on this screen changes when a collection goes, including
        // which one is open, so this one is a server round trip rather than a
        // patch. revalidatePath has already run by the time we get here.
        else router.replace('/collections');
      });
    },
    [router],
  );

  return (
    <div className="sv-root" data-theme={theme}>
      <AccountBar
        email={account.email}
        name={account.name}
        currentSlug={site.slug}
        available={site.available}
      />

      <div className="sv-wrap">
        <header className="sv-head">
          <div>
            <p className="sv-eyebrow">Collections</p>
            <h1 className="sv-title">{siteName}</h1>
            <p className="sv-url">
              Lives at <code>{siteUrl}</code>
            </p>
          </div>

          <div className="sv-head__actions">
            {/*
              A plain anchor rather than next/link, the same call the pages
              screen makes about leaving for the theme: publishing an entry
              changes what the listing blocks on those pages render, so arriving
              there wants fresh server output.
            */}
            <a className="sv-btn" href="/sites">Back to pages</a>

            <button
              type="button"
              className="sv-btn"
              onClick={() => {
                setError(null);
                setDialog({ kind: 'new-collection' });
              }}
            >
              <Icon name="plus" size={16} />
              New collection
            </button>

            {open && (
              <button
                type="button"
                className="sv-btn"
                data-variant="primary"
                onClick={() => {
                  setError(null);
                  setDialog({ kind: 'new-item' });
                }}
              >
                <Icon name="plus" size={16} />
                New entry
              </button>
            )}
          </div>
        </header>

        {error && (
          <p className="sv-msg" role="alert">
            {error}
          </p>
        )}

        {collections.length === 0 ? (
          <div className="sv-empty">
            <h2>No collections yet</h2>
            <p>
              A collection is a list that keeps itself up to date. Make one called
              Blog, write posts in it, and a Cards block anywhere on the site can
              show the latest ones without you touching the page again.
            </p>
            <button
              type="button"
              className="sv-btn"
              data-variant="primary"
              onClick={() => setDialog({ kind: 'new-collection' })}
            >
              <Icon name="plus" size={16} />
              Start a blog
            </button>
          </div>
        ) : (
          <>
            {/*
              The collections themselves, as links rather than a dropdown.

              Links because which one is open is in the URL, so each of these is
              a real address somebody can bookmark or send. A select would need
              JavaScript to do the same thing worse.
            */}
            <nav className="sv-tabs" aria-label="Collections">
              {collections.map((collection) => (
                <Link
                  key={collection.id}
                  className="sv-tab"
                  href={`/collections?c=${collection.id}`}
                  aria-current={collection.id === openId ? 'page' : undefined}
                >
                  {collection.name}
                </Link>
              ))}
            </nav>

            {open && (
              <>
                <div className="sv-collection-bar">
                  <p className="sv-list-label">
                    {items.length} {items.length === 1 ? 'entry' : 'entries'}
                  </p>
                  <p className="sv-collection-bar__url">
                    at <code>{host}/{open.key}/…</code>
                  </p>

                  {/*
                    The schema, beside the address rather than behind a settings
                    screen, because on a Tours collection it is the thing that
                    gets edited second and looked at often. The count is the
                    label: "Fields" alone gives no reason to press it.
                  */}
                  <button
                    type="button"
                    className="sv-btn"
                    data-variant="quiet"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setDialog({ kind: 'fields', collection: { ...open, fields } });
                    }}
                  >
                    <Icon name="list" size={16} />
                    {fields.length === 0
                      ? 'Add fields'
                      : `${fields.length} ${fields.length === 1 ? 'field' : 'fields'}`}
                  </button>

                  <button
                    type="button"
                    className="sv-btn"
                    data-variant="quiet"
                    data-danger="true"
                    disabled={busy}
                    aria-label={`Delete the ${open.name} collection`}
                    onClick={() => setDeletingCollection(open)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>

                {items.length === 0 ? (
                  <div className="sv-empty">
                    <h2>Nothing written yet</h2>
                    <p>
                      Give the first entry a title. Everything else, the picture,
                      the summary and the words, comes next in the editor.
                    </p>
                    <button
                      type="button"
                      className="sv-btn"
                      data-variant="primary"
                      onClick={() => setDialog({ kind: 'new-item' })}
                    >
                      <Icon name="plus" size={16} />
                      Write the first entry
                    </button>
                  </div>
                ) : (
                  <ul className="sv-list">
                    {items.map((item) => (
                      <li className="sv-item" key={item.id}>
                        <div className="sv-item__main">
                          <Link className="sv-item__title" href={`/editor?item=${item.id}`}>
                            {item.title || 'Untitled'}
                          </Link>
                          <span className="sv-item__meta">
                            <span className="sv-path">
                              /{open.key}/{item.slug}
                            </span>
                            <StatusPill item={item} mounted={mounted} />
                          </span>
                        </div>

                        <Link className="sv-btn" data-variant="edit" href={`/editor?item=${item.id}`}>
                          <Icon name="edit" size={16} />
                          Edit
                        </Link>

                        <button
                          type="button"
                          className="sv-btn"
                          data-variant="quiet"
                          disabled={busy}
                          onClick={() => publish(item)}
                        >
                          {item.status === 'published' ? 'Unpublish' : 'Publish'}
                        </button>

                        {item.status !== 'published' && (
                          <button
                            type="button"
                            className="sv-btn"
                            data-variant="quiet"
                            disabled={busy}
                            onClick={() => {
                              setError(null);
                              setDialog({ kind: 'schedule', item });
                            }}
                          >
                            Schedule
                          </button>
                        )}

                        <button
                          type="button"
                          className="sv-btn"
                          data-variant="quiet"
                          data-danger="true"
                          disabled={busy}
                          aria-label={`Delete ${item.title || 'this entry'}`}
                          onClick={() => setDeletingItem(item)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>

      {deletingItem && (
        <ConfirmDialog
          title={`Delete "${deletingItem.title || 'this entry'}"?`}
          description="The entry and everything in it goes, and it disappears from any listing showing it. This one cannot be undone."
          confirmLabel="Delete entry"
          destructive
          onConfirm={() => removeItem(deletingItem)}
          onCancel={() => setDeletingItem(null)}
        />
      )}

      {deletingCollection && (
        <ConfirmDialog
          title={`Delete the "${deletingCollection.name}" collection?`}
          description={
            items.length === 0
              ? 'It is empty, so nothing is lost with it.'
              : `Every one of the ${items.length} entries in it goes too, and any listing fed from it empties. This one cannot be undone.`
          }
          confirmLabel="Delete collection"
          destructive
          onConfirm={() => removeCollection(deletingCollection)}
          onCancel={() => setDeletingCollection(null)}
        />
      )}

      {dialog?.kind === 'new-collection' && (
        <CollectionDialog
          host={host}
          taken={collections.map((entry) => entry.key)}
          onClose={() => setDialog(null)}
          onSubmit={(name, key, presetFields) =>
            new Promise((done) => {
              startTransition(async () => {
                const result = await createCollectionAction({ name, key, fields: presetFields });
                if (!result.ok) {
                  done(result.error);
                  return;
                }
                setDialog(null);
                done(null);
                // Straight into the new one, which is where somebody who has
                // just made a collection wants to be.
                router.replace(`/collections?c=${result.data.id}`);
              });
            })
          }
        />
      )}

      {dialog?.kind === 'new-item' && open && (
        <ItemDialog
          collectionName={open.name}
          host={host}
          collectionKey={open.key}
          onClose={() => setDialog(null)}
          onSubmit={(title) =>
            new Promise((done) => {
              const collectionId = open.id;
              startTransition(async () => {
                const result = await createItemAction(collectionId, title);
                if (!result.ok) {
                  done(result.error);
                  return;
                }
                if (!result.data) {
                  done('That collection has gone. Reload the page.');
                  return;
                }
                setDialog(null);
                done(null);
                // A new entry is empty, so there is nothing to look at on this
                // screen. Straight to the editor, where the writing happens.
                router.push(`/editor?item=${result.data.id}`);
              });
            })
          }
        />
      )}

      {dialog?.kind === 'fields' && (
        <FieldsDialog
          collection={dialog.collection}
          entryCount={items.length}
          onClose={() => setDialog(null)}
          onSubmit={(next) => saveFields(dialog.collection.id, next)}
        />
      )}

      {dialog?.kind === 'schedule' && (
        <ScheduleDialog
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSubmit={(whenIso) => schedule(dialog.item, whenIso)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A scheduled post's go-live time, in the reader's own timezone. */
function formatWhen(when: Date): string {
  return when.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The states a post can be in, and for the same reason a page has three.
 *
 * Scheduled comes FIRST among the published states, because a scheduled post has
 * status 'published' on the row (that is what makes it go live on its own), so
 * without this it would read as plain Live. `mounted` gates only the time, not
 * the word: the pill says Scheduled on the server, and fills in the local time
 * once the browser, which is the only thing that knows the reader's timezone, has
 * taken over.
 */
function StatusPill({ item, mounted }: { item: ItemSummary; mounted: boolean }) {
  if (item.status !== 'published') return <span className="sv-pill">Draft</span>;

  if (item.scheduled) {
    const when = mounted && item.publishedAt ? ` for ${formatWhen(item.publishedAt)}` : '';
    return (
      <span className="sv-pill" data-state="scheduled">
        Scheduled{when}
      </span>
    );
  }

  if (item.hasUnpublishedChanges) {
    return (
      <span className="sv-pill" data-state="changed">
        Live, with unpublished edits
      </span>
    );
  }

  return (
    <span className="sv-pill" data-state="published">
      Live
    </span>
  );
}

// ---------------------------------------------------------------------------

function CollectionDialog({
  host,
  taken,
  onClose,
  onSubmit,
}: {
  host: string;
  /** The short names already in use, so a clash is caught before the database. */
  taken: string[];
  onClose: () => void;
  onSubmit: (name: string, key: string, fields: FieldDef[]) => Promise<string | null>;
}) {
  /*
   * The preset leads, and the name follows it.
   *
   * A client making their second collection is not making another blog, and a
   * blank schema designer is a worse first question than "what is this a list
   * of". So picking Tours names it Tours and gives it the six fields a tour
   * needs, all of them renameable afterwards. Typing a name of your own stops
   * the preset from overwriting it.
   */
  const [presetId, setPresetId] = useState(FIELD_PRESETS[0]?.id ?? 'blog');
  const preset = FIELD_PRESETS.find((entry) => entry.id === presetId) ?? FIELD_PRESETS[0];

  const [name, setName] = useState(preset?.collectionName ?? 'Blog');
  const [nameIsMine, setNameIsMine] = useState(false);
  const [key, setKey] = useState('');
  const [keyIsMine, setKeyIsMine] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const effectiveName = nameIsMine ? name : (preset?.collectionName ?? '');
  const effectiveKey = safeSlug(keyIsMine ? key : effectiveName);
  const clash = taken.includes(effectiveKey);

  async function submit() {
    if (!effectiveName.trim()) {
      setMessage('Give the collection a name.');
      return;
    }
    if (!effectiveKey) {
      setMessage('The short name needs at least one letter or number.');
      return;
    }
    if (clash) {
      setMessage('Another collection already uses that short name.');
      return;
    }
    setSaving(true);
    setMessage(await onSubmit(effectiveName.trim(), effectiveKey, preset?.fields ?? []));
    setSaving(false);
  }

  return (
    <Modal
      title="New collection"
      description="A list that keeps itself up to date. A blog is the usual one."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tg-btn"
            data-variant="primary"
            disabled={saving}
            onClick={submit}
          >
            {saving ? 'Working' : 'Create collection'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {message && (
          <p className="sv-msg" role="alert">
            {message}
          </p>
        )}

        <fieldset className="sv-choices">
          <legend>What is it a list of?</legend>
          {FIELD_PRESETS.map((entry) => (
            <label className="sv-choice" key={entry.id} data-on={entry.id === presetId}>
              <input
                type="radio"
                name="collection-preset"
                value={entry.id}
                checked={entry.id === presetId}
                onChange={() => setPresetId(entry.id)}
              />
              <span className="sv-choice__name">{entry.name}</span>
              <span className="sv-choice__blurb">{entry.blurb}</span>
            </label>
          ))}
        </fieldset>

        <div className="sv-field">
          <label htmlFor="collection-name">Name</label>
          <input
            id="collection-name"
            value={effectiveName}
            placeholder="Blog"
            onChange={(event) => {
              setNameIsMine(true);
              setName(event.target.value);
            }}
          />
          <small>What it is called in your list of collections.</small>
        </div>

        <div className="sv-field">
          <label htmlFor="collection-key">Short name</label>
          <input
            id="collection-key"
            value={keyIsMine ? key : safeSlug(effectiveName)}
            placeholder="blog"
            onChange={(event) => {
              setKeyIsMine(true);
              setKey(event.target.value);
            }}
          />
          <small>
            The first part of the address of everything in it. Changing it later
            breaks every link to every entry, so it is worth a moment now.
          </small>
        </div>

        <p className="sv-preview" data-tone={clash ? 'warn' : 'ok'}>
          <Icon name={clash ? 'warning' : 'check'} size={16} />
          {clash ? (
            <span>
              Another collection already uses <code>{effectiveKey}</code>. Pick a
              different short name.
            </span>
          ) : (
            <span>
              Entries will live at{' '}
              <code>
                {host}/<strong>{effectiveKey || 'blog'}</strong>/…
              </code>
              {preset && preset.fields.length > 0 && (
                <>
                  , each with {preset.fields.length} fields to fill in:{' '}
                  {preset.fields.map((field) => field.label.toLowerCase()).join(', ')}. Rename
                  or change them whenever you like.
                </>
              )}
            </span>
          )}
        </p>

        {/* Submit on Enter. Last, so the Modal focuses the name field. */}
        <button type="submit" className="tg-visually-hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/**
 * A new entry asks for one thing.
 *
 * The title, and nothing else. The summary, the picture and the date all live
 * in the editor's properties pane where the words are, and asking for them here
 * would be a form to fill in before the writing starts. The address is worked
 * out from the title exactly as a page's is.
 */
function ItemDialog({
  collectionName,
  host,
  collectionKey,
  onClose,
  onSubmit,
}: {
  collectionName: string;
  host: string;
  collectionKey: string;
  onClose: () => void;
  onSubmit: (title: string) => Promise<string | null>;
}) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const slug = safeSlug(title) || 'untitled';

  async function submit() {
    if (!title.trim()) {
      setMessage('Give the entry a title.');
      return;
    }
    setSaving(true);
    setMessage(await onSubmit(title.trim()));
    setSaving(false);
  }

  return (
    <Modal
      title={`New entry in ${collectionName}`}
      description="A title to start with. The words come next, in the editor."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tg-btn"
            data-variant="primary"
            disabled={saving}
            onClick={submit}
          >
            {saving ? 'Working' : 'Create and write'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {message && (
          <p className="sv-msg" role="alert">
            {message}
          </p>
        )}

        <div className="sv-field">
          <label htmlFor="item-title">Title</label>
          <input
            id="item-title"
            value={title}
            placeholder="Ten things to do in Crete"
            onChange={(event) => setTitle(event.target.value)}
          />
          <small>The headline, on the entry itself and on every card showing it.</small>
        </div>

        <p className="sv-preview" data-tone="ok">
          <Icon name="check" size={16} />
          <span>
            Will live at{' '}
            <code>
              {host}/{collectionKey}/<strong>{slug}</strong>
            </code>
          </span>
        </p>

        <button type="submit" className="tg-visually-hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/** A row being edited. A field with no key yet has never been saved. */
type DraftField = FieldDef & { key: string };

/**
 * What a collection's entries have, beyond a title and some words.
 *
 * THE KEY IS MINTED ON SAVE, NOT ON ADD, so it comes from the label the client
 * settled on rather than from whatever was in the box when they pressed the
 * button. After that it never moves: renaming "Nights" to "Nights aboard"
 * changes the label and nothing else, and every entry keeps its answer.
 *
 * DELETING A FIELD DELETES NO WRITING. The answers stay in each entry, out of
 * sight, and come back if a field with that key is ever added again. The note
 * under the delete button says so, because a client deciding whether to tidy
 * their schema deserves to know that before they press it rather than after.
 */
function FieldsDialog({
  collection,
  entryCount,
  onClose,
  onSubmit,
}: {
  collection: Collection;
  entryCount: number;
  onClose: () => void;
  onSubmit: (fields: FieldDef[]) => Promise<string | null>;
}) {
  const [rows, setRows] = useState<DraftField[]>(collection.fields);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (index: number, next: Partial<DraftField>) =>
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...next } : row)));

  const move = (index: number, by: number) =>
    setRows((current) => {
      const to = index + by;
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(to, 0, row);
      return next;
    });

  const add = () =>
    setRows((current) => [
      ...current,
      { key: '', label: '', kind: 'text', required: false, choices: [], prefix: '', suffix: '' },
    ]);

  async function submit() {
    const named = rows.filter((row) => row.label.trim());
    if (named.length !== rows.length) {
      setMessage('Give every field a name, or remove the empty ones.');
      return;
    }

    const missingChoices = named.find((row) => row.kind === 'choice' && row.choices.length === 0);
    if (missingChoices) {
      setMessage(`"${missingChoices.label}" is a choice, so it needs a list to choose from.`);
      return;
    }

    // Keys are minted here, from the settled labels, and only for rows that
    // have never had one. Everything already saved keeps the key its entries
    // are stored under.
    const taken = new Set(named.filter((row) => row.key).map((row) => row.key));
    const ready: FieldDef[] = named.map((row) => {
      if (row.key) return { ...row, label: row.label.trim() };
      const key = mintFieldKey(row.label, taken);
      taken.add(key);
      return { ...row, key, label: row.label.trim() };
    });

    setSaving(true);
    setMessage(await onSubmit(ready));
    setSaving(false);
  }

  const gone = collection.fields.filter((was) => !rows.some((row) => row.key === was.key));

  return (
    <Modal
      title={`Fields in ${collection.name}`}
      description="What every entry in this collection has, beyond its title, picture and words."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tg-btn"
            data-variant="primary"
            disabled={saving}
            onClick={submit}
          >
            {saving ? 'Working' : 'Save fields'}
          </button>
        </>
      }
    >
      {message && (
        <p className="sv-msg" role="alert">
          {message}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="sv-fields__empty">
          <p>
            No fields yet, which is right for a blog: a post already has a title, a
            picture, a date and its words.
          </p>
          <p>
            Add some when the entries are things rather than articles. A tour has a
            price and a number of nights. A destination has a country and a flying
            time. Those go on every card and every page without anybody typing them
            into the words.
          </p>
        </div>
      ) : (
        <ul className="sv-fields">
          {rows.map((row, index) => (
            <li className="sv-fieldrow" key={row.key || `new-${index}`}>
              <div className="sv-fieldrow__top">
                <div className="sv-field">
                  <label htmlFor={`field-label-${index}`}>Name</label>
                  <input
                    id={`field-label-${index}`}
                    value={row.label}
                    placeholder="Nights"
                    onChange={(event) => patch(index, { label: event.target.value })}
                  />
                </div>

                <div className="sv-field">
                  <label htmlFor={`field-kind-${index}`}>Holds</label>
                  <select
                    id={`field-kind-${index}`}
                    value={row.kind}
                    onChange={(event) => patch(index, { kind: event.target.value as FieldKind })}
                  >
                    {FIELD_KINDS.map((kind) => (
                      <option value={kind} key={kind}>
                        {FIELD_KIND_LABEL[kind]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sv-fieldrow__tools">
                  <button
                    type="button"
                    className="sv-btn"
                    data-variant="quiet"
                    aria-label={`Move ${row.label || 'this field'} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <Icon name="arrow-up" size={16} />
                  </button>
                  <button
                    type="button"
                    className="sv-btn"
                    data-variant="quiet"
                    aria-label={`Move ${row.label || 'this field'} down`}
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <Icon name="arrow-down" size={16} />
                  </button>
                  <button
                    type="button"
                    className="sv-btn"
                    data-variant="quiet"
                    data-danger="true"
                    aria-label={`Remove ${row.label || 'this field'}`}
                    onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>

              <p className="sv-fieldrow__hint">{FIELD_KIND_HINT[row.kind]}</p>

              {(row.kind === 'number' || row.kind === 'price') && (
                /*
                 * What sits round the number when it is shown. Only here, and
                 * only for the two kinds that are numbers, because a bare 1299
                 * on a card is not a price and a bare 7 is not a week.
                 */
                <div className="sv-fieldrow__affixes">
                  <div className="sv-field">
                    <label htmlFor={`field-prefix-${index}`}>Before it</label>
                    <input
                      id={`field-prefix-${index}`}
                      value={row.prefix}
                      maxLength={8}
                      placeholder={row.kind === 'price' ? '£' : ''}
                      onChange={(event) => patch(index, { prefix: event.target.value })}
                    />
                  </div>
                  <div className="sv-field">
                    <label htmlFor={`field-suffix-${index}`}>After it</label>
                    <input
                      id={`field-suffix-${index}`}
                      value={row.suffix}
                      maxLength={8}
                      placeholder={row.kind === 'price' ? 'pp' : 'nights'}
                      onChange={(event) => patch(index, { suffix: event.target.value })}
                    />
                  </div>
                  <p className="sv-fieldrow__hint">
                    Shown either side of the number, on cards and on the entry. A
                    word gets a space of its own, a symbol sits against the
                    number: £1,299 and 7 nights.
                  </p>
                </div>
              )}

              {row.kind === 'choice' && (
                <div className="sv-field">
                  <label htmlFor={`field-choices-${index}`}>The list, one to a line</label>
                  <textarea
                    id={`field-choices-${index}`}
                    rows={4}
                    value={row.choices.join('\n')}
                    placeholder={'Half board\nFull board\nAll inclusive'}
                    onChange={(event) =>
                      patch(index, {
                        choices: event.target.value
                          .split('\n')
                          .map((line) => line.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
              )}

              <label className="sv-check">
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={(event) => patch(index, { required: event.target.checked })}
                />
                <span>
                  Ask for this before publishing
                  {row.required && entryCount > 0 && (
                    <small>
                      {' '}
                      Entries already written are left alone. Nothing is unpublished.
                    </small>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="sv-btn" onClick={add}>
        <Icon name="plus" size={16} />
        Add a field
      </button>

      {gone.length > 0 && (
        <p className="sv-preview" data-tone="warn">
          <Icon name="warning" size={16} />
          <span>
            {gone.map((field) => field.label).join(', ')}{' '}
            {gone.length === 1 ? 'goes' : 'go'} when you save. What your{' '}
            {entryCount === 1 ? 'entry has' : `${entryCount} entries have`} already
            answered stays put and comes back if you add {gone.length === 1 ? 'it' : 'them'}{' '}
            again, so nothing written is lost either way.
          </span>
        </p>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/**
 * Pick a moment for a draft to go live on its own.
 *
 * datetime-local IS THE POINT, and its naivety is the reason. The control hands
 * back the wall-clock time the client typed with no zone attached, which is
 * exactly what a person means by "nine on Friday": nine where they are. new Date
 * reads it in the browser's zone and toISOString resolves it to the UTC instant
 * the server stores and the renderer policy compares against, so a client in
 * Perth and one in Preston each get the moment they meant.
 *
 * The past is refused here as well as in the database, so the message lands
 * under the field rather than the page banner, and because scheduling for a
 * moment already gone is a publish and Publish is one button away.
 */
function ScheduleDialog({
  item,
  onClose,
  onSubmit,
}: {
  item: ItemSummary;
  onClose: () => void;
  onSubmit: (whenIso: string) => Promise<string | null>;
}) {
  const [when, setWhen] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!when) {
      setMessage('Pick a date and time.');
      return;
    }
    const ms = new Date(when).getTime();
    if (!Number.isFinite(ms)) {
      setMessage('That is not a time I can read.');
      return;
    }
    if (ms <= Date.now()) {
      setMessage('Pick a time in the future. To go live now, use Publish.');
      return;
    }
    setSaving(true);
    setMessage(await onSubmit(new Date(when).toISOString()));
    setSaving(false);
  }

  return (
    <Modal
      title={`Schedule "${item.title || 'this entry'}"`}
      description="It stays hidden until the moment you pick, then goes live on its own."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tg-btn"
            data-variant="primary"
            disabled={saving}
            onClick={submit}
          >
            {saving ? 'Working' : 'Schedule'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {message && (
          <p className="sv-msg" role="alert">
            {message}
          </p>
        )}

        <div className="sv-field">
          <label htmlFor="schedule-when">Go live at</label>
          <input
            id="schedule-when"
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
          />
          <small>Your local time. It appears the moment this passes, with nothing more to do.</small>
        </div>

        <button type="submit" className="tg-visually-hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}
