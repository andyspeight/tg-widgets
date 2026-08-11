/**
 * Break the code on purpose and confirm the checks notice.
 *
 * A check written after the fix is a check that has never failed. Several in
 * this repo passed for the wrong reason until they were probed: one framing
 * check read a border its own rule was not drawing, and a preset check needed
 * three attempts before it was capable of failing at all. Each mutation below
 * reintroduces the exact bug its check exists to catch.
 *
 *   node tools/probe-checks.mjs
 *
 * Every mutation is applied to a real source file and restored afterwards, so
 * it REFUSES TO RUN unless the tree is committed: see the guard below for what
 * happened the time it was not. Roughly a minute per mutation, being a full
 * rebuild and the whole browser suite each time, so give it twenty.
 *
 * WHEN THE SOURCE MOVES, THIS BREAKS, and it says "could not apply" and exits
 * non-zero rather than skipping. That is deliberate. A probe that quietly stops
 * probing is worse than no probe, because it goes on printing reassurance.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * The browser suites a mutation can be checked against.
 *
 * Two, because the editor and the settings screen are separate harnesses with
 * separate bundles. A mutation names the one whose checks are supposed to catch
 * it, and running only that suite keeps a probe to about a minute rather than
 * building both every time.
 */
const SUITES = {
  editor: {
    build: 'node tools/build-standalone.mjs',
    verify: 'node tools/verify-standalone.mjs',
  },
  settings: {
    build: 'node tools/build-theme-harness.mjs',
    verify: 'node tools/verify-settings.mjs',
  },
};

