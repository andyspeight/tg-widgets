'use client';

/**
 * The editor.
 *
 * Owns the page, the selection, the history and the autosave. Everything
 * else in components/editor is presentational and talks back through the
 * callbacks handed down from here.
 *
 * WHERE THE DRAFT LIVES
 * Postgres, one row in `pages`, saved through a server action. The editor
 * never sees a tenant id: the action takes it from the session, and every
 * query underneath runs inside withTenant. There is no localStorage path and
 * no scratch mode, because two persistence paths means every save, undo and
 * publish has to work twice and only one of them gets exercised.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { publishPageAction, saveDraftAction } from '../../app/actions/pages';
import type { Page } from '../../lib/content/schema';
import { parsePage } from '../../lib/content/schema';
import { createBlock, createSectionFromLayout, newId } from '../../lib/content/factory';
import { addBlock, type Path, pathKey, resolve } from '../../lib/content/tree';
import { Outline } from './Outline';
import { Canvas } from './Canvas';
import { Properties } from './Properties';
import { BlockPicker } from './BlockPicker';
import { LayoutPicker } from './LayoutPicker';
import { Icon, type IconName } from './Icon';
import { Menu } from './Menu';
import './editor.css';

const THEME_KEY = 'tg-sites:theme:v1';
const HISTORY_LIMIT = 50;
/** Edits to the same field inside this window collapse into one undo step. */
const COALESCE_MS = 700;
/**
 * How long the editor waits after the last keystroke before saving.
 *
 * Longer than the old localStorage delay because this one crosses a network.
 * Short enough that an agent who types a heading and immediately closes the
 * tab still gets a save away, helped by the warning on unload below.
 */
const SAVE_DEBOUNCE_MS = 900;

export type Viewport = 'desktop' | 'tablet' | 'phone';

/**
 * Light is the default and stays the default, whatever the operating system
 * is set to. Following the OS meant anyone on a dark Mac was handed a dark
 * editor they never asked for.
 */
export type Theme = 'light' | 'dark' | 'system';

const THEMES: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match my computer' },
];

/** Label and icon together. An icon-only control is a guess. */
const VIEWPORTS: ReadonlyArray<{ value: Viewport; label: string; icon: IconName }> = [
  { value: 'desktop', label: 'Desktop', icon: 'desktop' },
  { value: 'tablet', label: 'Tablet', icon: 'tablet' },
  { value: 'phone', label: 'Phone', icon: 'phone' },
];

const VIEWPORT_WIDTH: Record<Viewport, string> = {
  desktop: '100%',
  // Chosen to sit clearly between the two container breakpoints (768 and
  // 1024), so "stack below tablet" visibly does something here and "stack
  // below mobile" visibly does not.
  tablet: '834px',
  phone: '390px',
};

