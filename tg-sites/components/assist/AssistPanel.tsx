'use client';

/**
 * The Luna Assist panel: the conversation, in the editor rail and on the
 * dashboard.
 *
 * ANDY CHOSE THIS SHAPE on 17 Sep 2026, direction A of three on the canvas in
 * docs/tg-sites-copilot-review.md: the assistant lives in the 320px column the
 * rail already opens for Layers and Pages, and the same conversation opens as a
 * drawer on the site dashboard. One component serves both; `variant` only
 * decides the frame it sits in.
 *
 * WHAT IT SAYS IS TEXT, NEVER MARKUP. The answer is rendered as a string in a
 * text node, so React escapes it and CSS keeps its line breaks. That is the
 * client-side half of the rule the server keeps: a model talked into
 * misbehaving can produce a rude paragraph, it cannot produce a script tag.
 *
 * TWO MODES, AND THE SWITCH ONLY EXISTS WHERE IT MEANS SOMETHING. Plan reads
 * and advises. Build may propose changes, which arrive here as a list the
 * person applies or skips: the model's reach ends at a proposal, and the
 * editor is what writes (see onApply). On the dashboard there is no page open
 * and no history to apply into, so there is no switch and no Build, rather
 * than a control that would not work.
 *
 * The parsing, the thread and the wording of "what it looked at" are in
 * lib/assist/client.ts, which is pure and tested. This file is the frame, the
 * fetch and the scroll position.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ASSISTANT_NAME } from '../../lib/assist/brand';
import {
  assistRequest,
  describeTools,
  readEvents,
  type AssistChange,
  type AssistTurn,
} from '../../lib/assist/client';

/** Openers, in the language of the job. One click fills the box. */
const RAIL_PROMPTS = [
  'What would you improve on this page?',
  'Tighten the words on this page',
  'Which pages have no search listing?',
];

const DRAWER_PROMPTS = [
  'What did people ask about last week?',
  'What should I fix first?',
  'Turn this client email into a task list',
];

function Sparkle({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8" />
    </svg>
  );
}

export interface AssistPanelProps {
  /** Where it is drawn: the rail's column, or the dashboard drawer. */
  variant?: 'rail' | 'drawer';
  /** The site's name for the chip. Falls back to a plain phrase. */
  siteName?: string | null;
  /** The page being edited, when there is one. */
  pageId?: string | null;
  pageTitle?: string | null;
  /**
   * The section the person has selected on the canvas, if any. It follows the
   * selection, so clicking another section moves the chip with it: the panel
   * shows what they are looking at rather than what they were looking at.
   */
  sectionId?: string | null;
  sectionLabel?: string | null;
  /**
   * Applies a proposal, in the editor, through its own history as one step.
   * Absent on the dashboard, where there is no page open and no history to
   * apply into: the panel then shows the changes and says where to apply them.
   * Returns how many changes went in.
   */
  onApply?: (operations: readonly unknown[], changes: readonly AssistChange[]) => Promise<number> | number;
  /** The drawer's close button. Absent in the rail, which the rail icon folds. */
  onClose?: () => void;
  /** Overrides the openers, for a test or a harness. */
  prompts?: readonly string[];
}

