/**
 * What happens when the model calls a tool: the readers, run on the server.
 *
 * EVERY RESULT IS DATA. A tool's answer goes back to the model inside the same
 * named blocks the first turn used (<page>, <site>, <results>, <enquiries>,
 * <catalogue>), so the system prompt's rule about material applies to it
 * unchanged: words on a page that the model fetched for itself are no more an
 * instruction than words on the page it was handed. Every result is capped.
 *
 * EVERY READ IS TENANT-SCOPED by the database layer, and a page id the model
 * invents is refused here before it reaches a query, by checking it against
 * the site's own page list. The people in the enquiries are removed by
 * lib/assist/mask.ts before the model sees a word of them.
 *
 * Nothing here writes. Slice 2 adds the writers in their own module.
 */

import 'server-only';

import { BLOCKS, BLOCK_GROUPS } from '../content/blocks';
import { PRESET_CATEGORIES } from '../content/presets';
import { listSubmissions } from '../db/forms';
import { getPage, listPagesForAudit } from '../db/pages';
import { countRedirects } from '../db/redirects';
import { readEnquiryDays } from '../db/report';
import { getSettings } from '../db/settings';
import { listVisitRows } from '../db/visits';
import { summariseEnquiries } from '../results/enquiries';
import { auditPage, auditSite, pageText, tally, type Finding } from '../seo/audit';
import { AI_ENGINES } from '../visits/classify';
import { summariseVisits } from '../visits/summary';
import { outlinePage, renderOutline } from './context';
import { maskEnquiry } from './mask';
import { pageSectionPresets } from './operations';
import { asData, dataBlock, siteBlock, type SiteContext } from './prompt';
import type { ToolOutcome } from './service';
import type { ToolName } from './tools';

export interface RunnerContext {
  tenantId: string;
  /** The page the person has open, or null. */
  pageId: string | null;
  site: SiteContext;
}

/** The longest result a tool may hand back, in characters. */
export const MAX_RESULT = 12_000;

function cap(text: string, max = MAX_RESULT): string {
  return text.length > max ? `${text.slice(0, max)}\n… (cut short)` : text;
}

function ok(content: string, detail: Record<string, unknown> = {}): ToolOutcome {
  return { content: cap(content), isError: false, detail };
}

function fail(content: string, detail: Record<string, unknown> = {}): ToolOutcome {
  return { content, isError: true, detail };
}