interface History {
  past: Page[];
  present: Page;
  future: Page[];
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface EditorProps {
  isStaff?: boolean;
  pageId: string;
  initialPage: Page;
  initialStatus: 'draft' | 'published';
  initialHasUnpublishedChanges: boolean;
}

export function EditorShell({
  isStaff = true,
  pageId,
  initialPage,
  initialStatus,
  initialHasUnpublishedChanges,
}: EditorProps) {
  const [history, setHistory] = useState<History>({
    past: [],
    present: initialPage,
    future: [],
  });
  const [selected, setSelected] = useState<Path | null>(null);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [picker, setPicker] = useState<{ section: number; row: number; column: number } | null>(null);
  /** Where a new section would go. null means the picker is closed. */
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [saved, setSaved] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState<'draft' | 'published'>(initialStatus);
  const [unpublished, setUnpublished] = useState(initialHasUnpublishedChanges);
  const [publishing, setPublishing] = useState(false);
  const [mobilePane, setMobilePane] = useState<'canvas' | 'props' | 'outline'>('canvas');
  const [theme, setTheme] = useState<Theme>('light');

  const page = history.present;

  /** Identifies the last edit, so rapid edits to one field coalesce. */
  const lastEdit = useRef<{ key: string; at: number } | null>(null);

  // Remember the appearance choice. Read before first paint would be better
  // still, but a shell with no server session cannot do that yet, and the
  // default being light means the common case never flashes.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') setTheme(stored);
    } catch {
      // Storage blocked. Light is a fine place to stay.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not worth surfacing: the choice still applies for this session.
    }
  }, [theme]);

  // ---------------------------------------------------------------------
  // Autosave
  // ---------------------------------------------------------------------

  /**
   * Counts saves so a slow one cannot overwrite a fast one that followed it.
   *
   * Without this, two saves in flight can land out of order and the editor
   * would report "saved" against the older of the two. The debounce makes
   * that unlikely rather than impossible, and unlikely is not a guarantee
   * worth resting a client's copy on.
   */
  const saveSeq = useRef(0);
  /** Skips the save that a fresh mount would otherwise fire immediately. */
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }

    setSaved('saving');
    setSaveError(null);

    const timer = window.setTimeout(async () => {
      const seq = ++saveSeq.current;
      const result = await saveDraftAction(pageId, page);
      if (seq !== saveSeq.current) return;

      if (result.ok) {
        setSaved('saved');
        // A saved edit is by definition not yet published.
        setUnpublished(true);
      } else {
        setSaved('error');
        setSaveError(result.error);
      }
    }, SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [page, pageId]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setSaveError(null);

    // Flush any pending edit first, so publishing cannot capture the version
    // from before the last keystroke. The debounce means that gap is real.
    const pending = await saveDraftAction(pageId, page);
    if (!pending.ok) {
      setSaved('error');
      setSaveError(pending.error);
      setPublishing(false);
      return;
    }
    setSaved('saved');

    const result = await publishPageAction(pageId);
    if (result.ok && result.data) {
      setStatus(result.data.status);
      setUnpublished(result.data.hasUnpublishedChanges);
    } else if (!result.ok) {
      setSaveError(result.error);
    }
    setPublishing(false);
  }, [page, pageId]);

  // ---------------------------------------------------------------------
  // Commits
  // ---------------------------------------------------------------------

  /**
   * Apply a change.
   *
   * `coalesceKey` groups rapid edits to the same field into one undo step,
   * so typing a heading is one step rather than forty.
   */
  const commit = useCallback((next: Page | ((current: Page) => Page), coalesceKey?: string) => {
    setHistory((current) => {
      const resolved = typeof next === 'function' ? next(current.present) : next;
      if (resolved === current.present) return current;

      const now = Date.now();
      const previous = lastEdit.current;
      const shouldCoalesce =
        !!coalesceKey &&
        !!previous &&
        previous.key === coalesceKey &&
        now - previous.at < COALESCE_MS;

      lastEdit.current = coalesceKey ? { key: coalesceKey, at: now } : null;

      if (shouldCoalesce) {
        // Replace the present without growing the stack.
        return { ...current, present: resolved, future: [] };
      }

      const past = [...current.past, current.present].slice(-HISTORY_LIMIT);
      return { past, present: resolved, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    lastEdit.current = null;
    setHistory((current) => {
      if (current.past.length === 0) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, HISTORY_LIMIT),
      };
    });
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = null;
    setHistory((current) => {
      if (current.future.length === 0) return current;
      const [next, ...rest] = current.future;
      return {
        past: [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: next,
        future: rest,
      };
    });
  }, []);

  // ---------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // Warn on navigate away while a save is pending or has failed. The failed
  // case matters more than the pending one: that work exists only in this
  // tab, and closing it loses the lot.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (saved === 'saving' || saved === 'error') event.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saved]);

  // ---------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------

  const selectedKey = selected ? pathKey(selected) : null;

  // A structural edit can leave the selection pointing at something that no
  // longer exists. Clear it rather than letting the properties pane render
  // stale fields.
  useEffect(() => {
    if (selected && resolve(page, selected) === null) setSelected(null);
  }, [page, selected]);

  const select = useCallback((path: Path | null) => {
    setSelected(path);
    if (path && path.kind !== 'page') setMobilePane('props');
  }, []);

  // ---------------------------------------------------------------------
  // Import and export
  // ---------------------------------------------------------------------

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(page, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${page.slug || 'page'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [page]);

  const importJson = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = parsePage(JSON.parse(String(reader.result)));
          if (!result.ok) {
            window.alert(`That file is not a valid page:\n\n${result.errors.slice(0, 6).join('\n')}`);
            return;
          }
          setSelected(null);
          commit(result.page);
        } catch {
          window.alert('That file is not valid JSON.');
        }
      };
      reader.readAsText(file);
    },
    [commit],
  );

  const fileInput = useRef<HTMLInputElement>(null);

  const savedLabel = useMemo(() => {
    // Plain language about the work, not about the mechanism. An agent wants
    // to know their page is safe, not which system it went to.
    if (saved === 'saving') return 'Saving';
    if (saved === 'saved') return 'All changes saved';
    if (saved === 'error') return 'Not saved';
    return '';
  }, [saved]);

  const publishLabel = useMemo(() => {
    if (publishing) return 'Publishing';
    if (status !== 'published') return 'Publish';
    return unpublished ? 'Publish changes' : 'Published';
  }, [publishing, status, unpublished]);

  // ---------------------------------------------------------------------

  return (
    <div className="ed-root" data-pane={mobilePane} data-theme={theme}>
      <header className="ed-topbar">
        {/*
          A plain anchor, not next/link, for two reasons. Leaving the editor
          should re-fetch the page list from the server rather than soft
          navigate to a cached one that predates these edits. And next/link
          drags Next's runtime into the standalone bundle, which has no Next
          in it, so importing it broke that build outright.
        */}
        <a className="ed-brand" href="/sites" title="All pages">
          <span className="ed-brand__mark" aria-hidden="true">
            TG
          </span>
          <span>Sites</span>
        </a>

        <button
          type="button"
          className="ed-btn ed-mobile-only"
          data-icon="true"
          aria-label="Show the page outline"
          onClick={() => setMobilePane(mobilePane === 'outline' ? 'canvas' : 'outline')}
        >
          <Icon name="section" size={18} />
        </button>

        <div className="ed-titlewrap">
          <input
            className="ed-title-input"
            value={page.title}
            aria-label="Page title"
            onChange={(event) =>
              commit((current) => ({ ...current, title: event.target.value }), 'page:title')
            }
          />
          <span className="ed-save ed-desktop-only" data-state={saved}>
            {saved === 'saved' && <Icon name="check" size={14} />}
            {saved === 'error' && <Icon name="warning" size={14} />}
            {savedLabel}
          </span>
        </div>

        {/*
          The failure is stated where the work is, not in a toast that fades.
          Losing an unsaved page is the worst thing this editor can do to
          someone, so the message stays put until a save succeeds.
        */}
        {saveError && (
          <p className="ed-savefail" role="alert">
            {saveError}
          </p>
        )}

        {/*
          Icons carry a label on desktop and stand alone on narrow screens,
          where they keep their aria-label. Never icon-only without one.
        */}
        <div className="ed-seg ed-desktop-only" role="group" aria-label="Preview width">
          {VIEWPORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="ed-btn"
              aria-pressed={viewport === option.value}
              title={option.label}
              onClick={() => setViewport(option.value)}
            >
              <Icon name={option.icon} size={16} />
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="ed-btn"
          data-icon="true"
          onClick={undo}
          disabled={history.past.length === 0}
          aria-label="Undo"
          title="Undo (Cmd+Z)"
        >
          <Icon name="undo" size={18} />
        </button>
        <button
          type="button"
          className="ed-btn"
          data-icon="true"
          onClick={redo}
          disabled={history.future.length === 0}
          aria-label="Redo"
          title="Redo (Cmd+Shift+Z)"
        >
          <Icon name="redo" size={18} />
        </button>

        {/*
          Disabled once published with nothing new to say, rather than hidden.
          A button that vanishes leaves an agent wondering where it went; one
          that reads "Published" and sits still answers the question.
        */}
        <button
          type="button"
          className="ed-btn"
          data-variant="primary"
          onClick={publish}
          disabled={publishing || (status === 'published' && !unpublished)}
          title={
            status === 'published' && !unpublished
              ? 'The live page already matches this draft'
              : 'Make this the version visitors see'
          }
        >
          <Icon name={status === 'published' && !unpublished ? 'check' : 'upload'} size={16} />
          {publishLabel}
        </button>

        <Menu
          label="More actions"
          items={[
            { heading: 'Appearance' },
            ...THEMES.map((option) => ({
              icon: 'blank' as const,
              label: option.label,
              checked: theme === option.value,
              onClick: () => setTheme(option.value),
            })),
            { separator: true },
            {
              icon: 'download',
              label: 'Save a copy of this page',
              onClick: exportJson,
            },
            {
              // Named for what it does. It restores a page this editor
              // exported, and calling it "Import" invited the reasonable
              // assumption that it takes HTML or a Figma file.
              icon: 'upload',
              label: 'Open a saved page file',
              onClick: () => fileInput.current?.click(),
            },
          ]}
        />

        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importJson(file);
            event.target.value = '';
          }}
        />
      </header>

      <Outline
        onAddSection={() => setInsertAt(page.sections.length)}
        page={page}
        selectedKey={selectedKey}
        onSelect={select}
        onCommit={commit}
        onPickBlock={setPicker}
        newId={newId}
      />

      <Canvas
        onInsertSection={setInsertAt}
        page={page}
        selectedKey={selectedKey}
        selected={selected}
        viewportWidth={VIEWPORT_WIDTH[viewport]}
        viewport={viewport}
        onSelect={select}
        onCommit={commit}
        onPickBlock={setPicker}
      />

      <Properties
        page={page}
        selected={selected}
        isStaff={isStaff}
        onSelect={select}
        onCommit={commit}
        onBack={() => setMobilePane('canvas')}
      />

      {insertAt !== null && (
        <LayoutPicker
          onClose={() => setInsertAt(null)}
          onPick={(layout) => {
            const at = insertAt;
            setInsertAt(null);
            commit((current) => {
              const sections = [...current.sections];
              sections.splice(at, 0, createSectionFromLayout(layout));
              return { ...current, sections };
            });
            setSelected({ kind: 'section', section: at });
          }}
        />
      )}

      {picker && (
        <BlockPicker
          isStaff={isStaff}
          onClose={() => setPicker(null)}
          onPick={(type) => {
            const target = picker;
            setPicker(null);

            // Computed here rather than inside the updater: a state updater
            // must be pure, and React calls it twice in development. The new
            // block always lands last in the column, so the index is known
            // without reading the result back.
            const index = page.sections[target.section]?.rows[target.row]?.columns[target.column]
              ?.blocks.length;
            if (index === undefined) return;

            commit((current) => addBlock(current, target.section, target.row, target.column, createBlock(type)));
            setSelected({ kind: 'block', ...target, block: index });
          }}
        />
      )}
    </div>
  );
}
