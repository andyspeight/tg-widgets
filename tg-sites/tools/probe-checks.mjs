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
 * this is safe to run on a dirty tree but not while something else is building.
 * Roughly a minute per mutation: a full rebuild and the whole browser suite.
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
];

let bad = 0;
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

execSync('node tools/build-standalone.mjs', { stdio: 'ignore' });
console.log(bad === 0 ? '\n  Every mutation was caught.' : `\n  ${bad} not caught.`);
process.exit(bad === 0 ? 0 : 1);
