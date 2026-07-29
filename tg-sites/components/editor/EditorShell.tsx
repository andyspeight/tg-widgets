'use client';

/**
 * The editor.
 *
 * Owns the page, the selection, the history and the autosave. Everything
 * else in components/editor is presentational and talks back through the
 * callbacks handed down from here.
 *
 * WHERE THE DRAFT LIVES
 * localStorage, for now. There is no database in this package. The shape of
 * `commit` is already what a server action will want, so swapping the
 * persistence layer later is a change to two functions, not to the editor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Page } from '../../lib/content/schema';
import { parsePage } from '../../lib/content/schema';
import { SEED_PAGE } from '../../lib/content/seed';
import { createBlock, newId } from '../../lib/content/factory';
import { addBlock, type Path, pathKey, resolve } from '../../lib/content/tree';
import { Outline } from './Outline';
import { Canvas } from './Canvas';
import { Properties } from './Properties';
import { BlockPicker } from './BlockPicker';
import { Icon, type IconName } from './Icon';
import { Menu } from './Menu';
import './editor.css';

const STORAGE_KEY = 'tg-sites:draft:v1';
const HISTORY_LIMIT = 50;
/** Edits to the same field inside this window collapse into one undo step. */
const COALESCE_MS = 700;

export type Viewport = 'desktop' | 'tablet' | 'phone';

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

export function EditorShell({ isStaff = true }: { isStaff?: boolean }) {
  const [history, setHistory] = useState<History>({
    past: [],
    present: SEED_PAGE,
    future: [],
  });
  const [selected, setSelected] = useState<Path | null>(null);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [picker, setPicker] = useState<{ section: number; row: number; column: number } | null>(null);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [mobilePane, setMobilePane] = useState<'canvas' | 'props' | 'outline'>('canvas');

  const page = history.present;

  /** Identifies the last edit, so rapid edits to one field coalesce. */
  const lastEdit = useRef<{ key: string; at: number } | null>(null);

  // ---------------------------------------------------------------------
  // Load the saved draft
  // ---------------------------------------------------------------------

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private browsing or a blocked origin. The seed page is a fine
      // fallback and the editor still works, it just will not persist.
      return;
    }
    if (!raw) return;

    try {
      const result = parsePage(JSON.parse(raw));
      if (result.ok) {
        setHistory({ past: [], present: result.page, future: [] });
      } else {
        console.warn('[tg-sites] saved draft failed validation, starting fresh', result.errors);
      }
    } catch {
      console.warn('[tg-sites] saved draft was not valid JSON, starting fresh');
    }
  }, []);

  // ---------------------------------------------------------------------
  // Autosave
  // ---------------------------------------------------------------------

  useEffect(() => {
    setSaved('saving');
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(page));
        setSaved('saved');
      } catch {
        setSaved('idle');
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [page]);

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

  // Warn on navigate away while a save is still pending.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (saved === 'saving') event.preventDefault();
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
    // "Saved to this browser" was developer-speak. An agent wants to know
    // their work is safe, not where the bytes went.
    if (saved === 'saving') return 'Saving';
    if (saved === 'saved') return 'All changes saved';
    return '';
  }, [saved]);

  // ---------------------------------------------------------------------

  return (
    <div className="ed-root" data-pane={mobilePane}>
      <header className="ed-topbar">
        <span className="ed-brand">
          <span className="ed-brand__mark" aria-hidden="true">
            TG
          </span>
          <span>Sites</span>
        </span>

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
            {savedLabel}
          </span>
        </div>

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

        <Menu
          label="More actions"
          items={[
            {
              icon: 'download',
              label: 'Export this page',
              onClick: exportJson,
            },
            {
              icon: 'upload',
              label: 'Import a page',
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
        page={page}
        selectedKey={selectedKey}
        onSelect={select}
        onCommit={commit}
        onPickBlock={setPicker}
        newId={newId}
      />

      <Canvas
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
