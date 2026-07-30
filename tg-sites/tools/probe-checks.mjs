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
    from: `      if (plainHost && event.key === 'Enter') {`,
    to: `      if (false && plainHost && event.key === 'Enter') {`,
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
    check: 'a size applies, and it is a real size rather than an attribute nothing reads',
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
    check: 'and one that is not a colour is refused rather than half applied',
    why: 'Take whatever was typed, and let the sanitiser be the only gate.',
    file: 'components/editor/TextToolbar.tsx',
    from: `    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(value)) return;`,
    to: '',
  },
  {
    check: 'the toolbar keeps clear of the words it is editing',
    why: 'Stop re-anchoring once measured, so a two-row bar sits over the words.',
    file: 'components/editor/TextToolbar.tsx',
    from: `          anchorTop.current !== null && measured`,
    to: `          false && anchorTop.current !== null && measured`,
  },
  {
    check: 'and fits on one row on an ordinary screen',
    why: 'Put the width cap back where it forced a second row holding two buttons.',
    file: 'components/editor/editor.css',
    from: `  max-width: min(860px, calc(100vw - 32px));`,
    to: `  max-width: min(700px, calc(100vw - 32px));`,
  },
];

/*
 * REFUSE TO START ON A TREE THAT IS NOT COMMITTED.
 *
 * This deliberately breaks real source files and puts them back. The finally
 * below does that, and a finally does not run when the process is killed, times
 * out, or the machine goes away. It happened: the run died partway and left
 * Canvas.tsx with one line deleted, which was then nearly committed.
 *
 * Requiring a clean tree makes the damage recoverable by definition, because
 * `git checkout` can undo anything this does. It also makes the belt-and-braces
 * restore at the end safe to run.
 */
const dirty = execSync('git status --porcelain -- . ', { encoding: 'utf8' }).trim();
if (dirty) {
  console.error(
    '\n  Commit or stash first. This script edits real source files, and a run\n' +
      '  that dies partway leaves one of those edits behind:\n\n' +
      dirty
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n') +
      '\n',
  );
  process.exit(1);
}

let bad = 0;
try {
  for (const mutation of MUTATIONS) {
    const original = readFileSync(mutation.file, 'utf8');
    if (!original.includes(mutation.from)) {
      console.log(`  ?? could not apply    ${mutation.check}`);
      bad += 1;
      continue;
    }

    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    let output = '';
    try {
      execSync('node tools/build-standalone.mjs', { stdio: 'ignore' });
      output = execSync('node tools/verify-standalone.mjs', { encoding: 'utf8' });
    } catch (error) {
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    } finally {
      writeFileSync(mutation.file, original);
    }

    const line = output.split('\n').find((row) => row.includes(mutation.check)) ?? '';
    const noticed = line.includes('FAIL');
    console.log(`  ${noticed ? 'caught ' : 'MISSED '} ${mutation.check}`);
    if (!noticed) {
      bad += 1;
      console.log(`           ${mutation.why}`);
      console.log(`           got: ${line.trim() || '(no such check ran)'}`);
    }
  }
} finally {
  // Belt and braces over the per-mutation restore above, and safe only because
  // the tree was clean when this started.
  execSync('git checkout -- .', { stdio: 'ignore' });
}

execSync('node tools/build-standalone.mjs', { stdio: 'ignore' });
console.log(bad === 0 ? '\n  Every mutation was caught.' : `\n  ${bad} not caught.`);
process.exit(bad === 0 ? 0 : 1);