const MUTATIONS = [
  {
    check: 'selecting the words with the mouse keeps the toolbar',
    why: "Andy's bug: tie the toolbar back to focus so a drag closes it.",
    file: 'components/editor/TextToolbar.tsx',
    from: '  if (!position) return null;',
    to: `  useEffect(() => {
    const close = () => setPosition(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!position) return null;`,
  },
  {
    check: 'typing lands where the caret is, not at the start',
    why: 'Let React render children into the host, so it fights the caret.',
    file: 'components/render/blocks.tsx',
    from: `  if (editingHost) {
    return <div className="tgs-text" data-size={size} data-rt-host="" suppressHydrationWarning />;
  }`,
    to: `  if (editingHost) {
    return (
      <div
        className="tgs-text"
        data-size={size}
        data-rt-host=""
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }`,
  },
  {
    check: 'the pane field catches up with what was typed on the canvas',
    why: 'Seed the pane field once on mount, as it was before.',
    file: 'components/editor/Fields.tsx',
    from: `    if (document.activeElement === node) return;
    if (node.innerHTML !== html) node.innerHTML = html;
  }, [html]);`,
    to: `    if (document.activeElement === node) return;
    if (node.innerHTML !== html) node.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);`,
  },
  {
    check: 'a properties field label names and focuses its control',
    why: 'Draw the field as a bare div again, so a grouped control loses the label that named it.',
    file: 'components/editor/Fields.tsx',
    from: `    <div className="ed-field" role={group ? 'group' : undefined} aria-labelledby={group ? labelId : undefined}>`,
    to: '    <div className="ed-field">',
  },
  {
    check: 'and typing in the pane still reaches the canvas',
    why: 'Drop the canvas catch-up effect, so the canvas ignores pane edits.',
    file: 'components/editor/Canvas.tsx',
    from: `    if (!host || !editingValue) return;
    if (document.activeElement === host) return;`,
    to: `    if (!host || !editingValue) return;
    if (document.activeElement === host) return;
    if (1) return;`,
  },
  {
    check: 'Enter in a heading is refused rather than silently mangled',
    why: 'Let Enter through, so the browser puts a div inside the heading.',
    file: 'components/editor/Canvas.tsx',
    // plainHost until 31 Jul 2026, when the attribute split into "one line" and
    // "holds no markup" and only the first stayed true of a heading.
    from: `      if (oneLine && event.key === 'Enter') {`,
    to: `      if (false && oneLine && event.key === 'Enter') {`,
  },
  {
    check: 'a refused address is explained rather than silently swallowed',
    why: 'Go back to clearing the box and saying nothing.',
    file: 'components/editor/TextToolbar.tsx',
    from: `      setRefused(true);
      return;`,
    to: `      setHref('');
      return;`,
  },
  {
    check: 'a heading is typed in place as well',
    why: 'Stop offering headings as editable hosts.',
    file: 'components/editor/EditorShell.tsx',
    from: `    if (block?.type !== 'text' && block?.type !== 'heading') return null;`,
    to: `    if (block?.type !== 'text') return null;`,
  },
  {
    check: 'one click makes the words themselves editable',
    why: 'Never mark the host contentEditable.',
    file: 'components/editor/Canvas.tsx',
    from: `    host.contentEditable = 'true';
    host.spellcheck = true;`,
    to: `    host.spellcheck = true;`,
  },

  // --- colour, size, font and alignment -----------------------------------

  {
    check: 'and it stores the theme token, so the words follow the theme',
    why: 'Offer the swatches as the hex they resolve to today, freezing the brand.',
    file: 'lib/content/styles.ts',
    from: `  { value: 'var(--tgs-accent)', label: 'Accent' },
  { value: 'var(--tgs-text-invert)', label: 'For a dark background' },`,
    to: `  { value: '#00b4d8', label: 'Accent' },
  { value: 'var(--tgs-text-invert)', label: 'For a dark background' },`,
  },
  {
    check: 'and it survives the sanitiser rather than vanishing',
    why: 'Go back to dropping every style attribute, which is the bug Andy hit.',
    file: 'lib/content/sanitise.ts',
    from: `    if (name === 'style') {`,
    to: `    if (name === 'style') {
      continue;`,
  },
  {
    check: 'and the size survives the sanitiser, not just the canvas',
    why: 'Let the sanitiser keep the attribute but strip the size out of it.',
    file: 'lib/content/styles.ts',
    from: `  'font-size': sizeValue,`,
    to: `  'font-size': () => null,`,
  },
  {
    check: 'styling a whole paragraph sets it on the paragraph, not in a span around it',
    why: 'Wrap everything in one span, including block elements.',
    file: 'components/editor/EditorShell.tsx',
    from: `    if (element && BLOCK_TAGS.has(element.tagName)) {`,
    to: `    if (false && element && BLOCK_TAGS.has(element.tagName)) {`,
  },
  {
    check: 'alignment drives the block, and the properties pane agrees',
    why: 'Spell it the CSS way, which the block discards as an unknown value.',
    file: 'components/editor/TextToolbar.tsx',
    from: `  { value: 'centre', icon: 'align-centre', title: 'Align centre' },`,
    to: `  { value: 'center', icon: 'align-centre', title: 'Align centre' },`,
  },
  {
    check: 'a colour of your own is taken as a hex',
    why: 'Do not put the selection back, so the colour paints the empty input.',
    file: 'components/editor/TextToolbar.tsx',
    from: `    const range = savedRange.current;
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    paint(tray ?? 'color', value);`,
    to: `    paint(tray ?? 'color', value);`,
  },
  {
    check: 'and one that is not a colour we keep is refused rather than half applied',
    why: 'Take whatever was typed, and let the sanitiser be the only gate.',
    file: 'components/editor/TextToolbar.tsx',
    from: `    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(value)) return;`,
    to: '',
  },
  {
    check: 'the toolbar keeps clear of the words even when it grows',
    why: 'Stop re-anchoring once measured, so a two-row bar sits over the words.',
    file: 'components/editor/TextToolbar.tsx',
    from: `          anchorTop.current !== null && measured`,
    to: `          false && anchorTop.current !== null && measured`,
  },
  // --- moving a column, and which way things sit --------------------------

  {
    check: 'and its width goes with it',
    why: 'Swap the contents and leave the widths, so a moved column changes size.',
    file: 'lib/content/tree.ts',
    from: `    return { ...r, columns: moveInArray(r.columns, from, to) };`,
    to: `    const swapped = moveInArray(r.columns, from, to);
    const widths = r.columns.map((c) => c.width);
    return { ...r, columns: swapped.map((c, i) => ({ ...c, width: widths[i] })) };`,
  },
  {
    check: 'the content in a column can sit side by side',
    why: 'Never emit the attribute the side-by-side rule hangs off.',
    file: 'components/render/PageRenderer.tsx',
    from: `      data-flow={column.flow === 'row' ? 'row' : undefined}`,
    to: `      data-flow={undefined}`,
  },
  {
    check: "a row's columns can be stacked at every width",
    why: 'Drop the always-stacked rule, so the setting stores and does nothing.',
    file: 'app/globals.css',
    from: `.tgs-row[data-stack='always'] { grid-template-columns: 1fr; }`,
    to: '',
  },
  {
    check: 'and the breakpoint question goes away, because it has no answer left',
    why: 'Ask where to stack a row that is already always stacked.',
    file: 'components/editor/Properties.tsx',
    from: `      {node.stackBelow !== 'always' && (`,
    to: `      {true && (`,
  },
  {
    check: 'and fits on one row on an ordinary screen',
    why: 'Put the width cap back where it forced a second row holding two buttons.',
    file: 'components/editor/editor.css',
    from: `  max-width: min(900px, calc(100vw - 32px));`,
    to: `  max-width: min(700px, calc(100vw - 32px));`,
  },

  // --- the widget blocks ---------------------------------------------------

  {
    tag: 'widget',
    check: 'and the editor loads no widget script at all',
    /*
     * The failure this block's design exists to prevent, and the one that is
     * invisible: the canvas would look exactly the same. Emitting the scripts
     * regardless of `editable` is the obvious way to write PageRenderer, and it
     * would re-run every widget on every keystroke.
     */
    why: 'Emit the widget scripts in the editor too, which re-runs them on every keystroke.',
    file: 'components/render/PageRenderer.tsx',
    from: `      {!editable
        && widgetScriptsFor(widgetTagsIn(page)).map((src) => (`,
    to: `      {true
        && widgetScriptsFor(widgetTagsIn(page)).map((src) => (`,
  },
  {
    tag: 'widget',
    check: 'nor draws the container the script would fill',
    why: 'Draw the real container on the canvas rather than the labelled placeholder.',
    file: 'components/render/blocks.tsx',
    from: `  if (editing) {
    return (
      <div className="tgs-widget-ghost">`,
    to: `  if (false) {
    return (
      <div className="tgs-widget-ghost">`,
  },
  {
    tag: 'widget',
    check: 'and their code does not run on the canvas either',
    why: "Run somebody else's embed on the canvas, so it reloads on every keystroke.",
    file: 'components/render/blocks.tsx',
    from: `  if (editing) {
    return (
      <div className="tgs-widget-ghost" style={{ minHeight: height }}>`,
    to: `  if (false) {
    return (
      <div className="tgs-widget-ghost" style={{ minHeight: height }}>`,
  },
  {
    tag: 'widget',
    check: 'and asks for the ID rather than rendering an empty box',
    why: 'Render the container with no id, which publishes a box that never fills.',
    file: 'components/render/blocks.tsx',
    from: `  if (!kind || !id) {`,
    to: `  if (false) {`,
  },
  {
    tag: 'widget',
    check: 'including both ways to put a widget on a page',
    /*
     * A GROUP THE PICKER DOES NOT DRAW, which is the shape of bug that removes a
     * card while the block still exists and everything still typechecks.
     *
     * The first attempt made the block staffOnly and the probe reported MISSED.
     * blocksByGroup keeps a staff-only block when isStaff, and the standalone
     * harness runs as staff, so the card was still there. The claim that a
     * client can reach these blocks is not one the harness can make: it lives in
     * tests/content.test.ts instead, where staffOnly is read off the registry.
     */
    why: 'Put the block in a group the picker does not draw, so its card disappears.',
    file: 'lib/content/blocks.ts',
    from: `    type: 'embed-widget',
    label: 'Embedded widget',
    group: 'Advanced',`,
    to: `    type: 'embed-widget',
    label: 'Embedded widget',
    group: 'Nowhere',`,
  },
  {
    tag: 'widget',
    check: 'a widget keeps its frame when the page is previewed',
    /*
     * Andy's bug, 11 Aug 2026: key the widget on `editable` again. Preview turns
     * `editable` off to render the published DOM, so the widget flips to the bare
     * container the published page fills with a script, but the editor renders no
     * script, so the container stays empty and the section goes blank. The whole
     * fix is that the widget reads `editorCanvas`, which stays true across preview.
     */
    why: 'Key the widget on `editable`, so Preview drops it to the container the editor never fills.',
    file: 'components/render/BlockRenderer.tsx',
    from: `      case 'widget':
        return <WidgetBlock props={props} editing={editorCanvas} />;`,
    to: `      case 'widget':
        return <WidgetBlock props={props} editing={editable} />;`,
  },

  // --- a heading holds markup ----------------------------------------------

  {
    tag: 'heading',
    check: 'a heading gets the formatting toolbar too',
    why: 'Put the paragraphs-only gate back, which is the bug Andy reported.',
    file: 'components/editor/EditorShell.tsx',
    from: `      {editing && (
        <TextToolbar`,
    to: `      {editing && !editing.oneLine && (
        <TextToolbar`,
  },
  {
    tag: 'heading',
    check: 'but not the commands that would put a block inside a heading',
    why: 'Offer the block formats in a heading, so formatBlock can nest a p inside an h2.',
    file: 'components/editor/TextToolbar.tsx',
    from: `      {!oneLine && (
        <select
          className="ed-tt__block"
          value={currentBlock()}`,
    to: `      {true && (
        <select
          className="ed-tt__block"
          value={currentBlock()}`,
  },
  {
    tag: 'heading',
    check: 'formatting a heading reaches the page state, so it survives a save',
    /*
     * IN withHost, NOT IN Canvas's onInput, and the first version of this got
     * that wrong. It mutated onInput to read textContent back for a one-line
     * host, and the probe reported MISSED. onInput only handles TYPING: a
     * toolbar command goes execCommand -> onExec -> withHost, which reads the
     * host and commits {html} itself. Mutating the typing path could not affect
     * a check about pressing Bold, so nothing broke and nothing failed.
     *
     * Worth keeping written down, because "which door does this edit come
     * through" is the thing that makes this component hard to reason about.
     */
    why: 'Read the host back as text, so a toolbar command never reaches state as markup.',
    file: 'components/editor/EditorShell.tsx',
    from: `      host.focus();
      const html = act(host);`,
    to: `      host.focus();
      act(host);
      const html = host.textContent ?? '';`,
  },
  {
    tag: 'heading',
    check: 'a section names itself from its heading',
    why: 'Read props.text again, which is where a heading no longer keeps its words.',
    file: 'lib/content/naming.ts',
    from: `        const text = headingWords(block.props);`,
    to: `        const text = typeof block.props?.text === 'string' ? block.props.text.trim() : '';`,
  },
  // Enter in a heading has a mutation already, further up. It was written when
  // the attribute was called plainHost and it was UPDATED rather than duplicated
  // here: two mutations sharing one check name means the probe reports on
  // whichever ran last, and the stale one prints "could not apply" for ever.

  // --- the writing assistant -----------------------------------------------

  {
    tag: 'assistant',
    check: 'and the copy is in the page state, not only on the canvas',
    /*
     * SET innerHTML, which is the version of this bug that actually escapes.
     *
     * The first attempt at this mutation was execCommand('insertHTML') instead of
     * onExec, and the probe reported MISSED: the check passed anyway. That is not
     * a hole in the check, it is Canvas.tsx doing its job. It listens for `input`,
     * and execCommand fires one, so the copy still reached the page state by the
     * ordinary typing path. The mutation was not a bug.
     *
     * Assigning innerHTML fires NOTHING. The words appear on the canvas, the
     * state never hears about them, and they are gone on the next render or the
     * next save. That is the failure this check exists for, and it is exactly
     * what somebody reaches for when insertHTML looks like overkill.
     */
    why: 'Set innerHTML, which puts words on the canvas that the page state never hears about.',
    file: 'components/editor/TextToolbar.tsx',
    from: `    onExec('insertHTML', result.data.html);`,
    to: `    const rtHost = document.querySelector('[data-rt-host]');
    if (rtHost) rtHost.innerHTML += result.data.html;`,
  },
  {
    tag: 'assistant',
    check: 'making it shorter replaces the words rather than adding to them',
    why: 'Skip putting the selection back, so the copy lands after the words instead of over them.',
    file: 'components/editor/TextToolbar.tsx',
    from: `    const range = savedRange.current;
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    onExec('insertHTML', result.data.html);`,
    to: `    onExec('insertHTML', result.data.html);`,
  },
  {
    tag: 'assistant',
    check: 'a refusal is shown in the panel rather than swallowed',
    why: 'Return quietly on a refusal, which is a button that does nothing and says nothing.',
    file: 'components/editor/TextToolbar.tsx',
    from: `    if (!result.ok) {
      setFailure(result.error);
      return;
    }`,
    to: `    if (!result.ok) {
      return;
    }`,
  },
  {
    tag: 'assistant',
    check: 'and the quick edits are not offered yet, because there is no this',
    why: 'Offer Improve and Shorter with nothing highlighted, so they act on nothing.',
    file: 'components/editor/TextToolbar.tsx',
    from: `          {selectedText.trim() && (
            <div className="ed-tt__ask-quick">`,
    to: `          {true && (
            <div className="ed-tt__ask-quick">`,
  },
  {
    tag: 'assistant',
    check: 'and it is marked out from the twenty buttons beside it',
    /*
     * NEUTRALISED rather than renamed. Renaming the selector was the first
     * attempt and the probe reported MISSED, for two reasons worth keeping: the
     * check was reading a hover colour, and .is-ai:hover kept its own rule
     * anyway, so the sparkle stayed distinct even with the base rule gone.
     * Giving it the SAME colour as every other button is the bug the check
     * actually names, and it cannot be dodged.
     */
    why: 'Give it the same colour as every other button, so it stops standing out.',
    file: 'components/editor/editor.css',
    from: `.ed-tt__btn.is-ai { color: #a5b4fc; }`,
    to: `.ed-tt__btn.is-ai { color: #cbd5e1; }`,
  },
  {
    tag: 'assistant',
    check: 'the panel opens inside the window, not off the edge of it',
    why: 'Anchor it to the button instead of the bar, which pushes 340px off the right edge.',
    file: 'components/editor/editor.css',
    from: `  top: calc(100% + 6px);
  right: 4px;
  width: 340px;`,
    to: `  top: calc(100% + 6px);
  left: calc(100% - 40px);
  width: 340px;`,
  },

  // --- dragging a new block onto the canvas (dnd-kit) ----------------------

  {
    tag: 'dnd',
    check: 'an element dragged from the left palette lands on the canvas',
    /*
     * The drag ghost follows the pointer, so if it takes pointer events it is
     * what document.elementFromPoint returns and the drop hook never sees the
     * column beneath it. pointerEvents:none on the overlay is what lets the point
     * fall through to the canvas; without it nothing ever lands.
     */
    why: 'Let the drag ghost take pointer events, so it hides the canvas from the drop.',
    file: 'components/editor/EditorShell.tsx',
    from: `<DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>`,
    to: `<DragOverlay dropAnimation={null}>`,
  },
  {
    tag: 'dnd',
    check: 'a block dragged from the picker is added where it is dropped',
    /*
     * The + picker is a modal over the canvas. The scrim recedes only while the
     * body carries data-tg-dragging='block'; set any other value and the CSS no
     * longer matches, the scrim stays solid, and a drag from a picker card cannot
     * reach the canvas under it. The palette has no modal, so only this check
     * feels it.
     */
    why: 'Set the wrong drag flag, so the picker scrim never fades and the drop cannot reach the canvas.',
    file: 'components/editor/EditorShell.tsx',
    from: `        document.body.dataset.tgDragging = 'block';`,
    to: `        document.body.dataset.tgDragging = 'off';`,
  },
  {
    tag: 'dnd',
    check: 'escape mid-drag cancels it and clears the flag',
    /*
     * A cancel must clear the flag, or it sticks on and the scrim-fade CSS makes
     * the next open of the picker invisible (the 5 Aug 2026 bug). Drop the clear
     * from the cancel handler only, leaving the end handler's, so a released drag
     * still tidies up but a cancelled one leaves the flag set.
     */
    why: 'Leave the drag flag set on cancel, the sticking bug from 5 Aug 2026.',
    file: 'components/editor/EditorShell.tsx',
    from: `        paletteDrop.hide();
        activeDragRef.current = null;
        setActiveDrag(null);
        delete document.body.dataset.tgDragging;`,
    to: `        paletteDrop.hide();
        activeDragRef.current = null;
        setActiveDrag(null);`,
  },

  {
    tag: 'dnd',
    check: 'a placed block is moved by dragging its gutter handle',
    /*
     * The handle drag resolves a target through the same hook as adding; the
     * shell then dispatches to moveBlockTo. Cut the move arm of that dispatch and
     * the drag still resolves and still ends, but the block never moves, so it
     * stays selected where it started rather than landing lower down its column.
     */
    why: 'Drop the move dispatch, so the handle drag resolves a target but never moves the block.',
    file: 'components/editor/EditorShell.tsx',
    from: `      if (drag.kind === 'add') addBlockAt(target, drag.type);
      else if (drag.kind === 'move') moveBlockAt(drag.from, target);`,
    to: `      if (drag.kind === 'add') addBlockAt(target, drag.type);
      else if (drag.kind === 'move') return;`,
  },
  {
    tag: 'dnd',
    check: 'a section is moved by dragging its handle',
    /*
     * The section handle resolves a gap through useSectionDrop; the shell then
     * dispatches to moveSection. Cut that dispatch and the section drag still
     * resolves a gap and still ends, but the section never moves, so it stays
     * selected where it started rather than at the gap it was dropped on.
     */
    why: 'Drop the section move dispatch, so the handle drag resolves a gap but never moves the section.',
    file: 'components/editor/EditorShell.tsx',
    from: `      if (drag?.kind === 'move-section') moveSectionAt(drag.from, gap);`,
    to: `      if (drag?.kind === 'move-section') return;`,
  },
  {
    tag: 'preview',
    check: 'preview shows the published page full width, then restores editing',
    /*
     * Preview is editable=false on the canvas: that is the one lever that turns
     * the editing DOM into the published one. Force it back to always-editable
     * and the panels still hide, but the canvas keeps its data-path hooks, so the
     * check sees editing hooks on a canvas that should be showing the published
     * page.
     */
    why: 'Render the canvas editable in preview too, so the published-DOM tell never appears.',
    file: 'components/editor/Canvas.tsx',
    from: `editable={!preview}`,
    to: `editable={true}`,
  },
  {
    tag: 'preview',
    check: 'preview fills the canvas even with the panels folded',
    /*
     * The folded rule is more specific than the preview one, so without the guard
     * it keeps the columns at `0 1fr 0` while the preview areas collapse to a single
     * `canvas` column. The canvas maps to the 0px track and the screen goes blank.
     */
    why: 'Let the both-folded rule apply in preview, so the canvas maps to a 0px track and goes blank.',
    file: 'components/editor/editor.css',
    from: `  .ed-root[data-outline='folded'][data-props='folded']:not([data-preview='true']) {`,
    to: `  .ed-root[data-outline='folded'][data-props='folded'] {`,
  },
  {
    tag: 'preview',
    check: 'leaving preview brings the side panels back',
    why: 'Drop the panel reopen from exitPreview, so a folded workspace stays toolless after preview.',
    file: 'components/editor/EditorShell.tsx',
    from: `    setPanels({ outline: true, props: true });`,
    to: '',
  },
  {
    tag: 'breakpoints',
    check: 'a section spacing set on Phone changes phone, not desktop',
    /*
     * The per-screen values ride onto the section as inline custom properties
     * (--tgs-pad-phone and its twins); the static container queries in globals.css
     * fold them in. Drop the spread that emits them and the override is still
     * stored, but it never reaches the DOM, so the phone value is missing and the
     * check sees no per-screen change.
     */
    why: 'Stop the section emitting its per-screen custom properties, so an override never renders.',
    file: 'components/render/PageRenderer.tsx',
    from: `        ...responsiveVars(section.responsive, SECTION_RESPONSIVE),`,
    to: `        /* probe: per-screen vars not emitted */`,
  },
  {
    tag: 'breakpoints',
    check: 'a block text size set on Phone shrinks phone, not desktop',
    /*
     * The block half of the same mechanism: sizeVars holds --tgs-fs-phone and its
     * twins. Drop the spread that puts them on the block wrapper and the phone size
     * is stored but never rendered, so the heading keeps its desktop size on a phone.
     */
    why: 'Stop the block emitting its per-screen size vars, so a size override never renders.',
    file: 'components/render/PageRenderer.tsx',
    from: `    ...sizeVars,`,
    to: `    /* probe: per-screen size vars not emitted */`,
  },
  {
    tag: 'breakpoints',
    check: 'a block line spacing set on Phone tightens phone, not desktop',
    /*
     * The line-spacing half of the same mechanism, keyed on its own map entry so
     * it breaks line spacing alone and the size check stays green. With toCss
     * always null the --tgs-lh-phone twin never emits, so the phone override is
     * stored but never renders and the heading keeps its desktop line height.
     */
    why: 'Stop the block emitting its per-screen line-spacing twins, so a phone override never renders.',
    file: 'components/render/PageRenderer.tsx',
    from: `  { property: 'lineHeight', varBase: '--tgs-lh', toCss: (value: unknown) => normaliseLineHeight(value) ?? null },`,
    to: `  { property: 'lineHeight', varBase: '--tgs-lh', toCss: () => null },`,
  },
  {
    tag: 'breakpoints',
    check: 'auto-resize brings a heading down on a phone, not on desktop',
    /*
     * The flag is the whole mechanism: without data-fluid the clamp rule matches
     * nothing, so the block keeps one fixed size and the phone never comes down.
     * The toggle still stores the flag, which is the shape of bug that looks wired
     * but does nothing.
     */
    why: 'Never mark a block data-fluid, so the auto-resize clamp is stored but never applies.',
    file: 'components/render/PageRenderer.tsx',
    from: `      data-fluid={fluid ? '' : undefined}`,
    to: `      data-fluid={undefined}`,
  },
  {
    tag: 'breakpoints',
    check: 'clear text sizing strips the fixed sizes off a heading',
    /*
     * The clean rewrites the html either way, so the button looks wired; leaving
     * the font-size in place is the version where it rewrites and clears nothing,
     * and the oversized spans survive.
     */
    why: 'Leave the font-size on, so the clean rewrites the html but strips nothing.',
    file: 'lib/content/styles.ts',
    from: `    el.style.removeProperty('font-size');`,
    to: `    /* probe: font-size left in place */`,
  },
  {
    tag: 'reveal',
    check: 'a reveal section animates in on the page but stays still while editing',
    /*
     * The flag is stored and the toggle looks wired, but without data-reveal on the
     * section the CSS matches nothing and no block ever animates. The invisible kind
     * of dead: the editor looks identical, and only the published page is flat.
     */
    why: 'Never emit data-reveal, so the toggle stores the flag but nothing animates.',
    file: 'components/render/PageRenderer.tsx',
    from: `      data-reveal={section.reveal && !editable ? normaliseRevealStyle(section.revealStyle) : undefined}`,
    to: `      data-reveal={undefined}`,
  },
  {
    tag: 'reveal-style',
    check: 'a chosen reveal style rides data-reveal and runs its own keyframe',
    /*
     * The flag and the attribute are there, but the chosen style is thrown away:
     * data-reveal always lands empty, so every reveal is the rise default and the
     * pane's Fade, Slide, Zoom and Blur do nothing on the page.
     */
    why: 'Drop the chosen style, so every reveal falls back to rise.',
    file: 'components/render/PageRenderer.tsx',
    from: `      data-reveal={section.reveal && !editable ? normaliseRevealStyle(section.revealStyle) : undefined}`,
    to: `      data-reveal={section.reveal && !editable ? '' : undefined}`,
  },
  {
    tag: 'reveal-style-css',
    check: 'a chosen reveal style rides data-reveal and runs its own keyframe',
    /*
     * The style reaches the attribute but the blur variant is wired to the rise
     * keyframe, so a section set to Blur quietly rises instead. The exact drift the
     * closed-list comment in styles.ts warns about, caught here on the page.
     */
    why: 'Point the blur variant at the rise keyframe, so Blur never blurs.',
    file: 'app/globals.css',
    from: `    .tgs-section[data-reveal='blur'] .tgs-block { animation-name: tgs-reveal-blur; }`,
    to: `    .tgs-section[data-reveal='blur'] .tgs-block { animation-name: tgs-reveal-rise; }`,
  },
  {
    tag: 'hover-lift',
    check: 'a hover-lift section raises its button under the pointer',
    /*
     * The toggle stores the flag but the section never carries data-hover-lift, so
     * the CSS matches nothing and cards and buttons sit flat under the pointer. Dead
     * in the one place it is meant to be alive: the published page.
     */
    why: 'Never emit data-hover-lift, so nothing lifts.',
    file: 'components/render/PageRenderer.tsx',
    from: `      data-hover-lift={section.hoverLift && !editable ? '' : undefined}`,
    to: `      data-hover-lift={undefined}`,
  },
  {
    tag: 'hover-lift-css',
    check: 'a hover-lift section raises its button under the pointer',
    /*
     * The attribute is there but the hover shadow is gone, so a lifted button never
     * deepens under the pointer. The rise may still fire, but the feedback everyone
     * was meant to get, reduced motion included, is lost.
     */
    why: 'Drop the hover shadow, so the lift loses its depth.',
    file: 'app/globals.css',
    from: `  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);`,
    to: `  box-shadow: none;`,
  },
  {
    tag: 'hover-zoom',
    check: 'an image-zoom section scales a card picture under the pointer',
    /*
     * The toggle stores the flag but the section never carries data-hover-zoom, so the
     * CSS matches nothing and a card's picture sits still under the pointer. Alive only
     * in the pane, dead on the page.
     */
    why: 'Never emit data-hover-zoom, so no picture zooms.',
    file: 'components/render/PageRenderer.tsx',
    from: `      data-hover-zoom={section.hoverZoom && !editable ? '' : undefined}`,
    to: `      data-hover-zoom={undefined}`,
  },
  {
    tag: 'hover-zoom-css',
    check: 'an image-zoom section scales a card picture under the pointer',
    /*
     * The attribute is there but the hover scale is gone, so a zoom section's picture
     * never leans in. The transition still stands, so nothing errors; the movement is
     * just quietly missing.
     */
    why: 'Drop the hover scale, so the picture never zooms.',
    file: 'app/globals.css',
    from: `    transform: scale(1.06);`,
    to: `    transform: none;`,
  },

  // --- contact details, on the settings screen -----------------------------

  {
    suite: 'settings',
    check: 'typing an opening time does not blank the field it was typed into',
    why: 'Keep only complete pairs, which is the obvious design and is unusable.',
    file: 'components/settings/SettingsEditor.tsx',
    from: `    if (updated.opens === '' && updated.closes === '') next.delete(day);
    else next.set(day, updated);`,
    to: `    if (updated.opens === '' || updated.closes === '') next.delete(day);
    else next.set(day, updated);`,
  },
  {
    suite: 'settings',
    check: 'the time boxes line up in a column down the week',
    why: 'Seven flex rows, so a day name of a different length moves the times.',
    file: 'components/settings/settings.css',
    from: `.st-hours__row { display: contents; }`,
    to: `.st-hours__row { display: flex; gap: 8px; align-items: center; }`,
  },
  {
    suite: 'settings',
    check: 'no address field invites a browser to autofill a personal address',
    why: 'Drop the attribute from one field, which is what a tidy would do.',
    file: 'components/settings/SettingsEditor.tsx',
    from: `                  maxLength={20}
                  autoComplete="off"`,
    to: `                  maxLength={20}`,
  },

  // --- the brand profile, on the settings screen ---------------------------

  {
    suite: 'settings',
    check: 'the profile fields are styled, not the browser defaults',
    why: 'Rename the rule, so the class matches nothing and the fields go native.',
    file: 'components/theme/theme.css',
    from: `.tv-input,
.tv-textarea {
  display: block;`,
    to: `.tv-input-renamed,
.tv-textarea-renamed {
  display: block;`,
  },
  {
    suite: 'settings',
    check: 'the about box is tall enough to write a paragraph in',
    why: 'Two rows, which is what a textarea gives you if nobody asks for more.',
    file: 'components/settings/SettingsEditor.tsx',
    from: `                className="tv-textarea"
                rows={5}
                maxLength={1200}`,
    to: `                className="tv-textarea"
                rows={1}
                maxLength={1200}`,
  },
  {
    suite: 'settings',
    check: 'the note under the heading has room before the first field',
    why: 'Drop the positional rule, so the intro sits flush against the field.',
    file: 'components/theme/theme.css',
    from: `.tv-group__title + .tv-note {
  margin-top: 0;
  margin-bottom: var(--ed-5);
}`,
    to: '',
  },
  {
    suite: 'settings',
    check: 'each box writes to its own field',
    why: 'The copy-paste bug: two boxes writing to the same key.',
    file: 'components/settings/SettingsEditor.tsx',
    from: `                onChange={(event) => set('avoid', event.target.value)}`,
    to: `                onChange={(event) => set('toneOfVoice', event.target.value)}`,
  },
  {
    suite: 'settings',
    check: 'the screen opens on Your company, and it is the first tab',
    why: 'Open on Analytics again, so the first tab is not the selected one.',
    file: 'components/settings/SettingsEditor.tsx',
    from: `  const [tab, setTab] = useState<Tab>('company');`,
    to: `  const [tab, setTab] = useState<Tab>('analytics');`,
  },
  {
    suite: 'settings',
    check: 'the long box stops at its limit rather than truncating on save',
    why: 'Leave the cap to the schema, which trims silently after the fact.',
    file: 'components/settings/SettingsEditor.tsx',
    from: `                maxLength={600}
                value={settings.toneOfVoice}`,
    to: `                value={settings.toneOfVoice}`,
  },
];