export function AssistPanel({
  variant = 'rail',
  siteName = null,
  pageId = null,
  pageTitle = null,
  sectionId = null,
  sectionLabel = null,
  onApply,
  onClose,
  prompts,
}: AssistPanelProps) {
  const [turns, setTurns] = useState<AssistTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [usePage, setUsePage] = useState(true);
  const [useSection, setUseSection] = useState(true);
  /* Build is only on the table where there is a page open and a history to
     apply into. On the dashboard the switch is not drawn at all. */
  const canBuild = Boolean(pageId && onApply);
  const [mode, setMode] = useState<'plan' | 'build'>('plan');
  const building = canBuild && mode === 'build';

  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const turnsRef = useRef<AssistTurn[]>([]);
  turnsRef.current = turns;

  /* Clicking another section is a new intent, so a chip switched off for the
     last one does not stay off for this one. */
  useEffect(() => {
    setUseSection(true);
  }, [sectionId]);

  /* A request in flight when the panel closes is a request nobody is waiting
     for. The server still finishes the turn and the ledger still records it,
     which is the honest outcome: it was asked for and it was paid for. */
  useEffect(() => () => abortRef.current?.abort(), []);

  /* Follow the answer as it arrives, unless the person has scrolled up to read
     something earlier, in which case leave them where they are. */
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const fromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    if (fromBottom < 120) thread.scrollTop = thread.scrollHeight;
  }, [turns]);

  const patch = useCallback((id: string, change: Partial<AssistTurn>) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, ...change } : turn)));
  }, []);

  const send = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || busy) return;

      const askId = `u${(nextId.current += 1)}`;
      const answerId = `a${(nextId.current += 1)}`;
      const history = turnsRef.current;

      setTurns((current) => [
        ...current,
        { id: askId, role: 'user', text },
        { id: answerId, role: 'assistant', text: '', streaming: true },
      ]);
      setDraft('');
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/assist', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            assistRequest({
              message: text,
              pageId: usePage ? pageId : null,
              sectionId: useSection ? sectionId : null,
              mode: building ? 'build' : 'plan',
              turns: history,
            }),
          ),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
          const said = typeof body?.error === 'string' ? body.error : null;
          patch(answerId, {
            streaming: false,
            failed: true,
            text: said ?? 'The assistant could not answer that. Try again in a moment.',
          });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamed = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = readEvents(buffer);
          buffer = rest;
          for (const event of events) {
            if (event.type === 'text') {
              streamed += event.delta;
              patch(answerId, { text: streamed });
            } else if (event.type === 'answer') {
              patch(answerId, {
                streaming: false,
                text: event.text || streamed,
                tools: event.toolsUsed ?? [],
                question: null,
              });
            } else if (event.type === 'question') {
              patch(answerId, {
                streaming: false,
                text: event.text || streamed,
                tools: event.toolsUsed ?? [],
                question: { question: event.question, options: event.options ?? [] },
              });
            } else if (event.type === 'proposal') {
              patch(answerId, {
                streaming: false,
                text: event.text || streamed,
                tools: event.toolsUsed ?? [],
                proposal: {
                  changes: event.changes ?? [],
                  operations: event.operations ?? [],
                  refused: event.refused ?? [],
                },
              });
            } else if (event.type === 'error') {
              patch(answerId, { streaming: false, failed: true, text: event.message });
            }
          }
        }

        /* The stream ended without a closing line: a dropped connection, or a
           deployment mid-answer. Whatever arrived is kept, and it is said. */
        setTurns((current) =>
          current.map((turn) =>
            turn.id === answerId && turn.streaming
              ? {
                  ...turn,
                  streaming: false,
                  failed: turn.text.length === 0,
                  text: turn.text || 'That answer stopped before it finished. Try asking again.',
                }
              : turn,
          ),
        );
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return;
        patch(answerId, {
          streaming: false,
          failed: true,
          text: 'Could not reach the assistant. Check your connection and try again.',
        });
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [building, busy, pageId, patch, sectionId, usePage, useSection],
  );

  const settle = useCallback(
    async (turn: AssistTurn, how: 'applied' | 'skipped') => {
      if (!turn.proposal || turn.settled) return;
      if (how === 'skipped' || !onApply) {
        patch(turn.id, { settled: 'skipped' });
        return;
      }
      const applied = await onApply(turn.proposal.operations, turn.proposal.changes);
      patch(turn.id, { settled: applied > 0 ? 'applied' : 'skipped' });
    },
    [onApply, patch],
  );

  const openers = prompts ?? (variant === 'drawer' ? DRAWER_PROMPTS : RAIL_PROMPTS);
  const empty = turns.length === 0;

  return (
    <aside
      className={variant === 'rail' ? 'ed-outline ed-assist' : 'ed-assist ed-assist--drawer'}
      aria-label={ASSISTANT_NAME}
    >
      <div className="ed-assist__head">
        <span className="ed-assist__title">
          <span className="ed-assist__mark" aria-hidden="true">
            <Sparkle />
          </span>
          {ASSISTANT_NAME}
        </span>
        {canBuild ? (
          <span className="ed-assist__modes" role="group" aria-label="What it may do">
            {(['plan', 'build'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="ed-assist__mode-btn"
                aria-pressed={mode === option}
                disabled={busy}
                title={option === 'plan' ? 'Read and advise only' : 'Propose changes you can apply'}
                onClick={() => setMode(option)}
              >
                {option === 'plan' ? 'Plan' : 'Build'}
              </button>
            ))}
          </span>
        ) : (
          <span className="ed-assist__mode">Plan</span>
        )}
        {onClose && (
          <button type="button" className="ed-assist__close" onClick={onClose} aria-label="Close the assistant">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>

      <div className="ed-assist__chips">
        <span className="ed-assist__chip">{siteName || 'This site'}</span>
        {pageId && (
          <button
            type="button"
            className="ed-assist__chip ed-assist__chip--button"
            aria-pressed={usePage}
            title={usePage ? 'Stop showing it this page' : 'Show it this page again'}
            onClick={() => setUsePage((on) => !on)}
          >
            {pageTitle || 'This page'}
            <span className="ed-assist__chip-x" aria-hidden="true">
              {usePage ? '×' : '+'}
            </span>
          </button>
        )}
        {pageId && usePage && sectionId && (
          <button
            type="button"
            className="ed-assist__chip ed-assist__chip--button"
            aria-pressed={useSection}
            title={useSection ? 'Stop pointing it at this section' : 'Point it at this section again'}
            onClick={() => setUseSection((on) => !on)}
          >
            {sectionLabel || 'This section'}
            <span className="ed-assist__chip-x" aria-hidden="true">
              {useSection ? '×' : '+'}
            </span>
          </button>
        )}
      </div>

      <div className="ed-assist__thread" ref={threadRef} aria-busy={busy}>
        {empty ? (
          <div className="ed-assist__empty">
            <p className="ed-assist__empty-lead">
              Ask about this site and it will go and look before it answers: the pages, the
              words on them, the results board and the enquiries.
            </p>
            <p className="ed-assist__empty-note">
              {canBuild
                ? 'In Plan it reads and advises. In Build it proposes changes, and nothing changes until you apply them.'
                : 'It reads and advises. It cannot change anything.'}
            </p>
          </div>
        ) : (
          <ol className="ed-assist__turns">
            {turns.map((turn) =>
              turn.role === 'user' ? (
                <li key={turn.id} className="ed-assist__turn ed-assist__turn--you">
                  <p className="ed-assist__said">{turn.text}</p>
                </li>
              ) : (
                <li key={turn.id} className="ed-assist__turn">
                  <span className="ed-assist__mark ed-assist__mark--turn" aria-hidden="true">
                    <Sparkle size={14} />
                  </span>
                  <div className="ed-assist__body">
                    {turn.streaming && !turn.text ? (
                      <p className="ed-assist__thinking">Reading, then thinking</p>
                    ) : (
                      <p
                        className={turn.failed ? 'ed-assist__answer ed-assist__answer--failed' : 'ed-assist__answer'}
                        aria-live={turn.streaming ? 'polite' : undefined}
                      >
                        {turn.text}
                      </p>
                    )}
                    {turn.question && (
                      <div className="ed-assist__question">
                        <p className="ed-assist__question-text">{turn.question.question}</p>
                        <div className="ed-assist__options">
                          {turn.question.options.map((option) => (
                            <button
                              key={option}
                              type="button"
                              className="ed-assist__option"
                              disabled={busy}
                              onClick={() => void send(option)}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {turn.proposal && (
                      <div className="ed-assist__proposal">
                        <p className="ed-assist__proposal-head">
                          {turn.proposal.changes.length === 1
                            ? 'One change, yours to apply'
                            : `${turn.proposal.changes.length} changes, yours to apply`}
                        </p>
                        <ol className="ed-assist__changes">
                          {turn.proposal.changes.map((change, index) => (
                            <li key={`${turn.id}-${index}`} className="ed-assist__change">
                              <p className="ed-assist__change-what">{change.label}</p>
                              {change.before && <p className="ed-assist__change-was">{change.before}</p>}
                              <p className="ed-assist__change-now">{change.after}</p>
                              {change.why && <p className="ed-assist__change-why">{change.why}</p>}
                            </li>
                          ))}
                        </ol>
                        {turn.proposal.refused.length > 0 && (
                          <p className="ed-assist__refused">
                            {turn.proposal.refused.length === 1
                              ? 'One more was refused: '
                              : `${turn.proposal.refused.length} more were refused: `}
                            {turn.proposal.refused.join(' ')}
                          </p>
                        )}
                        {turn.settled ? (
                          <p className="ed-assist__settled">
                            {turn.settled === 'applied'
                              ? 'Applied. Undo puts it back, in one step.'
                              : 'Skipped. Nothing changed.'}
                          </p>
                        ) : onApply ? (
                          <div className="ed-assist__actions">
                            <button
                              type="button"
                              className="ed-assist__apply"
                              onClick={() => void settle(turn, 'applied')}
                            >
                              {turn.proposal.changes.length === 1 ? 'Apply it' : 'Apply all'}
                            </button>
                            <button
                              type="button"
                              className="ed-assist__skip"
                              onClick={() => void settle(turn, 'skipped')}
                            >
                              Skip
                            </button>
                          </div>
                        ) : (
                          <p className="ed-assist__settled">
                            Open this page in the editor to apply these.
                          </p>
                        )}
                      </div>
                    )}
                    {!turn.streaming && turn.tools && turn.tools.length > 0 && (
                      <p className="ed-assist__tools">{describeTools(turn.tools)}</p>
                    )}
                  </div>
                </li>
              ),
            )}
          </ol>
        )}
      </div>

      <div className="ed-assist__foot">
        {empty && (
          <div className="ed-assist__prompts">
            {openers.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="ed-assist__prompt"
                onClick={() => {
                  setDraft(prompt);
                  inputRef.current?.focus();
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        <form
          className="ed-assist__composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <label className="ed-assist__label" htmlFor="ed-assist-message">
            Ask {ASSISTANT_NAME}
          </label>
          <textarea
            id="ed-assist-message"
            ref={inputRef}
            className="ed-assist__input"
            rows={2}
            value={draft}
            placeholder={
              pageId && usePage
                ? sectionId && useSection
                  ? `Ask about ${sectionLabel ? `the ${sectionLabel.toLowerCase()}` : 'this section'}`
                  : 'Ask about this page'
                : 'Ask about this site'
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
          />
          <div className="ed-assist__send-row">
            <span className="ed-assist__hint">Enter sends, Shift and Enter for a new line</span>
            <button type="submit" className="ed-assist__send" disabled={busy || !draft.trim()}>
              {busy ? 'Thinking' : 'Ask'}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