function field(input: unknown, key: string): unknown {
  return input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso.slice(0, 10) : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------

async function readPage(input: unknown, ctx: RunnerContext): Promise<ToolOutcome> {
  const asked = field(input, 'page_id');
  const pageId = typeof asked === 'string' && asked.trim() ? asked.trim() : ctx.pageId;
  if (!pageId) return fail('No page is open. Call read_site and pass a page_id from its list.');

  const known = ctx.site.pages.find((page) => page.id === pageId);
  if (!known) return fail('That is not a page of this site. Call read_site for the list.', { pageId: pageId.slice(0, 40) });

  const page = await getPage(ctx.tenantId, pageId);
  if (!page) return fail('That page could not be read.', { pageId });

  const outline = renderOutline(outlinePage(page.content, known.path), 20_000).text;
  const words = pageText(page.content, 8_000);
  return ok(dataBlock('page', `${outline}\n\nWords on the page, in order:\n${words || '(no words yet)'}`), { pageId });
}

async function readSite(ctx: RunnerContext): Promise<ToolOutcome> {
  return ok(siteBlock(ctx.site), { pages: ctx.site.pages.length });
}

/**
 * The two catalogues, asked for one at a time.
 *
 * SPLIT ON PURPOSE, not for tidiness. The block list alone is nearly 11,000
 * characters and the designed sections are another 6,000, so one answer
 * carrying both would be cut off by the cap and the model would be reading a
 * truncated library without knowing it. Asking which one it wants costs a round
 * trip and is honest about what it gets.
 */
function readCatalogue(input: unknown): ToolOutcome {
  const asked = String(field(input, 'of') ?? '').trim().toLowerCase();
  const wanted = field(input, 'group');
  const group = typeof wanted === 'string' ? wanted.trim() : '';
  if (asked === 'sections') return readSections(group);
  // No answer means the blocks, which is what this tool was before it had two.
  if (asked === 'blocks' || asked === '') return readBlocks(group);
  return fail('Ask for "sections" or for "blocks".');
}

function readSections(group: string): ToolOutcome {
  const categories = PRESET_CATEGORIES.filter((entry) => entry.scope === 'page');
  const presets = pageSectionPresets();

  if (group) {
    const category = categories.find(
      (entry) => entry.id === group.toLowerCase() || entry.label.toLowerCase() === group.toLowerCase(),
    );
    if (!category) {
      return fail(`No section category called "${group.slice(0, 40)}". They are: ${categories.map((entry) => entry.id).join(', ')}.`);
    }
    const lines = presets
      .filter((preset) => preset.category === category.id)
      .map((preset) => `${preset.id}: ${preset.label}. ${preset.description}`);
    return ok(
      dataBlock(
        'catalogue',
        [`Designed sections in "${category.label}". Add one with a propose_changes add_section naming its id.`, '', ...lines].join('\n'),
      ),
      { sections: lines.length, category: category.id },
    );
  }

  const lines: string[] = [
    'Designed sections a page can be built from. Add one with a propose_changes add_section naming its id, and ask again with a category for what each one is for.',
    '',
  ];
  for (const category of categories) {
    const inCategory = presets.filter((preset) => preset.category === category.id);
    if (inCategory.length === 0) continue;
    lines.push(`${category.id} (${category.label}): ${inCategory.map((preset) => `${preset.id} (${preset.label})`).join(', ')}`);
  }
  return ok(dataBlock('catalogue', lines.join('\n')), { sections: presets.length });
}

function readBlocks(wanted: string): ToolOutcome {
  const group = wanted
    ? BLOCK_GROUPS.find((entry) => entry.toLowerCase() === wanted.toLowerCase()) ?? null
    : null;
  if (wanted && !group) {
    return fail(`No group called "${wanted.slice(0, 40)}". The groups are: ${BLOCK_GROUPS.join(', ')}.`);
  }
  const lines: string[] = [`Blocks a page can be built from${group ? ` in the group "${group}"` : ''}. Groups: ${BLOCK_GROUPS.join(', ')}.`, ''];
  let count = 0;
  for (const block of BLOCKS) {
    if (block.staffOnly) continue;
    if (group && block.group !== group) continue;
    const settings = block.fields
      .slice(0, 12)
      .map((f) => `${f.key} (${f.kind})`)
      .join(', ');
    lines.push(`${block.type}: ${block.label} [${block.group}]. ${block.description}${settings ? ` Settings: ${settings}.` : ''}`);
    count += 1;
  }
  return ok(dataBlock('catalogue', lines.join('\n')), { blocks: count, group });
}

function findingLine(finding: Finding, where: string): string {
  return `${where}${finding.title}${finding.fix ? ` Fix: ${finding.fix}` : ''}`;
}

async function readResults(input: unknown, ctx: RunnerContext): Promise<ToolOutcome> {
  const days = Number(field(input, 'days')) === 90 ? 90 : 30;
  const now = new Date();
  const [settings, pages, redirects, visits, enquiries] = await Promise.all([
    getSettings(ctx.tenantId),
    listPagesForAudit(ctx.tenantId),
    countRedirects(ctx.tenantId).catch(() => 0),
    listVisitRows(ctx.tenantId, days * 2)
      .then((rows) => summariseVisits(rows, now, days))
      .catch(() => summariseVisits([], now, days)),
    readEnquiryDays(ctx.tenantId, days)
      .then((rows) => summariseEnquiries(rows, now, days))
      .catch(() => summariseEnquiries([], now, days)),
  ]);

  const published = pages.filter((page) => page.published && page.content);
  const site = auditSite(settings, published.length).map((finding) => ({ finding, where: '' }));
  const perPage = published.flatMap((page) =>
    auditPage(page.content!, page.title, settings).map((finding) => ({ finding, where: `Page "${asData(page.title)}" at ${page.path ? `/${page.path}` : '/'}: ` })),
  );
  const all = [...site, ...perPage];
  const counts = tally(all.map((entry) => entry.finding));
  const fixes = all.filter((entry) => entry.finding.severity !== 'good');
  fixes.sort((a, b) => (a.finding.severity === b.finding.severity ? 0 : a.finding.severity === 'problem' ? -1 : 1));
  const good = all.filter((entry) => entry.finding.severity === 'good').slice(0, 6);

  const lines: string[] = [
    `Results for the last ${days} days (${visits.from} to ${visits.to}).`,
    '',
    `Site health check: ${counts.problem} problems, ${counts.warning} warnings, ${counts.good} things right. ${published.length} of ${pages.length} pages are published.`,
    fixes.length ? 'Fix first, worst first:' : 'Nothing to fix.',
    ...fixes.slice(0, 20).map((entry, i) => `${i + 1}. ${findingLine(entry.finding, entry.where)}`),
    ...(fixes.length > 20 ? [`… and ${fixes.length - 20} more.`] : []),
    good.length ? `Working well: ${good.map((entry) => entry.finding.title).join('; ')}.` : '',
    '',
    `Readers: ${visits.totals.visitor} people (previous ${days} days: ${visits.previous.visitor}); ${visits.totals.ai} people sent by an AI assistant (previous ${visits.previous.ai}); ${visits.families.ai} AI crawler visits and ${visits.families.search} search crawler visits (previous ${visits.previousFamilies.ai} and ${visits.previousFamilies.search}); ${visits.totals.bot} other robots.${visits.firstDay ? '' : ' Nothing has been counted yet; counting began when the site was published on the current platform.'}`,
  ];
  const seen = visits.crawlers.filter((c) => c.family === 'ai');
  const notYet = AI_ENGINES.filter((name) => !seen.some((c) => c.label === name));
  lines.push(
    `AI engines that have read the site: ${seen.length ? seen.map((c) => `${c.label} (${c.count} visits, last ${dayLabel(c.lastSeen)})`).join(', ') : 'none yet'}. Not yet: ${notYet.join(', ') || 'none'}.`,
  );
  if (visits.assistants.length) lines.push(`Assistants people arrived from: ${visits.assistants.map((a) => `${a.label} (${a.count})`).join(', ')}.`);
  if (visits.topVisited.length) lines.push(`Pages people read most: ${visits.topVisited.map((p) => `${p.path} (${p.count})`).join(', ')}.`);
  if (visits.topCrawled.length) lines.push(`Pages engines read most: ${visits.topCrawled.map((p) => `${p.path} (${p.count})`).join(', ')}.`);
  lines.push(`Enquiries through the site's forms: ${enquiries.total} (previous ${days} days: ${enquiries.previous}).`);
  lines.push(`Redirects set up: ${redirects}.`);

  return ok(dataBlock('results', lines.filter((line) => line !== '').join('\n')), {
    days,
    problems: counts.problem,
    warnings: counts.warning,
    published: published.length,
  });
}

async function readEnquiries(input: unknown, ctx: RunnerContext): Promise<ToolOutcome> {
  const asked = Number(field(input, 'days'));
  const days = Number.isFinite(asked) && asked >= 1 ? Math.min(90, Math.floor(asked)) : 30;
  const since = Date.now() - days * 86_400_000;
  const all = await listSubmissions(ctx.tenantId, 300);
  const recent = all.filter((entry) => new Date(entry.createdAt).getTime() >= since);

  const byForm = new Map<string, number>();
  for (const entry of recent) byForm.set(entry.formName || 'Form', (byForm.get(entry.formName || 'Form') ?? 0) + 1);

  const lines: string[] = [
    `Enquiries in the last ${days} days: ${recent.length}${all.length > recent.length ? ` (${all.length - recent.length} older ones not shown)` : ''}.`,
    byForm.size ? `By form: ${[...byForm.entries()].map(([name, n]) => `${asData(name)} (${n})`).join(', ')}.` : '',
    'The people have been removed: names, emails, phone numbers and addresses are not here, and numbers inside messages are blanked. What is left is what they asked.',
    '',
  ];
  let shown = 0;
  for (const entry of recent.slice(0, 25)) {
    const fields = maskEnquiry(entry.data);
    const summary = Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('; ');
    lines.push(`- ${dayLabel(entry.createdAt)}, ${asData(entry.formName || 'Form')}${entry.meta.path ? ` from ${entry.meta.path}` : ''}: ${summary || '(nothing but personal details)'}`);
    shown += 1;
  }
  if (recent.length > shown) lines.push(`… and ${recent.length - shown} more.`);
  if (recent.length === 0) lines.push('No enquiries in this window.');

  return ok(dataBlock('enquiries', lines.filter((line) => line !== '').join('\n')), { days, count: recent.length, shown });
}

// ---------------------------------------------------------------------------

export async function runTool(name: ToolName, input: unknown, ctx: RunnerContext): Promise<ToolOutcome> {
  switch (name) {
    case 'read_page':
      return readPage(input, ctx);
    case 'read_site':
      return readSite(ctx);
    case 'read_catalogue':
      return readCatalogue(input);
    case 'read_results':
      return readResults(input, ctx);
    case 'read_enquiries':
      return readEnquiries(input, ctx);
    case 'ask_user':
    case 'propose_changes':
      /* Both end the turn rather than running here: one asks the person a
         question, the other hands them changes to apply. The loop in
         service.ts intercepts them before this is reached. */
      return fail(`${name} ends the turn; it is not run as a tool.`);
  }
}
