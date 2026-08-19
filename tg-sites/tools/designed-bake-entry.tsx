/**
 * The bake half of tools/build-designed-homes.mjs.
 *
 * Reads each committed concept in lib/content/designed/sources/<slug>.html,
 * freezes it through the SAME import pipeline a client's paste goes through, and
 * writes lib/content/designed/<slug>.json: the concept as native imported-section
 * blocks, sanitised so what is stored is exactly what a page save would store.
 *
 * WHY BAKED RATHER THAN IMPORTED AT RUNTIME. splitImport is parse5 plus postcss.
 * Running it every time a client picks a template would put that on the request,
 * and the answer never changes between deploys. So it is run here, once, and the
 * result is committed. designed-homes.ts loads the JSON and only re-mints ids.
 *
 * WHY THE REVEALS ARE NEUTRALISED. Each concept fades its content in on scroll by
 * starting it at opacity:0 and having a script add a class. The import strips the
 * script, so without this the frozen page would show blank space where the script
 * would have revealed the content. Forcing the reveal classes visible makes the
 * static page show everything, which is the resting state the design falls back to
 * under reduced motion anyway.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { splitImport } from '../lib/import/sections';
import { createBlock, createSection } from '../lib/content/factory';
import { sanitiseBlock } from '../lib/content/sanitise-page';
import type { Section } from '../lib/content/schema';

const SOURCES = 'lib/content/designed/sources';
const OUT = 'lib/content/designed';

/** Every <style> block, joined, plus the reveal-neutralising override. */
function extractCss(doc: string): string {
  const out: string[] = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) out.push(m[1]);
  // The concepts hide reveal targets at opacity:0 and let a script show them.
  // The import drops the script, so force the resting (revealed) state.
  out.push('.rv,.rise,.reveal{opacity:1 !important;transform:none !important;}');
  return out.join('\n');
}

function extractBody(doc: string): string {
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(doc);
  return m ? m[1] : doc;
}

interface Candidate {
  label: string;
  html: string;
  css: string;
  fields: unknown[];
}

/** One candidate, as a section holding a single sanitised imported block. */
function asSection(candidate: Candidate): Section {
  const section = createSection('1');
  const block = createBlock('imported');
  block.props = {
    html: candidate.html,
    css: candidate.css,
    label: candidate.label,
    fields: candidate.fields,
    content: {},
  };
  section.name = candidate.label;
  // Sanitise here so the stored bytes are a fixpoint: the css is scoped to this
  // block's id, and a page save (which sanitises again) changes nothing.
  section.rows[0].columns[0].blocks = [sanitiseBlock(block)];
  section.width = 'full';
  section.paddingY = 0;
  return section;
}

const files = readdirSync(SOURCES).filter((name) => name.endsWith('.html')).sort();
const report: string[] = [];

for (const file of files) {
  const slug = file.replace(/\.html$/, '');
  const doc = readFileSync(join(SOURCES, file), 'utf8');
  const css = extractCss(doc);
  const html = extractBody(doc);

  const split = splitImport(html, css, { maxSections: 40 });
  const sections = split.candidates.map((candidate) => asSection(candidate as Candidate));

  const slots = sections.reduce((sum, section) => {
    const block = section.rows[0].columns[0].blocks[0];
    return sum + (Array.isArray(block.props.fields) ? (block.props.fields as unknown[]).length : 0);
  }, 0);

  writeFileSync(join(OUT, `${slug}.json`), JSON.stringify(sections));
  report.push(`${slug}: ${sections.length} sections, ${slots} editable slots, removed ${split.removed.join('/') || 'nothing'}`);
}

process.stdout.write(report.join('\n') + '\n');