/*
 * IT RUNS IN ITS OWN WORKTREE, NOT IN YOURS.
 *
 * This deliberately breaks real source files and puts them back afterwards. Two
 * things went wrong doing that in the working checkout, and both are the same
 * mistake at different scales:
 *
 *  - A run died partway and left Canvas.tsx with one line deleted, because a
 *    `finally` does not run when the process is killed. That was nearly
 *    committed as real work.
 *  - While it runs, `git status` shows a mutation, so anything watching for a
 *    clean tree sees uncommitted work that is not work.
 *
 * A throwaway worktree fixes both. The mutations happen over there, the checkout
 * you are looking at is never touched, and if the process is killed the worst
 * case is a directory left in /tmp. Requiring a committed HEAD is what makes the
 * worktree the same code you are testing.
 */
const dirty = execSync('git status --porcelain -- .', { encoding: 'utf8' }).trim();
if (dirty) {
  console.error(
    '\n  Commit or stash first. This runs against a worktree of HEAD, so\n' +
      '  uncommitted work would simply not be in what it tests:\n\n' +
      dirty
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n') +
      '\n',
  );
  process.exit(1);
}

const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const arena = `/tmp/tg-sites-probe-${head.slice(0, 12)}`;

/** Best effort, because most of the time there is nothing there to remove. */
const tidy = () => {
  try {
    execSync(`git worktree remove --force ${arena}`, { cwd: root, stdio: 'ignore' });
  } catch {
    // No such worktree, which is the normal case on the way in.
  }
};

tidy();
execSync(`git worktree add --detach ${arena} ${head}`, { cwd: root, stdio: 'ignore' });

/*
 * node_modules is not in the worktree and installing again would take longer
 * than the whole probe. Linked, not copied: the packages are read-only here.
 */
execSync(`ln -sfn ${root}/tg-sites/node_modules ${arena}/tg-sites/node_modules`);

const here = `${arena}/tg-sites`;
const run = (command) => execSync(command, { cwd: here, encoding: 'utf8', stdio: 'pipe' });

/*
 * A FILTER, because the whole probe is now hours rather than minutes.
 *
 *   node tools/probe-checks.mjs              every mutation
 *   node tools/probe-checks.mjs assistant    only those whose check matches
 *
 * Each editor mutation rebuilds the bundle and runs all 195 browser checks,
 * which is about eight minutes, so twenty-one of them is most of an afternoon.
 * A subset run is the right tool when a session adds six checks to a file whose
 * other twenty-one were proved months ago.
 *
 * NOT A DEFAULT. With no argument this still runs everything, because a probe
 * that quietly narrows itself is the same failure as a probe that quietly stops.
 */
const only = process.argv[2];
const chosen = only
  ? MUTATIONS.filter((m) =>
      // The suite name is searchable too, so "settings" runs every mutation
      // aimed at that screen without having to know what each one is called.
      `${m.check} ${m.why} ${m.file} ${m.suite ?? 'editor'} ${m.tag ?? ''}`
        .toLowerCase()
        .includes(only.toLowerCase()))
  : MUTATIONS;

if (only) {
  console.log(`\n  ${chosen.length} of ${MUTATIONS.length} mutations match "${only}".\n`);
  if (chosen.length === 0) process.exit(1);
}

let bad = 0;
try {
  for (const mutation of chosen) {
    const target = `${here}/${mutation.file}`;
    const original = readFileSync(target, 'utf8');

    /*
     * A mutation that no longer applies is a FAILURE, not something to skip.
     * The code moved and this file did not follow, so the check it was meant to
     * exercise is now unproven. A probe that quietly stops probing is worse than
     * no probe, because it goes on printing reassurance.
     */
    if (!original.includes(mutation.from)) {
      console.log(`  ?? could not apply    ${mutation.check}`);
      bad += 1;
      continue;
    }

    const suite = SUITES[mutation.suite ?? 'editor'];

    writeFileSync(target, original.replace(mutation.from, mutation.to));
    let output = '';
    try {
      run(suite.build);
      output = run(suite.verify);
    } catch (error) {
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    } finally {
      writeFileSync(target, original);
    }

    /*
     * PASS IS THE MARKER, NOT FAIL, and that is a fix rather than a preference.
     *
     * The verifier prints `<status> <name>`, where status is PASS or FAIL with a
     * reason. When the reason contains newlines, which a Playwright call log
     * always does, the name ends up on a LATER line than the word FAIL. Looking
     * for FAIL on the name's line then reported MISSED for a check that had
     * failed exactly as intended.
     *
     * A passing line always carries PASS and the name together, so the absence
     * of PASS on the name's line is the reliable signal. The empty-line guard
     * stays: no line at all means the check never ran, which is not a catch.
     */
    const line = output.split('\n').find((row) => row.includes(mutation.check)) ?? '';
    const noticed = line !== '' && !line.includes('PASS');
    console.log(`  ${noticed ? 'caught ' : 'MISSED '} ${mutation.check}`);
    if (!noticed) {
      bad += 1;
      console.log(`           ${mutation.why}`);
      console.log(`           got: ${line.trim() || '(no such check ran)'}`);
    }
  }
} finally {
  tidy();
}

console.log(bad === 0 ? '\n  Every mutation was caught.' : `\n  ${bad} not caught.`);
process.exit(bad === 0 ? 0 : 1);
